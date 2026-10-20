// IBR cli — config schema & types
// Every field here is user-editable via `ibrcli config` (TUI) or by editing
// ~/.ibr/config.json directly. There are NO built-in providers — only the
// custom API the user supplies.

export interface GenParams {
  temperature: number      // 0..2
  max_tokens: number | null // null = let server decide
  top_p: number            // 0..1
  frequency_penalty: number
  presence_penalty: number
}

export interface ModelPreset {
  id: string               // short name shown in /switch, e.g. "fast"
  model: string            // model id sent to API, e.g. "gpt-4o-mini"
  context_window: number   // token budget for history trimming
  system_prompt: string    // per-preset system prompt (overrides global if non-empty)
  gen: GenParams           // per-preset generation params
}

export interface ExtraHeader {
  key: string
  value: string
}

export interface Config {
  // Custom API connection (only provider — no built-ins)
  api_url: string          // base URL, e.g. https://api.openai.com/v1
  api_key: string          // bearer token
  // Default request path appended to api_url. Default "/chat/completions".
  // Power users can swap to "/responses" or a vendor-specific path.
  api_path: string
  // Default system prompt (used when a preset has empty system_prompt)
  system_prompt: string
  // Default context window (tokens) for presets that omit it
  context_window: number
  // Default generation params (presets inherit then override)
  gen: GenParams
  // Extra HTTP headers sent on every request
  headers: ExtraHeader[]
  // Model presets. The first one is the default.
  models: ModelPreset[]
  // Active model preset id
  active_model_id: string
  // Optional request timeout (ms)
  request_timeout_ms: number
  // Whether to stream SSE responses
  stream: boolean
  // UI theme: "dark" | "light" | "midnight" | "solar"
  theme: string
}

export const DEFAULT_GEN: GenParams = {
  temperature: 0.7,
  max_tokens: null,
  top_p: 1,
  frequency_penalty: 0,
  presence_penalty: 0,
}

export const DEFAULT_CONFIG: Config = {
  api_url: "https://api.openai.com/v1",
  api_key: "",
  api_path: "/chat/completions",
  system_prompt:
    "You are IBR, a helpful assistant running inside the user's terminal. Be concise and accurate.",
  context_window: 128000,
  gen: { ...DEFAULT_GEN },
  headers: [],
  models: [
    {
      id: "default",
      model: "gpt-4o-mini",
      context_window: 128000,
      system_prompt: "",
      gen: { ...DEFAULT_GEN },
    },
  ],
  active_model_id: "default",
  request_timeout_ms: 120000,
  stream: true,
  theme: "midnight",
}

export function validateConfig(c: unknown): Config {
  if (typeof c !== "object" || c === null) {
    throw new Error("config: expected an object")
  }
  const o = c as Record<string, unknown>
  const merged: Config = { ...DEFAULT_CONFIG, ...(o as Partial<Config>) }
  // merge nested gen so missing fields fall back
  merged.gen = { ...DEFAULT_GEN, ...(o.gen as Partial<GenParams> || {}) }
  if (!Array.isArray(merged.models) || merged.models.length === 0) {
    merged.models = DEFAULT_CONFIG.models
  }
  if (!merged.models.find((m) => m.id === merged.active_model_id)) {
    merged.active_model_id = merged.models[0].id
  }
  // per-model gen fallback
  merged.models = merged.models.map((m) => ({
    ...m,
    gen: { ...DEFAULT_GEN, ...m.gen },
  }))
  if (typeof merged.api_key !== "string" || merged.api_key === "") {
    // leave empty — runtime will warn, do not throw
  }
  return merged
}
