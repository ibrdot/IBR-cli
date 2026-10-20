// IBR cli — config store (load/save ~/.ibr/config.json)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { DEFAULT_CONFIG, validateConfig } from "./schema.js";
export function configDir() {
    const base = process.env.IBR_CONFIG_DIR || process.env.XDG_CONFIG_HOME || homedir();
    return join(base, ".ibr");
}
export function configPath() {
    return join(configDir(), "config.json");
}
export function loadConfig() {
    const p = configPath();
    if (!existsSync(p)) {
        saveConfig(DEFAULT_CONFIG);
        return { ...DEFAULT_CONFIG };
    }
    try {
        const raw = readFileSync(p, "utf8");
        const parsed = JSON.parse(raw);
        return validateConfig(parsed);
    }
    catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        throw new Error(`Failed to parse config at ${p}\nReason: ${reason}\nFix with: ibr config`);
    }
}
export function saveConfig(c) {
    const p = configPath();
    try {
        mkdirSync(dirname(p), { recursive: true });
        writeFileSync(p, JSON.stringify(c, null, 2) + "\n", { mode: 0o600 });
    }
    catch (err) {
        // best-effort: warn but don't crash
        const reason = err instanceof Error ? err.message : String(err);
        process.stderr.write(`ibr: could not save config to ${p}: ${reason}\n`);
    }
}
export function activeModel(c) {
    const m = c.models.find((x) => x.id === c.active_model_id) || c.models[0];
    return m;
}
export function switchModel(c, id) {
    if (!c.models.find((m) => m.id === id)) {
        throw new Error(`No model preset with id "${id}". Available: ${c.models.map((m) => m.id).join(", ")}`);
    }
    return { ...c, active_model_id: id };
}
export function addModel(c, id) {
    if (c.models.find((m) => m.id === id)) {
        throw new Error(`Model preset "${id}" already exists`);
    }
    const newModel = {
        id,
        model: id,
        context_window: c.context_window,
        system_prompt: "",
        gen: { ...c.gen },
    };
    return { ...c, models: [...c.models, newModel], active_model_id: id };
}
export function removeModel(c, id) {
    if (c.models.length <= 1) {
        throw new Error("Refusing to remove the last model preset");
    }
    const models = c.models.filter((m) => m.id !== id);
    const active_model_id = c.active_model_id === id ? models[0].id : c.active_model_id;
    return { ...c, models, active_model_id };
}
