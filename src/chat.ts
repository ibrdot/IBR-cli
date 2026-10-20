// IBR cli — chat REPL (v2 architecture: one rl per line so /config can own stdin)

import * as readline from "node:readline/promises"
import { stdin, stdout } from "node:process"
import { activeModel, loadConfig, saveConfig, switchModel, addModel, removeModel, sanitizeUrl, isConfigured } from "./config/store.js"
import type { Config } from "./config/schema.js"
import { streamChat, type ChatMessage, type ToolCall } from "./api/client.js"
import { buildOutgoing } from "./context/window.js"
import { BOX, COLOR, printBanner } from "./ui/theme.js"
import { isTTY, renderNotice, Spinner, StreamingLine, statusBar, termWidth } from "./ui/render.js"
import { openConfigEditor } from "./config-editor.js"
import { TOOLS, getTool, allOpenAISchemas, safeParseArgs } from "./tools/index.js"
import type { ToolContext } from "./tools/types.js"
import { detectProject } from "./project/detect.js"
import { saveSession, loadSession, listSessions } from "./sessions/store.js"

interface ChatState {
  cfg: Config
  history: ChatMessage[]
  todo: string[]
  sessionId: string
  cwd: string
  projectHint: string
  shouldQuit: boolean
}

export async function startChat(): Promise<void> {
  let cfg: Config
  try {
    cfg = loadConfig()
  } catch (e) {
    process.stdout.write(COLOR.err("Could not load config: " + (e as Error).message) + "\n")
    process.stdout.write(COLOR.muted("Run `ibrcli config` to fix.") + "\n")
    process.exit(1)
  }
  if (!isConfigured(cfg)) {
    // shouldn't reach here — index.ts guards this — but be defensive
    process.stdout.write(COLOR.warn("Config incomplete. Run `ibrcli login <url> <key> [model]` to set up.") + "\n")
    process.exit(1)
  }

  printBanner()
  printHelp()
  printStatus(cfg)

  const projectHint = detectProject(process.cwd())
  if (projectHint) {
    process.stdout.write(renderNotice("project: " + projectHint, "info") + "\n")
  }

  const state: ChatState = {
    cfg,
    history: [],
    todo: [],
    sessionId: `s-${Date.now()}`,
    cwd: process.cwd(),
    projectHint,
    shouldQuit: false,
  }

  // load session if --resume <id> was passed
  const resumeArg = process.argv.find((a, i) => process.argv[i - 1] === "--resume")
  if (resumeArg) {
    try {
      const sess = loadSession(resumeArg)
      state.history = sess.history
      state.sessionId = resumeArg
      process.stdout.write(renderNotice(`resumed session ${resumeArg} (${state.history.length} messages)`, "ok") + "\n")
    } catch (e) {
      process.stdout.write(renderNotice(`could not resume ${resumeArg}: ${(e as Error).message}`, "err") + "\n")
    }
  }

  // Main loop: create a fresh rl per line so commands like /config can own stdin
  let pending: string[] = []
  let inMulti = false

  while (!state.shouldQuit) {
    if (inMulti) {
      process.stdout.write(COLOR.muted("  ... | ") + pending.join("\\n").slice(0, 60) + (pending.length > 0 ? "…" : "") + "\n")
    }
    const line = await readLine(COLOR.prompt(`${BOX.arrow} `))
    if (line === null) {  // Ctrl+D
      process.stdout.write("\n")
      break
    }
    const trimmed = line.trim()

    if (inMulti) {
      if (trimmed === "") {
        const text = pending.join("\n")
        pending = []
        inMulti = false
        await handleUserText(state, text)
      } else {
        pending.push(line)
      }
      continue
    }

    if (trimmed === "") continue

    if (trimmed.startsWith("/")) {
      await runSlashCommand(trimmed, state)
      continue
    }

    if (trimmed.startsWith("```")) {
      inMulti = true
      pending = [""]
      process.stdout.write(COLOR.muted("  multi-line mode — end with a blank line to send") + "\n")
      continue
    }

    await handleUserText(state, trimmed)
  }

  // auto-save session
  if (state.history.length > 0) {
    try {
      saveSession(state.sessionId, state.history, state.cfg.active_model_id)
    } catch {
      /* ignore */
    }
  }
}

// Read one line. Returns null on EOF.
function readLine(prompt: string): Promise<string | null> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: stdin,
      output: stdout,
      prompt,
      terminal: isTTY(),
    })
    rl.prompt()
    let resolved = false
    const done = (v: string | null) => {
      if (resolved) return
      resolved = true
      rl.close()
      resolve(v)
    }
    rl.on("line", (line) => done(line))
    rl.on("close", () => done(null))
    rl.on("SIGINT", () => done(null))
  })
}

function printHelp(): void {
  const cmds: [string, string][] = [
    ["/help",        "show commands"],
    ["/config",      "interactive config editor"],
    ["/models",      "list model presets"],
    ["/switch <id>", "switch active model preset"],
    ["/add <id>",    "add a new model preset"],
    ["/rm <id>",     "remove a model preset"],
    ["/tools",       "list available tools"],
    ["/sessions",    "list saved sessions"],
    ["/resume <id>", "resume a saved session"],
    ["/save",        "save current session"],
    ["/cost",        "estimated token usage so far"],
    ["/clear",       "clear conversation history"],
    ["/cwd",         "show working directory"],
    ["/cd <dir>",    "change working directory"],
    ["/ls",          "list files in cwd"],
    ["/doctor",      "test API connection"],
    ["/quit",        "exit"],
  ]
  process.stdout.write(COLOR.brand("commands") + "\n")
  for (const [cmd, desc] of cmds) {
    process.stdout.write("  " + COLOR.brand(cmd.padEnd(18)) + COLOR.muted(desc) + "\n")
  }
  process.stdout.write(COLOR.muted("  (start a message with ``` for multi-line — end with a blank line)") + "\n")
  process.stdout.write(COLOR.muted("  (Ctrl+C cancels a streaming response)") + "\n\n")
}

function printStatus(cfg: Config, usedTokens = 0, budget = 0): void {
  const m = activeModel(cfg)
  const left = `${COLOR.brand("IBR")} ${COLOR.muted("·")} ${COLOR.brand(m.id)} ${COLOR.muted("(" + (m.model || "(unset)") + ")")}`
  const right = usedTokens > 0 ? `${usedTokens}/${budget} tokens` : sanitizeUrl(cfg.api_url)
  process.stdout.write(statusBar(left, right) + "\n")
}

async function handleUserText(state: ChatState, text: string): Promise<void> {
  const model = activeModel(state.cfg)
  const sysPrompt = model.system_prompt && model.system_prompt.length > 0
    ? model.system_prompt
    : state.cfg.system_prompt
  const cw = model.context_window > 0 ? model.context_window : state.cfg.context_window
  const built = buildOutgoing(state.history, text, sysPrompt + (state.projectHint ? `\n\nProject context: ${state.projectHint}` : ""), cw)

  if (built.droppedCount > 0) {
    process.stdout.write(renderNotice(`trimmed ${built.droppedCount} old message(s) to fit ${cw} token window`, "info") + "\n")
  }

  // Multi-turn tool loop: send → maybe tool_calls → execute → send back → repeat
  let turn = 0
  const maxTurns = 8
  let lastMessages = built.messages
  let lastUserText = text

  while (turn < maxTurns) {
    turn++
    const spinner = new Spinner(turn === 1 ? `asking ${model.model}` : "following up tool result")
    spinner.start()
    const stream = new StreamingLine()

    let abortController: AbortController | null = null
    if (isTTY()) {
      // Listen for Ctrl+C to abort streaming
      abortController = new AbortController()
      const onSigint = () => {
        spinner.stop()
        stream.finish()
        process.stdout.write(COLOR.warn("\n  (interrupted by user)") + "\n")
        abortController?.abort()
      }
      process.once("SIGINT", onSigint)
    }

    const result = await new Promise<{ text: string; toolCalls: ToolCall[] } | null>((resolve) => {
      streamChat(state.cfg, model, lastMessages, allOpenAISchemas(), {
        onDelta: (delta) => {
          spinner.stop()
          stream.append(delta)
        },
        onDone: (full) => {
          spinner.stop()
          const text = stream.finish().length > 0 ? full : full
          process.stdout.write("\n")
          resolve({ text, toolCalls: [] })
        },
        onError: (err) => {
          spinner.stop()
          stream.finish()
          process.stdout.write("\n" + COLOR.err("Error: ") + err.message + "\n")
          if (err.message.includes("401")) {
            process.stdout.write(COLOR.muted("  → run `ibrcli login <api_url> <api_key> <model>` to fix in one line") + "\n")
          } else {
            process.stdout.write(COLOR.muted("  → run `ibrcli config` to check API URL/Key/Headers") + "\n")
          }
          process.stdout.write("\n")
          resolve(null)
        },
      }, abortController?.signal)
    })

    if (!result) return

    if (result.text && result.text.length > 0) {
      // record assistant turn
      state.history.push({ role: "user", content: lastUserText })
      state.history.push({ role: "assistant", content: result.text })
      lastUserText = "(tool result)"  // for next iteration if needed
      printStatus(state.cfg, built.usedTokens, cw)
      return  // done — no tool calls
    }

    if (result.toolCalls && result.toolCalls.length > 0) {
      // record assistant message WITH tool_calls
      state.history.push({ role: "user", content: lastUserText })
      state.history.push({ role: "assistant", content: result.text || "", tool_calls: result.toolCalls })
      lastUserText = "(continue)"

      // execute each tool call
      const toolMessages: ChatMessage[] = []
      for (const tc of result.toolCalls) {
        const tool = getTool(tc.function.name)
        if (!tool) {
          process.stdout.write(renderNotice(`unknown tool: ${tc.function.name}`, "err") + "\n")
          toolMessages.push({
            role: "tool",
            tool_call_id: tc.id,
            name: tc.function.name,
            content: `error: unknown tool ${tc.function.name}`,
          })
          continue
        }
        const args = safeParseArgs(tc.function.arguments)
        const summary = formatToolSummary(tool.name, args)
        process.stdout.write("  " + COLOR.brand(BOX.arrow) + " " + COLOR.user(tool.name) + " " + COLOR.muted(summary) + "\n")

        // permission
        if (tool.requiresPermission) {
          const ok = await askPermission(tool.name, summary)
          if (!ok) {
            process.stdout.write(renderNotice(`denied — skipping ${tool.name}`, "warn") + "\n")
            toolMessages.push({
              role: "tool",
              tool_call_id: tc.id,
              name: tool.name,
              content: "user denied permission",
            })
            continue
          }
        }

        // execute
        const ctx: ToolContext = {
          cwd: state.cwd,
          todo: state.todo,
          askPermission: async (n, s) => askPermission(n, s),
        }
        const res = await tool.run(args, ctx)
        if (res.diff) {
          printDiff(res.diff)
        } else if (res.display) {
          process.stdout.write(COLOR.muted("  " + (res.ok ? BOX.check : BOX.cross) + " " + res.display) + "\n")
        }
        toolMessages.push({
          role: "tool",
          tool_call_id: tc.id,
          name: tool.name,
          content: res.output.slice(0, 12000),
        })
      }

      // append tool results to messages for next API call
      lastMessages = [...lastMessages, ...toolMessages]
      // also push into history so it persists
      // (assistant with tool_calls is already in history; tool messages go too)
      for (const tm of toolMessages) state.history.push(tm)

      continue  // loop back to model with tool results
    }

    // No text and no tool calls — model gave nothing useful
    process.stdout.write(renderNotice("model returned empty response", "warn") + "\n")
    return
  }

  process.stdout.write(renderNotice(`max turns (${maxTurns}) reached — stopping tool loop`, "warn") + "\n")
}

function formatToolSummary(name: string, args: Record<string, unknown>): string {
  const top = Object.entries(args).slice(0, 3).map(([k, v]) => {
    const s = typeof v === "string" ? v : JSON.stringify(v)
    return `${k}=${s.slice(0, 40)}${s.length > 40 ? "…" : ""}`
  }).join(" ")
  return top
}

async function askPermission(toolName: string, summary: string): Promise<boolean> {
  process.stdout.write(COLOR.warn(`  ? ${toolName}: ${summary}`) + "\n")
  const ans = await readLine(COLOR.prompt("  allow? [y/N] > "))
  if (ans === null) return false
  return ans.trim().toLowerCase().startsWith("y")
}

function printDiff(diff: string): void {
  for (const line of diff.split("\n")) {
    if (line.startsWith("+ ")) {
      process.stdout.write(COLOR.ok("  " + line) + "\n")
    } else if (line.startsWith("- ")) {
      process.stdout.write(COLOR.err("  " + line) + "\n")
    } else if (line.startsWith("@@")) {
      process.stdout.write(COLOR.brand("  " + line) + "\n")
    } else {
      process.stdout.write(COLOR.muted("  " + line) + "\n")
    }
  }
}

async function runSlashCommand(input: string, state: ChatState): Promise<void> {
  const [cmd, ...rest] = input.slice(1).split(/\s+/)
  const arg = rest.join(" ")
  switch (cmd.toLowerCase()) {
    case "help": case "?":
      printHelp()
      return
    case "quit": case "exit": case "q":
      state.shouldQuit = true
      return
    case "clear": case "cls":
      state.history.length = 0
      process.stdout.write("\x1b[2J\x1b[H")  // ANSI clear screen
      printBanner()
      printStatus(state.cfg)
      return
    case "config": case "cfg": {
      await openConfigEditor(state.cfg, readLine)
      saveConfig(state.cfg)
      process.stdout.write(renderNotice("config saved", "ok") + "\n")
      return
    }
    case "models": case "list": {
      process.stdout.write(renderModelList(state.cfg) + "\n")
      return
    }
    case "switch": case "model": {
      if (!arg) { process.stdout.write(renderNotice("usage: /switch <id>", "warn") + "\n"); return }
      try {
        state.cfg = switchModel(state.cfg, arg)
        saveConfig(state.cfg)
        process.stdout.write(renderNotice(`active model → ${arg}`, "ok") + "\n")
      } catch (e) { process.stdout.write(renderNotice((e as Error).message, "err") + "\n") }
      return
    }
    case "add": {
      if (!arg) { process.stdout.write(renderNotice("usage: /add <id>", "warn") + "\n"); return }
      try {
        state.cfg = addModel(state.cfg, arg)
        saveConfig(state.cfg)
        process.stdout.write(renderNotice(`added model preset "${arg}"`, "ok") + "\n")
      } catch (e) { process.stdout.write(renderNotice((e as Error).message, "err") + "\n") }
      return
    }
    case "rm": case "remove": {
      if (!arg) { process.stdout.write(renderNotice("usage: /rm <id>", "warn") + "\n"); return }
      try {
        state.cfg = removeModel(state.cfg, arg)
        saveConfig(state.cfg)
        process.stdout.write(renderNotice(`removed model preset "${arg}"`, "ok") + "\n")
      } catch (e) { process.stdout.write(renderNotice((e as Error).message, "err") + "\n") }
      return
    }
    case "tools": {
      process.stdout.write(COLOR.brand("tools") + COLOR.muted("  (model can call these)") + "\n")
      for (const t of TOOLS) {
        const perm = t.requiresPermission ? COLOR.warn(" [perm]") : ""
        process.stdout.write(`  ${COLOR.brand(t.name.padEnd(14))} ${COLOR.muted(t.description.slice(0, 60))}${perm}\n`)
      }
      return
    }
    case "sessions": case "history": {
      const list = listSessions()
      if (list.length === 0) {
        process.stdout.write(renderNotice("no saved sessions yet", "info") + "\n")
        return
      }
      for (const s of list) {
        process.stdout.write(`  ${COLOR.brand(s.id)}  ${COLOR.muted(new Date(s.ts).toISOString().slice(0, 19))}  ${s.model}  ${s.msgCount} msgs\n`)
      }
      return
    }
    case "resume": {
      if (!arg) { process.stdout.write(renderNotice("usage: /resume <id>", "warn") + "\n"); return }
      try {
        const sess = loadSession(arg)
        state.history = sess.history
        state.sessionId = arg
        process.stdout.write(renderNotice(`resumed ${arg} (${state.history.length} messages)`, "ok") + "\n")
      } catch (e) { process.stdout.write(renderNotice((e as Error).message, "err") + "\n") }
      return
    }
    case "save": {
      try {
        saveSession(state.sessionId, state.history, state.cfg.active_model_id)
        process.stdout.write(renderNotice(`saved as ${state.sessionId}`, "ok") + "\n")
      } catch (e) { process.stdout.write(renderNotice((e as Error).message, "err") + "\n") }
      return
    }
    case "cost": case "tokens": {
      const used = state.history.reduce((a, m) => a + (m.content.length / 4), 0)
      process.stdout.write(renderNotice(`~${Math.ceil(used)} tokens in conversation so far`, "info") + "\n")
      return
    }
    case "cwd": {
      process.stdout.write(state.cwd + "\n")
      return
    }
    case "cd": {
      if (!arg) { process.stdout.write(renderNotice("usage: /cd <dir>", "warn") + "\n"); return }
      try {
        process.chdir(arg)
        state.cwd = process.cwd()
        state.projectHint = detectProject(state.cwd)
        process.stdout.write(renderNotice("cwd → " + state.cwd + (state.projectHint ? "  (" + state.projectHint + ")" : ""), "ok") + "\n")
      } catch (e) { process.stdout.write(renderNotice((e as Error).message, "err") + "\n") }
      return
    }
    case "ls": case "dir": {
      const { list_dir } = await import("./tools/list_dir.js")
      const r = await list_dir.run({ path: state.cwd }, { cwd: state.cwd, todo: state.todo, askPermission: async () => true })
      process.stdout.write(r.output + "\n")
      return
    }
    case "doctor": case "ping": case "test": {
      await runDoctor(state.cfg)
      return
    }
    case "show": {
      process.stdout.write(JSON.stringify(state.cfg, null, 2) + "\n")
      return
    }
    default:
      process.stdout.write(renderNotice(`unknown command: /${cmd} — try /help`, "warn") + "\n")
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

async function runDoctor(cfg: Config): Promise<void> {
  const m = activeModel(cfg)
  process.stdout.write(COLOR.brand("doctor") + COLOR.muted(` — testing ${cfg.api_url}`) + "\n")
  process.stdout.write(COLOR.muted("  model: " + m.model + "\n"))
  process.stdout.write(COLOR.muted("  api_key: " + (cfg.api_key ? cfg.api_key.slice(0, 4) + "…" + cfg.api_key.slice(-4) : "(empty)") + "\n"))
  process.stdout.write(COLOR.muted("  headers: " + (cfg.headers.length ? cfg.headers.map((h) => h.key).join(", ") : "(none)") + "\n"))
  process.stdout.write("\n")
  const spinner = new Spinner("sending probe")
  spinner.start()
  const t0 = Date.now()
  try {
    const { streamChat } = await import("./api/client.js")
    await new Promise<void>((resolve) => {
      streamChat(cfg, m, [
        { role: "system", content: "Reply with exactly: OK" },
        { role: "user", content: "ping" },
      ], null, {
        onDelta: () => {},
        onDone: (full) => {
          spinner.stop()
          const ms = Date.now() - t0
          process.stdout.write(renderNotice(`OK in ${ms}ms — reply: "${full.slice(0, 80)}"`, "ok") + "\n")
          resolve()
        },
        onError: (e) => {
          spinner.stop()
          process.stdout.write(renderNotice(`FAIL: ${e.message.slice(0, 200)}`, "err") + "\n")
          resolve()
        },
      })
    })
  } catch (e) {
    spinner.stop()
    process.stdout.write(renderNotice(`FAIL: ${(e as Error).message}`, "err") + "\n")
  }
}
