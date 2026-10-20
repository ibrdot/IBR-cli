// IBR cli — interactive config editor (v2: uses shared readLine so no double-echo bug)

import { BOX, COLOR } from "./ui/theme.js"
import { renderNotice, termWidth } from "./ui/render.js"
import type { Config, ExtraHeader, GenParams, ModelPreset } from "./config/schema.js"
import { DEFAULT_GEN } from "./config/schema.js"

type ReadLineFn = (prompt: string) => Promise<string | null>

function fmt(v: unknown): string {
  if (typeof v === "string") return v.length ? v : "(empty)"
  if (v === null) return "(null)"
  return String(v)
}

function printMenu(cfg: Config): void {
  process.stdout.write("\r\x1b[K")
  process.stdout.write(COLOR.brand("IBR config") + COLOR.muted(" — edit any field by number  (s=save  q=cancel)") + "\n\n")
  const items: [string, string, string][] = [
    [" 1", "API URL", cfg.api_url],
    [" 2", "API Key", mask(cfg.api_key)],
    [" 3", "API path", cfg.api_path],
    [" 4", "System prompt (default)", cfg.system_prompt.slice(0, 60) + (cfg.system_prompt.length > 60 ? "…" : "")],
    [" 5", "Context window (default)", String(cfg.context_window) + " tokens"],
    [" 6", "Theme", cfg.theme],
    [" 7", "Stream", String(cfg.stream)],
    [" 8", "Request timeout", cfg.request_timeout_ms + " ms"],
    [" 9", "Generation params", `${cfg.gen.temperature} / ${fmt(cfg.gen.max_tokens)} / ${cfg.gen.top_p} / ${cfg.gen.frequency_penalty} / ${cfg.gen.presence_penalty}`],
    ["10", "Extra headers", cfg.headers.length ? cfg.headers.map((h) => h.key).join(", ") : "(none)"],
    ["11", "Model presets", cfg.models.map((m) => m.id).join(", ")],
    ["12", "Active model", cfg.active_model_id],
    [" s", "Save & exit", ""],
    [" q", "Quit without saving", ""],
  ]
  for (const [n, label, value] of items) {
    process.stdout.write(COLOR.brand(n.padEnd(4)) + " " + COLOR.user(label.padEnd(32)) + COLOR.assistant(fmt(value)) + "\n")
  }
  process.stdout.write("\n")
}

function mask(key: string): string {
  if (!key) return "(empty)"
  if (key.length <= 8) return "*".repeat(key.length)
  return key.slice(0, 4) + "…" + key.slice(-4)
}

export async function openConfigEditor(cfg: Config, readLine: ReadLineFn): Promise<void> {
  const working: Config = JSON.parse(JSON.stringify(cfg))
  let dirty = false

  while (true) {
    printMenu(working)
    const ansRaw = await readLine(COLOR.prompt("choose> "))
    if (ansRaw === null) {  // Ctrl+D / Ctrl+C
      if (dirty) process.stdout.write(renderNotice("changes discarded", "warn") + "\n")
      return
    }
    const ans = ansRaw.trim().toLowerCase()
    if (ans === "q") {
      if (dirty) process.stdout.write(renderNotice("changes discarded", "warn") + "\n")
      return
    }
    if (ans === "s") {
      Object.assign(cfg, working)
      return
    }

    try {
      switch (ans) {
        case "1": {
          const v = await ask(readLine, "API URL", working.api_url)
          if (v !== null) { working.api_url = v; dirty = true }
          break
        }
        case "2": {
          const v = await ask(readLine, "API Key (blank to keep current)", "")
          if (v !== null && v) { working.api_key = v; dirty = true }
          break
        }
        case "3": {
          const v = await ask(readLine, "API path (e.g. /chat/completions)", working.api_path)
          if (v !== null) { working.api_path = v; dirty = true }
          break
        }
        case "4": {
          const v = await ask(readLine, "System prompt (default)", working.system_prompt)
          if (v !== null) { working.system_prompt = v; dirty = true }
          break
        }
        case "5": {
          const vRaw = await ask(readLine, "Context window (tokens)", String(working.context_window))
          if (vRaw === null) break
          const v = parseInt(vRaw, 10)
          if (!Number.isFinite(v) || v < 1) throw new Error("must be a positive integer")
          working.context_window = v; dirty = true
          break
        }
        case "6": {
          const v = await ask(readLine, "Theme (dark|light|midnight|solar)", working.theme)
          if (v !== null) { working.theme = v; dirty = true }
          break
        }
        case "7": {
          const vRaw = await ask(readLine, "Stream (y/n)", working.stream ? "y" : "n")
          if (vRaw === null) break
          working.stream = vRaw.toLowerCase().startsWith("y"); dirty = true
          break
        }
        case "8": {
          const vRaw = await ask(readLine, "Request timeout ms", String(working.request_timeout_ms))
          if (vRaw === null) break
          const v = parseInt(vRaw, 10)
          if (!Number.isFinite(v) || v < 1000) throw new Error("must be >= 1000ms")
          working.request_timeout_ms = v; dirty = true
          break
        }
        case "9": {
          await editGen(readLine, working.gen)
          dirty = true; break
        }
        case "10": {
          await editHeaders(readLine, working)
          dirty = true; break
        }
        case "11": {
          await editModels(readLine, working)
          dirty = true; break
        }
        case "12": {
          const v = await ask(readLine, `Active model id (${working.models.map((m) => m.id).join(", ")})`, working.active_model_id)
          if (v === null) break
          if (!working.models.find((m) => m.id === v)) throw new Error(`unknown model id: ${v}`)
          working.active_model_id = v; dirty = true
          break
        }
        default:
          process.stdout.write(renderNotice("invalid choice", "warn") + "\n")
      }
    } catch (e) {
      process.stdout.write(renderNotice((e as Error).message, "err") + "\n")
    }
  }
}

async function ask(readLine: ReadLineFn, label: string, def: string): Promise<string | null> {
  const defHint = def ? COLOR.muted(` [${def}]`) : ""
  const v = await readLine(COLOR.user(label + ":") + defHint + " ")
  if (v === null) return null
  const t = v.trim()
  return t.length ? t : def
}

async function editGen(readLine: ReadLineFn, gen: GenParams): Promise<void> {
  process.stdout.write(COLOR.brand("Generation params") + COLOR.muted(" (Enter to keep current value)") + "\n")
  const tempRaw = await ask(readLine, "temperature (0..2)", String(gen.temperature))
  if (tempRaw === null) return
  const temp = parseFloat(tempRaw)
  if (Number.isFinite(temp) && temp >= 0 && temp <= 2) gen.temperature = temp

  const mtRaw = await ask(readLine, "max_tokens (blank=null)", gen.max_tokens === null ? "" : String(gen.max_tokens))
  if (mtRaw !== null) {
    if (mtRaw === "") gen.max_tokens = null
    else {
      const mt = parseInt(mtRaw, 10)
      if (Number.isFinite(mt) && mt > 0) gen.max_tokens = mt
    }
  }

  const tpRaw = await ask(readLine, "top_p (0..1)", String(gen.top_p))
  if (tpRaw !== null) {
    const tp = parseFloat(tpRaw)
    if (Number.isFinite(tp) && tp >= 0 && tp <= 1) gen.top_p = tp
  }

  const fpRaw = await ask(readLine, "frequency_penalty (-2..2)", String(gen.frequency_penalty))
  if (fpRaw !== null) {
    const fp = parseFloat(fpRaw)
    if (Number.isFinite(fp) && fp >= -2 && fp <= 2) gen.frequency_penalty = fp
  }

  const ppRaw = await ask(readLine, "presence_penalty (-2..2)", String(gen.presence_penalty))
  if (ppRaw !== null) {
    const pp = parseFloat(ppRaw)
    if (Number.isFinite(pp) && pp >= -2 && pp <= 2) gen.presence_penalty = pp
  }
}

async function editHeaders(readLine: ReadLineFn, cfg: Config): Promise<void> {
  process.stdout.write(COLOR.brand("Extra headers") + COLOR.muted(" (blank key to finish)") + "\n")
  const out: ExtraHeader[] = []
  while (true) {
    const k = await ask(readLine, "header key", "")
    if (k === null || k === "") break
    const v = await ask(readLine, "header value", "")
    if (v !== null && v !== "") out.push({ key: k, value: v })
  }
  cfg.headers = out
}

async function editModels(readLine: ReadLineFn, cfg: Config): Promise<void> {
  process.stdout.write(COLOR.brand("Model presets") + COLOR.muted(" (blank id to finish)") + "\n")
  const out: ModelPreset[] = []
  let i = 0
  while (true) {
    const id = await ask(readLine, `preset #${i + 1} id`, "")
    if (id === null || id === "") break
    const model = await ask(readLine, "model id (sent to API)", id) || id
    const cwRaw = await ask(readLine, "context window (tokens)", String(cfg.context_window))
    const cw = cwRaw ? parseInt(cwRaw, 10) || cfg.context_window : cfg.context_window
    const sp = await ask(readLine, "system prompt (blank = use default)", "") || ""
    const gen: GenParams = { ...DEFAULT_GEN, ...cfg.gen }
    await editGen(readLine, gen)
    out.push({ id, model, context_window: cw, system_prompt: sp, gen })
    i++
  }
  if (out.length === 0) throw new Error("need at least one model preset")
  cfg.models = out
  cfg.active_model_id = out[0].id
}
