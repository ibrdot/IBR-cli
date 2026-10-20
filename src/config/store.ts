// IBR cli — config store (load/save ~/.ibr/config.json)

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { homedir } from "node:os"
import { DEFAULT_CONFIG, validateConfig, type Config } from "./schema.js"

export function configDir(): string {
  const base = process.env.IBR_CONFIG_DIR || process.env.XDG_CONFIG_HOME || homedir()
  return join(base, ".ibr")
}

export function configPath(): string {
  return join(configDir(), "config.json")
}

export function loadConfig(): Config {
  const p = configPath()
  if (!existsSync(p)) {
    saveConfig(DEFAULT_CONFIG)
    return { ...DEFAULT_CONFIG }
  }
  try {
    const raw = readFileSync(p, "utf8")
    const parsed = JSON.parse(raw)
    return validateConfig(parsed)
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    throw new Error(`Failed to parse config at ${p}\nReason: ${reason}\nFix with: ibr config`)
  }
}

export function saveConfig(c: Config): void {
  const p = configPath()
  try {
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, JSON.stringify(c, null, 2) + "\n", { mode: 0o600 })
  } catch (err) {
    // best-effort: warn but don't crash
    const reason = err instanceof Error ? err.message : String(err)
    process.stderr.write(`ibr: could not save config to ${p}: ${reason}\n`)
  }
}

export function activeModel(c: Config) {
  const m = c.models.find((x) => x.id === c.active_model_id) || c.models[0]
  return m
}

export function switchModel(c: Config, id: string): Config {
  if (!c.models.find((m) => m.id === id)) {
    throw new Error(`No model preset with id "${id}". Available: ${c.models.map((m) => m.id).join(", ")}`)
  }
  return { ...c, active_model_id: id }
}

export function addModel(c: Config, id: string): Config {
  if (c.models.find((m) => m.id === id)) {
    throw new Error(`Model preset "${id}" already exists`)
  }
  const newModel = {
    id,
    model: id,
    context_window: c.context_window,
    system_prompt: "",
    gen: { ...c.gen },
  }
  return { ...c, models: [...c.models, newModel], active_model_id: id }
}

export function removeModel(c: Config, id: string): Config {
  if (c.models.length <= 1) {
    throw new Error("Refusing to remove the last model preset")
  }
  const models = c.models.filter((m) => m.id !== id)
  const active_model_id = c.active_model_id === id ? models[0].id : c.active_model_id
  return { ...c, models, active_model_id }
}

/**
 * One-shot setup: set api_url + api_key, and either switch to or create a
 * model preset that sends the given `model` id to the API.
 *
 * Example: ibrcli login https://integrate.api.nvidia.com/v1 nvapi-xxx z-ai/glm-5.3
 */
export function login(c: Config, url: string, key: string, model: string): Config {
  // find a preset with this model id (or matching id), else create one
  let presetId: string
  const existing = c.models.find((m) => m.model === model || m.id === model)
  if (existing) {
    presetId = existing.id
    existing.model = model
  } else {
    // use the model id as the preset id, but sanitize
    presetId = model.replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 32) || "user"
    if (c.models.find((m) => m.id === presetId)) {
      // already exists with same id but different model id — just update
      const m = c.models.find((x) => x.id === presetId)!
      m.model = model
    } else {
      c.models = [
        ...c.models,
        {
          id: presetId,
          model,
          context_window: c.context_window,
          system_prompt: "",
          gen: { ...c.gen },
        },
      ]
    }
  }
  return {
    ...c,
    api_url: url,
    api_key: key,
    active_model_id: presetId,
  }
}

/**
 * Quick-set a top-level field by dotted path (e.g. "api_key", "gen.temperature").
 */
export function setField(c: Config, path: string, value: string): Config {
  const next: Config = JSON.parse(JSON.stringify(c))
  const parts = path.split(".")
  let target: any = next
  for (let i = 0; i < parts.length - 1; i++) {
    if (target[parts[i]] == null || typeof target[parts[i]] !== "object") {
      throw new Error(`path not found: ${path}`)
    }
    target = target[parts[i]]
  }
  const leaf = parts[parts.length - 1]
  if (!(leaf in target) && parts.length > 1) {
    throw new Error(`unknown field: ${path}`)
  }
  // type-coerce: number → Number, "true"/"false" → boolean
  let v: any = value
  if (value === "null") v = null
  else if (value === "true") v = true
  else if (value === "false") v = false
  else if (/^-?\d+(\.\d+)?$/.test(value) && parts[0] !== "api_key" && parts[0] !== "api_url") {
    v = Number(value)
  }
  target[leaf] = v
  return next
}
