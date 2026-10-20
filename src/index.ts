#!/usr/bin/env node
// IBR cli — v2.0 entry point

import { loadConfig, saveConfig, configPath, addModel, removeModel, switchModel, login, setField } from "./config/store.js"
import { COLOR, printBanner } from "./ui/theme.js"
import { isTTY, renderNotice } from "./ui/render.js"
import { startChat } from "./chat.js"

const VERSION = "2.0.0"

const USAGE = `
${COLOR.brand("IBR cli")} ${COLOR.muted("v" + VERSION)}

${COLOR.brand("Quick start:")}
  ibrcli login <api_url> <api_key> <model>     one-line setup (recommended)
  ibrcli                                        start chatting
  ibrcli doctor                                 test API connection

${COLOR.brand("Example:")}
  ibrcli login https://integrate.api.nvidia.com/v1 nvapi-xxx z-ai/glm-5.3
  ibrcli

${COLOR.brand("Commands:")}
  ibrcli                  start chat (interactive)
  ibrcli chat             same as above
  ibrcli login <url> <key> [model]   one-shot setup — sets api_url, api_key, switches/creates model preset
  ibrcli set <field> <value>         set any config field (e.g. set api_key xxx, set gen.temperature 0.5)
  ibrcli config          interactive config editor
  ibrcli init            write default config to ~/.ibr/config.json
  ibrcli show            print current config as JSON
  ibrcli path            print config file path
  ibrcli models          list model presets
  ibrcli add <id>        add a new model preset
  ibrcli rm <id>         remove a model preset
  ibrcli switch <id>     switch active model preset
  ibrcli sessions        list saved sessions
  ibrcli resume <id>     resume a saved session
  ibrcli tools           list available tools
  ibrcli doctor          test API connection
  ibrcli run "<prompt>"   one-shot prompt to completion
  ibrcli --help | -h     this message
  ibrcli --version | -v  version

${COLOR.brand("Slash commands inside chat:")}
  /help /quit /clear /config /models /switch /add /rm
  /tools /sessions /resume /save /cost /cwd /cd /ls /doctor /show

${COLOR.brand("Config file:")}
  ~/.ibr/config.json  ${COLOR.muted("(set IBR_CONFIG_DIR to override)")}

${COLOR.brand("Env vars:")}
  IBR_API_URL, IBR_API_KEY, IBR_API_PATH, IBR_MODEL
  NO_COLOR, FORCE_COLOR
`

function applyEnvOverrides(cfg: ReturnType<typeof loadConfig>) {
  if (process.env.IBR_API_URL) cfg.api_url = process.env.IBR_API_URL
  if (process.env.IBR_API_KEY) cfg.api_key = process.env.IBR_API_KEY
  if (process.env.IBR_API_PATH) cfg.api_path = process.env.IBR_API_PATH
  if (process.env.IBR_MODEL && cfg.models.find((m) => m.id === process.env.IBR_MODEL)) {
    cfg.active_model_id = process.env.IBR_MODEL!
  }
  return cfg
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const cmd = argv[0] || "chat"

  switch (cmd) {
    case "-h":
    case "--help":
    case "help":
      process.stdout.write(USAGE + "\n")
      process.exit(0)
    case "-v":
    case "--version":
      process.stdout.write(`ibrcli ${VERSION}\n`)
      process.exit(0)
    case "init":
      saveConfig(loadConfig())
      process.stdout.write(renderNotice("config ready at " + configPath(), "ok") + "\n")
      process.exit(0)
    case "path":
      process.stdout.write(configPath() + "\n")
      process.exit(0)
    case "login": {
      const url = argv[1]
      const key = argv[2]
      const model = argv[3]
      if (!url || !key || !model) {
        process.stderr.write(`usage: ibrcli login <api_url> <api_key> <model>\n`)
        process.stderr.write(`example: ibrcli login https://integrate.api.nvidia.com/v1 nvapi-xxx z-ai/glm-5.3\n`)
        process.exit(2)
      }
      const cfg = loadConfig()
      const next = login(cfg, url, key, model)
      saveConfig(next)
      process.stdout.write(renderNotice(`logged in → ${url}`, "ok") + "\n")
      process.stdout.write(renderNotice(`active model: ${next.active_model_id} (${model})`, "ok") + "\n")
      process.stdout.write(COLOR.muted("  config saved to " + configPath()) + "\n")
      process.stdout.write(COLOR.muted("  run `ibrcli` to start chatting\n"))
      process.exit(0)
    }
    case "set": {
      const field = argv[1]
      const value = argv.slice(2).join(" ")
      if (!field || !value) {
        process.stderr.write(`usage: ibrcli set <field> <value>\n`)
        process.stderr.write(`examples:\n`)
        process.stderr.write(`  ibrcli set api_key nvapi-xxx\n`)
        process.stderr.write(`  ibrcli set api_url https://integrate.api.nvidia.com/v1\n`)
        process.stderr.write(`  ibrcli set gen.temperature 0.5\n`)
        process.stderr.write(`  ibrcli set stream false\n`)
        process.exit(2)
      }
      try {
        const cfg = loadConfig()
        const next = setField(cfg, field, value)
        saveConfig(next)
        process.stdout.write(renderNotice(`set ${field} = ${value}`, "ok") + "\n")
        process.exit(0)
      } catch (e) {
        process.stderr.write(`error: ${(e as Error).message}\n`)
        process.exit(1)
      }
    }
    case "show": {
      const cfg = applyEnvOverrides(loadConfig())
      process.stdout.write(JSON.stringify(cfg, null, 2) + "\n")
      process.exit(0)
    }
    case "tools": {
      const { TOOLS } = await import("./tools/index.js")
      process.stdout.write(COLOR.brand("IBR cli tools") + COLOR.muted(" — model can call these") + "\n\n")
      for (const t of TOOLS) {
        const perm = t.requiresPermission ? "  [perm]" : ""
        process.stdout.write(`  ${COLOR.brand(t.name.padEnd(14))} ${COLOR.muted(t.description.slice(0, 64))}${perm}\n`)
      }
      process.exit(0)
    }
    case "sessions": {
      const { listSessions } = await import("./sessions/store.js")
      const list = listSessions()
      if (list.length === 0) {
        process.stdout.write(renderNotice("no saved sessions", "info") + "\n")
      } else {
        for (const s of list) {
          process.stdout.write(`  ${COLOR.brand(s.id.padEnd(28))}  ${new Date(s.ts).toISOString().slice(0, 19)}  ${s.model.padEnd(20)}  ${s.msgCount} msgs\n`)
        }
      }
      process.exit(0)
    }
    case "resume": {
      const id = argv[1]
      if (!id) { process.stderr.write("usage: ibrcli resume <session-id>\n"); process.exit(2) }
      process.argv.push("--resume", id)  // pass to chat loop
      // fall through to chat
    }
    case "config":
    case "cfg": {
      if (!isTTY()) {
        process.stderr.write("ibrcli config needs an interactive terminal. Use `ibrcli set <field> <value>` instead.\n")
        process.exit(1)
      }
      const cfg = applyEnvOverrides(loadConfig())
      const { openConfigEditor } = await import("./config-editor.js")
      // create a shared readLine for the editor
      const readline = await import("node:readline/promises")
      const { stdin, stdout } = await import("node:process")
      const readLine = (prompt: string) => new Promise<string | null>((resolve) => {
        const rl = readline.createInterface({ input: stdin, output: stdout, prompt, terminal: isTTY() })
        rl.prompt()
        let done = false
        const finish = (v: string | null) => {
          if (done) return
          done = true
          rl.close()
          resolve(v)
        }
        rl.on("line", (l) => finish(l))
        rl.on("close", () => finish(null))
        rl.on("SIGINT", () => finish(null))
      })
      await openConfigEditor(cfg, readLine)
      saveConfig(cfg)
      process.stdout.write(renderNotice("config saved to " + configPath(), "ok") + "\n")
      process.exit(0)
    }
    case "doctor": {
      const cfg = applyEnvOverrides(loadConfig())
      await runDoctor(cfg)
      process.exit(0)
    }
    case "models":
    case "list": {
      const cfg = applyEnvOverrides(loadConfig())
      for (const m of cfg.models) {
        const mark = m.id === cfg.active_model_id ? "* " : "  "
        process.stdout.write(COLOR.brand(mark + m.id.padEnd(16)) + " " + m.model.padEnd(28) + " " + m.context_window + " tokens\n")
      }
      process.exit(0)
    }
    case "add": {
      const id = argv[1]
      if (!id) { process.stderr.write("usage: ibrcli add <id>\n"); process.exit(2) }
      const cfg = loadConfig()
      const next = addModel(cfg, id)
      saveConfig(next)
      process.stdout.write(renderNotice(`added model preset "${id}"`, "ok") + "\n")
      process.exit(0)
    }
    case "rm":
    case "remove": {
      const id = argv[1]
      if (!id) { process.stderr.write("usage: ibrcli rm <id>\n"); process.exit(2) }
      const cfg = loadConfig()
      const next = removeModel(cfg, id)
      saveConfig(next)
      process.stdout.write(renderNotice(`removed model preset "${id}"`, "ok") + "\n")
      process.exit(0)
    }
    case "switch":
    case "model": {
      const id = argv[1]
      if (!id) { process.stderr.write("usage: ibrcli switch <id>\n"); process.exit(2) }
      const cfg = loadConfig()
      const next = switchModel(cfg, id)
      saveConfig(next)
      process.stdout.write(renderNotice(`active model → ${id}`, "ok") + "\n")
      process.exit(0)
    }
    case "run": {
      const prompt = argv.slice(1).join(" ")
      if (!prompt) { process.stderr.write('usage: ibrcli run "your prompt"\n'); process.exit(2) }
      const cfg = applyEnvOverrides(loadConfig())
      const model = cfg.models.find((m) => m.id === cfg.active_model_id) || cfg.models[0]
      const sys = model.system_prompt || cfg.system_prompt
      const { streamChat } = await import("./api/client.js")
      const { StreamingLine } = await import("./ui/render.js")
      const stream = new StreamingLine()
      await new Promise<void>((resolve) => {
        streamChat(cfg, model, [
          { role: "system", content: sys },
          { role: "user", content: prompt },
        ], null, {
          onDelta: (d) => stream.append(d),
          onDone: () => { stream.finish(); resolve() },
          onError: (e) => {
            process.stderr.write("\nError: " + e.message + "\n")
            resolve()
          },
        })
      })
      process.exit(0)
    }
    case "chat":
      if (!isTTY()) {
        // Non-interactive: read stdin and treat as a single prompt
        const chunks: Buffer[] = []
        for await (const c of process.stdin) chunks.push(c as Buffer)
        const text = Buffer.concat(chunks).toString("utf8").trim()
        if (!text) { process.stderr.write("ibrcli: stdin empty and not a TTY\n"); process.exit(1) }
        const cfg = applyEnvOverrides(loadConfig())
        const model = cfg.models.find((m) => m.id === cfg.active_model_id) || cfg.models[0]
        const sys = model.system_prompt || cfg.system_prompt
        const { streamChat } = await import("./api/client.js")
        const { StreamingLine } = await import("./ui/render.js")
        const stream = new StreamingLine()
        await new Promise<void>((resolve) => {
          streamChat(cfg, model, [
            { role: "system", content: sys },
            { role: "user", content: text },
          ], null, {
            onDelta: (d) => stream.append(d),
            onDone: () => { stream.finish(); resolve() },
            onError: (e) => { process.stderr.write("\nError: " + e.message + "\n"); resolve() },
          })
        })
        process.exit(0)
      }
      await startChat()
      process.exit(0)
    default:
      process.stderr.write(`ibrcli: unknown command "${cmd}"\n${USAGE}\n`)
      process.exit(2)
  }
}

async function runDoctor(cfg: ReturnType<typeof loadConfig>): Promise<void> {
  const m = cfg.models.find((x) => x.id === cfg.active_model_id) || cfg.models[0]
  process.stdout.write(COLOR.brand("ibrcli doctor") + COLOR.muted(` — testing ${cfg.api_url}`) + "\n")
  process.stdout.write(COLOR.muted("  model:    " + m.model + "\n"))
  process.stdout.write(COLOR.muted("  api_key:  " + (cfg.api_key ? cfg.api_key.slice(0, 6) + "…" + cfg.api_key.slice(-4) : "(empty — set with `ibrcli login <url> <key> <model>` or `ibrcli set api_key <key>`)") + "\n"))
  process.stdout.write(COLOR.muted("  headers:  " + (cfg.headers.length ? cfg.headers.map((h) => h.key).join(", ") : "(none)") + "\n"))
  process.stdout.write("\n")
  const { Spinner } = await import("./ui/render.js")
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

main().catch((e) => {
  process.stderr.write("ibrcli: " + (e as Error).message + "\n")
  process.exit(1)
})
