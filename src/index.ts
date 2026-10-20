#!/usr/bin/env node
// IBR cli — entry point

import { loadConfig, saveConfig, configPath, addModel, removeModel, switchModel } from "./config/store.js"
import { COLOR, printBanner } from "./ui/theme.js"
import { isTTY, renderNotice } from "./ui/render.js"
import { startChat } from "./chat.js"
import { openConfigEditor } from "./config-editor.js"

const USAGE = `
${COLOR.brand("IBR cli")} ${COLOR.muted("v1.0")}

${COLOR.brand("Usage:")}
  ibr                    start chat (interactive)
  ibr chat               same as above
  ibr config             interactive config editor
  ibr init               write default config to ~/.ibr/config.json
  ibr show               print current config as JSON
  ibr path               print config file path
  ibr models             list model presets
  ibr add <id>           add a new model preset
  ibr rm <id>            remove a model preset
 ibr switch <id>         switch active model preset
  ibr run "<prompt>"     one-shot prompt to completion (no chat)
  ibr --help | -h        this message
  ibr --version | -v     version

${COLOR.brand("Slash commands inside chat:")}
  /help /quit /clear /config /models /switch /add /rm /cost /show

${COLOR.brand("Config file:")}
  ~/.ibr/config.json  ${COLOR.muted("(set IBR_CONFIG_DIR to override)")}

${COLOR.brand("Env vars:")}
  IBR_API_URL           override api_url
  IBR_API_KEY           override api_key
  IBR_API_PATH          override api_path
  IBR_MODEL             override active model preset id
  NO_COLOR              disable ANSI colors
  FORCE_COLOR           force color level (0/1/2/3)
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
      process.stdout.write("ibr 1.0.0\n")
      process.exit(0)
    case "init":
      saveConfig(loadConfig())
      process.stdout.write(renderNotice("config ready at " + configPath(), "ok") + "\n")
      process.exit(0)
    case "path":
      process.stdout.write(configPath() + "\n")
      process.exit(0)
    case "show": {
      const cfg = applyEnvOverrides(loadConfig())
      process.stdout.write(JSON.stringify(cfg, null, 2) + "\n")
      process.exit(0)
    }
    case "config":
    case "cfg": {
      if (!isTTY()) {
        process.stderr.write("ibr config needs an interactive terminal.\n")
        process.exit(1)
      }
      const cfg = applyEnvOverrides(loadConfig())
      await openConfigEditor(cfg)
      saveConfig(cfg)
      process.stdout.write(renderNotice("config saved to " + configPath(), "ok") + "\n")
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
      if (!id) { process.stderr.write("usage: ibr add <id>\n"); process.exit(2) }
      const cfg = loadConfig()
      const next = addModel(cfg, id)
      saveConfig(next)
      process.stdout.write(renderNotice(`added model preset "${id}"`, "ok") + "\n")
      process.exit(0)
    }
    case "rm":
    case "remove": {
      const id = argv[1]
      if (!id) { process.stderr.write("usage: ibr rm <id>\n"); process.exit(2) }
      const cfg = loadConfig()
      const next = removeModel(cfg, id)
      saveConfig(next)
      process.stdout.write(renderNotice(`removed model preset "${id}"`, "ok") + "\n")
      process.exit(0)
    }
    case "switch":
    case "model": {
      const id = argv[1]
      if (!id) { process.stderr.write("usage: ibr switch <id>\n"); process.exit(2) }
      const cfg = loadConfig()
      const next = switchModel(cfg, id)
      saveConfig(next)
      process.stdout.write(renderNotice(`active model → ${id}`, "ok") + "\n")
      process.exit(0)
    }
    case "run": {
      const prompt = argv.slice(1).join(" ")
      if (!prompt) { process.stderr.write("usage: ibr run \"your prompt\"\n"); process.exit(2) }
      const cfg = applyEnvOverrides(loadConfig())
      const model = cfg.models.find((m) => m.id === cfg.active_model_id) || cfg.models[0]
      const sys = model.system_prompt || cfg.system_prompt
      const messages = [
        { role: "system" as const, content: sys },
        { role: "user" as const, content: prompt },
      ]
      const { streamChat } = await import("./api/client.js")
      const { StreamingLine } = await import("./ui/render.js")
      const stream = new StreamingLine()
      await new Promise<void>((resolve) => {
        streamChat(cfg, model, messages, {
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
        if (!text) { process.stderr.write("ibr: stdin empty and not a TTY\n"); process.exit(1) }
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
          ], {
            onDelta: (d) => stream.append(d),
            onDone: () => { stream.finish(); resolve() },
            onError: (e) => { process.stderr.write("\nError: " + e.message + "\n"); resolve() },
          })
        })
        process.exit(0)
      }
      printBanner()
      await startChat()
      process.exit(0)
    default:
      process.stderr.write(`ibr: unknown command "${cmd}"\n${USAGE}\n`)
      process.exit(2)
  }
}

main().catch((e) => {
  process.stderr.write("ibr: " + (e as Error).message + "\n")
  process.exit(1)
})
