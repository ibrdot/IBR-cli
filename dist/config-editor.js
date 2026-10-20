// IBR cli — interactive config editor
// Plain readline-based form so it works on Termux / cmd.exe / Linux / macOS.
import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { COLOR } from "./ui/theme.js";
import { isTTY, renderNotice } from "./ui/render.js";
import { DEFAULT_GEN } from "./config/schema.js";
function fmt(v) {
    if (typeof v === "string")
        return v.length ? v : "(empty)";
    if (v === null)
        return "(null)";
    return String(v);
}
function printMenu(cfg) {
    process.stdout.write("\r\x1b[K");
    process.stdout.write(COLOR.brand("IBR config") + COLOR.muted(" — edit any field by number") + "\n\n");
    const items = [
        [" 1", "API URL", cfg.api_url],
        [" 2", "API Key", mask(cfg.api_key)],
        [" 3", "API path", cfg.api_path],
        [" 4", "System prompt (default)", cfg.system_prompt.slice(0, 60) + (cfg.system_prompt.length > 60 ? "…" : "")],
        [" 5", "Context window (default)", String(cfg.context_window) + " tokens"],
        [" 6", "Theme", cfg.theme],
        [" 7", "Stream", String(cfg.stream)],
        [" 8", "Request timeout", cfg.request_timeout_ms + " ms"],
        [" 9", "Generation params (temp/max/top_p/penalties)", `${cfg.gen.temperature} / ${fmt(cfg.gen.max_tokens)} / ${cfg.gen.top_p} / ${cfg.gen.frequency_penalty} / ${cfg.gen.presence_penalty}`],
        ["10", "Extra headers", cfg.headers.length ? cfg.headers.map((h) => h.key).join(", ") : "(none)"],
        ["11", "Model presets", cfg.models.map((m) => m.id).join(", ")],
        ["12", "Active model", cfg.active_model_id],
        [" s", "Save & exit", ""],
        [" q", "Quit without saving", ""],
    ];
    for (const [n, label, value] of items) {
        process.stdout.write(COLOR.brand(n.padEnd(4)) + " " + COLOR.user(label.padEnd(40)) + COLOR.assistant(fmt(value)) + "\n");
    }
    process.stdout.write("\n");
}
function mask(key) {
    if (!key)
        return "(empty)";
    if (key.length <= 8)
        return "*".repeat(key.length);
    return key.slice(0, 4) + "…" + key.slice(-4);
}
export async function openConfigEditor(cfg) {
    const working = JSON.parse(JSON.stringify(cfg));
    let dirty = false;
    const rl = readline.createInterface({ input: stdin, output: stdout, terminal: isTTY() });
    while (true) {
        printMenu(working);
        const ans = (await rl.question(COLOR.prompt("choose> "))).trim().toLowerCase();
        if (ans === "q") {
            rl.close();
            if (dirty) {
                process.stdout.write(renderNotice("changes discarded", "warn") + "\n");
            }
            return;
        }
        if (ans === "s") {
            rl.close();
            Object.assign(cfg, working);
            return;
        }
        try {
            switch (ans) {
                case "1": {
                    const v = await ask(rl, "API URL", working.api_url);
                    working.api_url = v;
                    dirty = true;
                    break;
                }
                case "2": {
                    const v = await ask(rl, "API Key (blank to keep current)", "");
                    if (v) {
                        working.api_key = v;
                        dirty = true;
                    }
                    break;
                }
                case "3": {
                    const v = await ask(rl, "API path (e.g. /chat/completions)", working.api_path);
                    working.api_path = v;
                    dirty = true;
                    break;
                }
                case "4": {
                    const v = await ask(rl, "System prompt (default)", working.system_prompt);
                    working.system_prompt = v;
                    dirty = true;
                    break;
                }
                case "5": {
                    const v = parseInt(await ask(rl, "Context window (tokens)", String(working.context_window)), 10);
                    if (!Number.isFinite(v) || v < 1)
                        throw new Error("must be a positive integer");
                    working.context_window = v;
                    dirty = true;
                    break;
                }
                case "6": {
                    const v = await ask(rl, "Theme (dark|light|midnight|solar)", working.theme);
                    working.theme = v;
                    dirty = true;
                    break;
                }
                case "7": {
                    const v = (await ask(rl, "Stream (y/n)", working.stream ? "y" : "n")).toLowerCase().startsWith("y");
                    working.stream = v;
                    dirty = true;
                    break;
                }
                case "8": {
                    const v = parseInt(await ask(rl, "Request timeout ms", String(working.request_timeout_ms)), 10);
                    if (!Number.isFinite(v) || v < 1000)
                        throw new Error("must be >= 1000ms");
                    working.request_timeout_ms = v;
                    dirty = true;
                    break;
                }
                case "9": {
                    await editGen(rl, working.gen);
                    dirty = true;
                    break;
                }
                case "10": {
                    await editHeaders(rl, working);
                    dirty = true;
                    break;
                }
                case "11": {
                    await editModels(rl, working);
                    dirty = true;
                    break;
                }
                case "12": {
                    const v = await ask(rl, `Active model id (${working.models.map((m) => m.id).join(", ")})`, working.active_model_id);
                    if (!working.models.find((m) => m.id === v))
                        throw new Error(`unknown model id: ${v}`);
                    working.active_model_id = v;
                    dirty = true;
                    break;
                }
                default:
                    process.stdout.write(renderNotice("invalid choice", "warn") + "\n");
            }
        }
        catch (e) {
            process.stdout.write(renderNotice(e.message, "err") + "\n");
        }
    }
}
async function ask(rl, label, def) {
    const defHint = def ? COLOR.muted(` [${def}]`) : "";
    const ans = (await rl.question(COLOR.user(label + ":") + defHint + " ")).trim();
    return ans.length ? ans : def;
}
async function editGen(rl, gen) {
    process.stdout.write(COLOR.brand("Generation params") + "\n");
    const temp = parseFloat(await ask(rl, "temperature (0..2)", String(gen.temperature)));
    if (!Number.isFinite(temp) || temp < 0 || temp > 2)
        throw new Error("temperature must be 0..2");
    const mtRaw = await ask(rl, "max_tokens (blank=null)", gen.max_tokens === null ? "" : String(gen.max_tokens));
    const mt = mtRaw === "" ? null : parseInt(mtRaw, 10);
    if (mt !== null && (!Number.isFinite(mt) || mt < 1))
        throw new Error("max_tokens must be positive or blank");
    const topP = parseFloat(await ask(rl, "top_p (0..1)", String(gen.top_p)));
    if (!Number.isFinite(topP) || topP < 0 || topP > 1)
        throw new Error("top_p must be 0..1");
    const fp = parseFloat(await ask(rl, "frequency_penalty (-2..2)", String(gen.frequency_penalty)));
    if (!Number.isFinite(fp) || fp < -2 || fp > 2)
        throw new Error("out of range");
    const pp = parseFloat(await ask(rl, "presence_penalty (-2..2)", String(gen.presence_penalty)));
    if (!Number.isFinite(pp) || pp < -2 || pp > 2)
        throw new Error("out of range");
    gen.temperature = temp;
    gen.max_tokens = mt;
    gen.top_p = topP;
    gen.frequency_penalty = fp;
    gen.presence_penalty = pp;
}
async function editHeaders(rl, cfg) {
    process.stdout.write(COLOR.brand("Extra headers") + COLOR.muted(" (blank key clears row; empty menu to finish)") + "\n");
    const out = [];
    while (true) {
        const k = (await ask(rl, "header key", "")).trim();
        if (!k)
            break;
        const v = (await ask(rl, "header value", "")).trim();
        if (v)
            out.push({ key: k, value: v });
    }
    cfg.headers = out;
}
async function editModels(rl, cfg) {
    process.stdout.write(COLOR.brand("Model presets") + COLOR.muted(" (blank id to finish)") + "\n");
    const out = [];
    let i = 0;
    while (true) {
        const id = (await ask(rl, `preset #${i + 1} id`, "")).trim();
        if (!id)
            break;
        const model = (await ask(rl, "model id (sent to API)", id)).trim() || id;
        const cw = parseInt(await ask(rl, "context window (tokens)", String(cfg.context_window)), 10) || cfg.context_window;
        const sp = await ask(rl, "system prompt (blank = use default)", "");
        const gen = { ...DEFAULT_GEN, ...cfg.gen };
        await editGenInline(rl, gen);
        out.push({ id, model, context_window: cw, system_prompt: sp, gen });
        i++;
    }
    if (out.length === 0)
        throw new Error("need at least one model preset");
    cfg.models = out;
    cfg.active_model_id = out[0].id;
}
async function editGenInline(rl, gen) {
    const temp = parseFloat(await ask(rl, "  temperature", String(gen.temperature)));
    if (Number.isFinite(temp))
        gen.temperature = temp;
    const mtRaw = await ask(rl, "  max_tokens (blank=null)", gen.max_tokens === null ? "" : String(gen.max_tokens));
    if (mtRaw === "")
        gen.max_tokens = null;
    else if (Number.isFinite(parseInt(mtRaw, 10)))
        gen.max_tokens = parseInt(mtRaw, 10);
    const tp = parseFloat(await ask(rl, "  top_p", String(gen.top_p)));
    if (Number.isFinite(tp))
        gen.top_p = tp;
    const fp = parseFloat(await ask(rl, "  frequency_penalty", String(gen.frequency_penalty)));
    if (Number.isFinite(fp))
        gen.frequency_penalty = fp;
    const pp = parseFloat(await ask(rl, "  presence_penalty", String(gen.presence_penalty)));
    if (Number.isFinite(pp))
        gen.presence_penalty = pp;
}
