// IBR cli — config schema & types
// Every field here is user-editable via `ibrcli config` (TUI) or by editing
// ~/.ibr/config.json directly. There are NO built-in providers — only the
// custom API the user supplies.
export const DEFAULT_GEN = {
    temperature: 0.7,
    max_tokens: null,
    top_p: 1,
    frequency_penalty: 0,
    presence_penalty: 0,
};
export const DEFAULT_CONFIG = {
    api_url: "https://api.openai.com/v1",
    api_key: "",
    api_path: "/chat/completions",
    system_prompt: "You are IBR, a helpful assistant running inside the user's terminal. Be concise and accurate.",
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
};
export function validateConfig(c) {
    if (typeof c !== "object" || c === null) {
        throw new Error("config: expected an object");
    }
    const o = c;
    const merged = { ...DEFAULT_CONFIG, ...o };
    // merge nested gen so missing fields fall back
    merged.gen = { ...DEFAULT_GEN, ...(o.gen || {}) };
    if (!Array.isArray(merged.models) || merged.models.length === 0) {
        merged.models = DEFAULT_CONFIG.models;
    }
    if (!merged.models.find((m) => m.id === merged.active_model_id)) {
        merged.active_model_id = merged.models[0].id;
    }
    // per-model gen fallback
    merged.models = merged.models.map((m) => ({
        ...m,
        gen: { ...DEFAULT_GEN, ...m.gen },
    }));
    if (typeof merged.api_key !== "string" || merged.api_key === "") {
        // leave empty — runtime will warn, do not throw
    }
    return merged;
}
