// IBR cli — chat REPL

import * as readline from "node:readline/promises"
import { stdin, stdout } from "node:process"
import { activeModel, loadConfig, saveConfig, switchModel, addModel, removeModel } from "./config/store.js"
import type { Config } from "./config/schema.js"
import { streamChat, type ChatMessage } from "./api/client.js"
import { buildOutgoing } from "./context/window.js"
import { BOX, COLOR, printBanner } from "./ui/theme.js"
import { isTTY, renderBubble, renderNotice, Spinner, StreamingLine, statusBar, termWidth } from "./ui/render.js"
import { openConfigEditor } from "./config-editor.js"

interface CmdResult {
  handled: boolean
  exit?: boolean
}

export async function startChat(): Promise<void> {
  let cfg: Config
  try {
    cfg = loadConfig()
  } catch (e) {
    process.stdout.write(COLOR.err("Could not load config: " + (e as Error).message) + "\n")
    process.stdout.write(COLOR.muted("Run `ibr config` to fix.") + "\n")
    process.exit(1)
  }
  if (!cfg.api_key || cfg.api_key.length === 0) {
    process.stdout.write(COLOR.warn("No API key set. Run `ibr config` to add one.") + "\n")
  }

  printBanner()
  printHelp()
  printStatus(cfg)

  const rl = readline.createInterface({
    input: stdin,
    output: stdout,
    prompt: COLOR.prompt(`${BOX.arrow} `),
    terminal: isTTY(),
  })

  const history: ChatMessage[] = []
  const spinner = new Spinner("thinking")

  // Multiline input: when stdin is not a TTY we fall back to line-buffer mode
  let pending: string[] = []
  let inMulti = false

  rl.prompt()

  for await (const line of rl) {
    const trimmed = line.trim()

    // Multi-line paste detection: empty line on its own submits the buffer
    if (inMulti) {
      if (trimmed === "") {
        const text = pending.join("\n")
        pending = []
        inMulti = false
        await handleUserText(cfg, text, history, spinner)
      } else {
        pending.push(line)
      }
      rl.prompt()
      continue
    }

    if (trimmed === "") {
      rl.prompt()
      continue
    }

    // Slash commands
    if (trimmed.startsWith("/")) {
      const r = await runSlashCommand(trimmed, cfg, history)
      if (r.exit) { rl.close(); return }
      cfg = loadConfig() // commands may have rewritten it
      rl.prompt()
      continue
    }

    // ` starts a multi-line buffer
    if (trimmed.startsWith("```")) {
      inMulti = true
      pending = [""]
      process.stdout.write(COLOR.muted("  multi-line mode — end with a blank line to send") + "\n")
      rl.prompt()
      continue
    }

    await handleUserText(cfg, trimmed, history, spinner)
    rl.prompt()
  }
}

async function handleUserText(cfg: Config, text: string, history: ChatMessage[], spinner: Spinner): Promise<void> {
  const model = activeModel(cfg)
  const sysPrompt = model.system_prompt && model.system_prompt.length > 0 ? model.system_prompt : cfg.system_prompt
  const cw = model.context_window > 0 ? model.context_window : cfg.context_window
  const built = buildOutgoing(history, text, sysPrompt, cw)

  if (built.droppedCount > 0) {
    process.stdout.write(renderNotice(`trimmed ${built.droppedCount} old message(s) to fit ${cw} token window`, "info") + "\n")
  }

  spinner.update(`asking ${model.model}`)
  spinner.start()
  const stream = new StreamingLine()

  await new Promise<void>((resolve) => {
    streamChat(cfg, model, built.messages, {
      onDelta: (delta) => {
        spinner.stop()
        stream.append(delta)
      },
      onDone: (full) => {
        spinner.stop()
        const text = stream.finish().length > 0 ? stream.finish() : full
        // record the round-trip
        history.push({ role: "user", content: text })
        history.push({ role: "assistant", content: full })
        process.stdout.write("\n")
        printStatus(cfg, built.usedTokens, cw)
        resolve()
      },
      onError: (err) => {
        spinner.stop()
        stream.finish()
        process.stdout.write("\n" + COLOR.err("Error: ") + err.message + "\n")
        process.stdout.write(COLOR.muted("Run `ibr config` to check API URL/Key/Headers.") + "\n\n")
        resolve()
      },
    })
  })
}

function printHelp(): void {
  const cmds = [
    ["/help", "show commands"],
    ["/config", "interactive config editor"],
    ["/models", "list model presets"],
    ["/switch <id>", "switch active model preset"],
    ["/model <id>", "alias for /switch"],
    ["/add <id>", "add a new model preset"],
    ["/rm <id>", "remove a model preset"],
    ["/cost", "show estimated token usage of this session"],
    ["/clear", "clear conversation history"],
    ["/quit", "exit"],
  ]
  process.stdout.write(COLOR.brand("commands") + "\n")
  for (const [cmd, desc] of cmds) {
    process.stdout.write("  " + COLOR.brand(cmd.padEnd(16)) + COLOR.muted(desc) + "\n")
  }
  process.stdout.write(COLOR.muted("  (start a message with ``` for multi-line)") + "\n\n")
}

function printStatus(cfg: Config, usedTokens = 0, budget = 0): void {
  const m = activeModel(cfg)
  const left = `${COLOR.brand("IBR")} ${COLOR.muted("·")} ${COLOR.brand(m.id)} ${COLOR.muted("(" + m.model + ")")}`
  const right = usedTokens > 0
    ? `${usedTokens}/${budget} tokens`
    : `${cfg.api_url}`
  process.stdout.write(statusBar(left, right) + "\n")
}

async function runSlashCommand(input: string, cfg: Config, history: ChatMessage[]): Promise<CmdResult> {
  const [cmd, ...rest] = input.slice(1).split(/\s+/)
  const arg = rest.join(" ")
  switch (cmd.toLowerCase()) {
    case "help":
    case "?":
      printHelp()
      return { handled: true }
    case "quit":
    case "exit":
    case "q":
      return { handled: true, exit: true }
    case "clear":
    case "cls":
      history.length = 0
      process.stdout.write(renderNotice("conversation cleared", "info") + "\n")
      return { handled: true }
    case "config":
    case "cfg":
      await openConfigEditor(cfg)
      saveConfig(cfg)
      process.stdout.write(renderNotice("config saved", "ok") + "\n")
      return { handled: true }
    case "models":
    case "list":
      process.stdout.write(renderModelList(cfg) + "\n")
      return { handled: true }
    case "switch":
    case "model": {
      if (!arg) {
        process.stdout.write(renderNotice("usage: /switch <id>", "warn") + "\n")
        return { handled: true }
      }
      try {
        const next = switchModel(cfg, arg)
        Object.assign(cfg, next)
        saveConfig(cfg)
        process.stdout.write(renderNotice(`active model → ${arg}`, "ok") + "\n")
      } catch (e) {
        process.stdout.write(renderNotice((e as Error).message, "err") + "\n")
      }
      return { handled: true }
    }
    case "add": {
      if (!arg) {
        process.stdout.write(renderNotice("usage: /add <id>", "warn") + "\n")
        return { handled: true }
      }
      try {
        const next = addModel(cfg, arg)
        Object.assign(cfg, next)
        saveConfig(cfg)
        process.stdout.write(renderNotice(`added model preset "${arg}"`, "ok") + "\n")
      } catch (e) {
        process.stdout.write(renderNotice((e as Error).message, "err") + "\n")
      }
      return { handled: true }
    }
    case "rm":
    case "remove": {
      if (!arg) {
        process.stdout.write(renderNotice("usage: /rm <id>", "warn") + "\n")
        return { handled: true }
      }
      try {
        const next = removeModel(cfg, arg)
        Object.assign(cfg, next)
        saveConfig(cfg)
        process.stdout.write(renderNotice(`removed model preset "${arg}"`, "ok") + "\n")
      } catch (e) {
        process.stdout.write(renderNotice((e as Error).message, "err") + "\n")
      }
      return { handled: true }
    }
    case "cost":
    case "tokens": {
      const used = history.reduce((a, m) => a + (m.content.length / 4), 0)
      process.stdout.write(renderNotice(`~${Math.ceil(used)} tokens in conversation so far`, "info") + "\n")
      return { handled: true }
    }
    case "show": {
      // dump config as JSON
      process.stdout.write(JSON.stringify(cfg, null, 2) + "\n")
      return { handled: true }
    }
    default:
      process.stdout.write(renderNotice(`unknown command: /${cmd} — try /help`, "warn") + "\n")
      return { handled: true }
  }
}

function renderModelList(cfg: Config): string {
  const out: string[] = []
  out.push(COLOR.brand("models") + COLOR.muted("  (active marked with " + BOX.star + ")"))
  for (const m of cfg.models) {
    const mark = m.id === cfg.active_model_id ? COLOR.brand(BOX.star + " ") : "  "
    out.push(`  ${mark}${COLOR.brand(m.id.padEnd(14))} ${COLOR.muted(m.model.padEnd(28))} ${m.context_window} tokens`)
  }
  return out.join("\n")
}
