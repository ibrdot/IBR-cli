#!/usr/bin/env node
// IBR cli — v2.1 entry point (provider-agnostic)
import { existsSync } from "node:fs";
import { loadConfig, saveConfig, configPath, addModel, removeModel, switchModel, login, setField, isConfigured, maskApiKey, sanitizeUrl } from "./config/store.js";
import { COLOR, printBanner } from "./ui/theme.js";
import { isTTY, renderNotice } from "./ui/render.js";
import { startChat } from "./chat.js";
const VERSION = "2.2.0";
const USAGE = `
${COLOR.brand("IBR cli")} ${COLOR.muted("v" + VERSION)}

${COLOR.brand("Quick start (first time):")}
  ibrcli login <api_url> <api_key> <model>     one-line setup (recommended)
  ibrcli                                        start chatting
  ibrcli doctor                                 test API connection

${COLOR.brand("Examples:")}
  ibrcli login https://api.openai.com/v1 sk-xxx gpt-4o-mini
  ibrcli login https://integrate.api.nvidia.com/v1 nvapi-xxx z-ai/glm-5.3
  ibrcli login https://openrouter.ai/api/v1 sk-or-xxx anthropic/claude-3.5-sonnet
  ibrcli login http://localhost:11434/v1 "" llama3.2     (local Ollama, no key)

${COLOR.brand("Or set fields individually:")}
  ibrcli set api_url <url>      e.g. https://api.openai.com/v1
  ibrcli set api_key <key>      your secret API key (never printed back)
  ibrcli set model <model_id>   e.g. gpt-4o-mini

${COLOR.brand("Commands:")}
  ibrcli                  start chat (interactive)
  ibrcli chat             same as above
  ibrcli login <url> <key> [model]   one-shot setup — sets api_url, api_key, model
  ibrcli set <field> <value>         set any config field
  ibrcli config          interactive config editor
  ibrcli init            write default config to ~/.ibr/config.json
  ibrcli show            print current config (api_key masked; use --reveal to see it)
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

${COLOR.brand("Security:")}
  API keys are stored in ~/.ibr/config.json with mode 0600 (owner-only).
  They are NEVER printed in terminal output, error messages, or logs.
  ibrcli show masks the key by default; use --reveal to view it.
`;
function applyEnvOverrides(cfg) {
    if (process.env.IBR_API_URL)
        cfg.api_url = process.env.IBR_API_URL;
    if (process.env.IBR_API_KEY)
        cfg.api_key = process.env.IBR_API_KEY;
    if (process.env.IBR_API_PATH)
        cfg.api_path = process.env.IBR_API_PATH;
    if (process.env.IBR_MODEL && cfg.models.find((m) => m.id === process.env.IBR_MODEL)) {
        cfg.active_model_id = process.env.IBR_MODEL;
    }
    return cfg;
}
// Shared readline helper — closes after one line so we don't double-listen
async function readLine(prompt) {
    const readline = await import("node:readline/promises");
    const { stdin, stdout } = await import("node:process");
    return new Promise((resolve) => {
        const rl = readline.createInterface({ input: stdin, output: stdout, prompt, terminal: isTTY() });
        rl.prompt();
        let done = false;
        const finish = (v) => {
            if (done)
                return;
            done = true;
            rl.close();
            resolve(v);
        };
        rl.on("line", (l) => finish(l));
        rl.on("close", () => finish(null));
        rl.on("SIGINT", () => finish(null));
    });
}
async function main() {
    const argv = process.argv.slice(2);
    // global flags that apply to any command
    const yoloFlags = ["--yolo", "--yes-all", "--yes-all", "--dangerously-skip-permissions", "-y"];
    const yoloRequested = argv.some((a) => yoloFlags.includes(a));
    // strip yolo flags from argv
    const filteredArgv = argv.filter((a) => !yoloFlags.includes(a));
    if (yoloRequested) {
        const cfg = loadConfig();
        cfg.bypass_permissions = true;
        saveConfig(cfg);
        process.stdout.write(COLOR.err("  !  --yolo: BYPASS PERMISSIONS enabled for this and future runs") + "\n");
        process.stdout.write(COLOR.muted("     turn off: ibrcli set bypass_permissions false  (or  /yolo off in chat)") + "\n\n");
    }
    const cmd = filteredArgv[0] || "chat";
    switch (cmd) {
        case "-h":
        case "--help":
        case "help":
            process.stdout.write(USAGE + "\n");
            process.exit(0);
        case "-v":
        case "--version":
            process.stdout.write(`ibrcli ${VERSION}\n`);
            process.exit(0);
        case "init":
            // idempotent — does NOT overwrite existing config
            if (!existsSync(configPath())) {
                saveConfig(loadConfig());
                process.stdout.write(renderNotice("config written at " + configPath(), "ok") + "\n");
                process.stdout.write(renderNotice("run `ibrcli login <url> <key> [model]` to set your API", "info") + "\n");
            }
            else {
                process.stdout.write(renderNotice("config already exists at " + configPath() + " (not overwritten)", "info") + "\n");
            }
            process.exit(0);
        case "path":
            process.stdout.write(configPath() + "\n");
            process.exit(0);
        case "login": {
            const url = filteredArgv[1];
            const key = filteredArgv[2];
            const model = filteredArgv[3];
            if (!url || !key) {
                process.stderr.write(`usage: ibrcli login <api_url> <api_key> [model]\n`);
                process.stderr.write(`examples:\n`);
                process.stderr.write(`  ibrcli login https://api.openai.com/v1 sk-xxx gpt-4o-mini\n`);
                process.stderr.write(`  ibrcli login https://openrouter.ai/api/v1 sk-or-xxx anthropic/claude-3.5-sonnet\n`);
                process.stderr.write(`  ibrcli login http://localhost:11434/v1 "" llama3.2   (local Ollama, no key)\n`);
                process.stderr.write(`\nif model is omitted you'll be prompted to enter it interactively.\n`);
                process.exit(2);
            }
            // prompt for model if missing AND we're in a TTY
            let finalModel = model;
            if (!finalModel) {
                if (!isTTY()) {
                    process.stderr.write("error: model is required (or pass it as the 3rd argument)\n");
                    process.stderr.write("usage: ibrcli login <api_url> <api_key> <model>\n");
                    process.exit(2);
                }
                process.stdout.write(COLOR.muted("no model given. examples: gpt-4o-mini, claude-3.5-sonnet, z-ai/glm-5.3, llama3.2\n") + "\n");
                const ans = await readLine(COLOR.user("model id to use (or blank to set later):") + " ");
                if (ans === null) {
                    process.stderr.write("aborted\n");
                    process.exit(1);
                }
                finalModel = ans.trim();
            }
            const cfg = loadConfig();
            const next = finalModel
                ? login(cfg, url, key, finalModel)
                : { ...cfg, api_url: url, api_key: key };
            saveConfig(next);
            process.stdout.write(renderNotice(`api_url → ${sanitizeUrl(url)}`, "ok") + "\n");
            process.stdout.write(renderNotice(`api_key → ${maskApiKey(key)}`, "ok") + "\n");
            if (finalModel) {
                process.stdout.write(renderNotice(`model → ${finalModel}  (preset: ${next.active_model_id})`, "ok") + "\n");
            }
            else {
                process.stdout.write(renderNotice("model not set — run `ibrcli set model <id>` later", "info") + "\n");
            }
            process.stdout.write(COLOR.muted("  config saved to " + configPath()) + "\n");
            process.stdout.write(COLOR.muted("  run `ibrcli doctor` to test, or `ibrcli` to start chatting\n"));
            process.exit(0);
        }
        case "set": {
            const field = filteredArgv[1];
            const value = argv.slice(2).join(" ");
            if (!field || !value) {
                process.stderr.write(`usage: ibrcli set <field> <value>\n`);
                process.stderr.write(`fields you can set:\n`);
                process.stderr.write(`  api_url         e.g. https://api.openai.com/v1\n`);
                process.stderr.write(`  api_key         your secret API key\n`);
                process.stderr.write(`  model           model id (updates the active preset)\n`);
                process.stderr.write(`  api_path        e.g. /chat/completions\n`);
                process.stderr.write(`  context_window  number of tokens\n`);
                process.stderr.write(`  stream          true / false\n`);
                process.stderr.write(`  system_prompt   default system prompt\n`);
                process.stderr.write(`  gen.temperature number 0..2\n`);
                process.stderr.write(`  gen.max_tokens  number or "null"\n`);
                process.exit(2);
            }
            try {
                const cfg = loadConfig();
                const next = setField(cfg, field, value);
                saveConfig(next);
                // never echo the value of api_key or api_url back
                const secretFields = ["api_key", "api_url"];
                const isSecret = secretFields.includes(field) || field === "api_url";
                if (field === "api_key") {
                    process.stdout.write(renderNotice(`set api_key → ${maskApiKey(value)}`, "ok") + "\n");
                }
                else if (field === "api_url") {
                    process.stdout.write(renderNotice(`set api_url → ${sanitizeUrl(value)}`, "ok") + "\n");
                }
                else {
                    process.stdout.write(renderNotice(`set ${field} = ${value}`, "ok") + "\n");
                }
                process.exit(0);
            }
            catch (e) {
                process.stderr.write(`error: ${e.message}\n`);
                process.exit(1);
            }
        }
        case "show": {
            const reveal = argv.includes("--reveal") || argv.includes("-r");
            const cfg = applyEnvOverrides(loadConfig());
            const out = JSON.parse(JSON.stringify(cfg));
            if (!reveal) {
                out.api_key = maskApiKey(out.api_key);
            }
            process.stdout.write(JSON.stringify(out, null, 2) + "\n");
            if (!reveal) {
                process.stdout.write(COLOR.muted("\n(api_key masked — pass --reveal to show it)\n"));
            }
            process.exit(0);
        }
        case "tools": {
            const { TOOLS } = await import("./tools/index.js");
            process.stdout.write(COLOR.brand("IBR cli tools") + COLOR.muted(" — model can call these") + "\n\n");
            for (const t of TOOLS) {
                const perm = t.requiresPermission ? "  [perm]" : "";
                process.stdout.write(`  ${COLOR.brand(t.name.padEnd(14))} ${COLOR.muted(t.description.slice(0, 64))}${perm}\n`);
            }
            process.exit(0);
        }
        case "sessions": {
            const { listSessions } = await import("./sessions/store.js");
            const list = listSessions();
            if (list.length === 0) {
                process.stdout.write(renderNotice("no saved sessions", "info") + "\n");
            }
            else {
                for (const s of list) {
                    process.stdout.write(`  ${COLOR.brand(s.id.padEnd(28))}  ${new Date(s.ts).toISOString().slice(0, 19)}  ${s.model.padEnd(20)}  ${s.msgCount} msgs\n`);
                }
            }
            process.exit(0);
        }
        case "resume": {
            const id = filteredArgv[1];
            if (!id) {
                process.stderr.write("usage: ibrcli resume <session-id>\n");
                process.exit(2);
            }
            process.argv.push("--resume", id);
            // fall through to chat
        }
        case "config":
        case "cfg": {
            if (!isTTY()) {
                process.stderr.write("ibrcli config needs an interactive terminal. Use `ibrcli set <field> <value>` instead.\n");
                process.exit(1);
            }
            const cfg = applyEnvOverrides(loadConfig());
            const { openConfigEditor } = await import("./config-editor.js");
            await openConfigEditor(cfg, readLine);
            saveConfig(cfg);
            process.stdout.write(renderNotice("config saved to " + configPath(), "ok") + "\n");
            process.exit(0);
        }
        case "doctor": {
            const cfg = applyEnvOverrides(loadConfig());
            if (!isConfigured(cfg)) {
                process.stdout.write(renderNotice("config incomplete — run `ibrcli login <url> <key> [model]` first", "warn") + "\n");
                process.exit(1);
            }
            await runDoctor(cfg);
            process.exit(0);
        }
        case "models":
        case "list": {
            const cfg = applyEnvOverrides(loadConfig());
            for (const m of cfg.models) {
                const mark = m.id === cfg.active_model_id ? "* " : "  ";
                const modelStr = m.model || "(unset)";
                process.stdout.write(COLOR.brand(mark + m.id.padEnd(16)) + " " + modelStr.padEnd(28) + " " + m.context_window + " tokens\n");
            }
            process.exit(0);
        }
        case "add": {
            const id = filteredArgv[1];
            if (!id) {
                process.stderr.write("usage: ibrcli add <id>\n");
                process.exit(2);
            }
            const cfg = loadConfig();
            const next = addModel(cfg, id);
            saveConfig(next);
            process.stdout.write(renderNotice(`added model preset "${id}"`, "ok") + "\n");
            process.exit(0);
        }
        case "rm":
        case "remove": {
            const id = filteredArgv[1];
            if (!id) {
                process.stderr.write("usage: ibrcli rm <id>\n");
                process.exit(2);
            }
            const cfg = loadConfig();
            const next = removeModel(cfg, id);
            saveConfig(next);
            process.stdout.write(renderNotice(`removed model preset "${id}"`, "ok") + "\n");
            process.exit(0);
        }
        case "switch":
        case "model": {
            const id = filteredArgv[1];
            if (!id) {
                process.stderr.write("usage: ibrcli switch <id>\n");
                process.exit(2);
            }
            const cfg = loadConfig();
            const next = switchModel(cfg, id);
            saveConfig(next);
            process.stdout.write(renderNotice(`active model → ${id}`, "ok") + "\n");
            process.exit(0);
        }
        case "run": {
            const prompt = argv.slice(1).join(" ");
            if (!prompt) {
                process.stderr.write('usage: ibrcli run "your prompt"\n');
                process.exit(2);
            }
            const cfg = applyEnvOverrides(loadConfig());
            if (!isConfigured(cfg)) {
                process.stderr.write("ibrcli: not configured — run `ibrcli login <url> <key> [model]` first\n");
                process.exit(1);
            }
            const model = cfg.models.find((m) => m.id === cfg.active_model_id) || cfg.models[0];
            const sys = model.system_prompt || cfg.system_prompt;
            const { streamChat } = await import("./api/client.js");
            const { StreamingLine } = await import("./ui/render.js");
            const stream = new StreamingLine();
            await new Promise((resolve) => {
                streamChat(cfg, model, [
                    { role: "system", content: sys },
                    { role: "user", content: prompt },
                ], null, {
                    onDelta: (d) => stream.append(d),
                    onDone: () => { stream.finish(); resolve(); },
                    onError: (e) => {
                        process.stderr.write("\nError: " + safeErrorMsg(e) + "\n");
                        resolve();
                    },
                });
            });
            process.exit(0);
        }
        case "chat": {
            // Check setup FIRST in both TTY and non-TTY modes
            const cfg = applyEnvOverrides(loadConfig());
            if (!isConfigured(cfg)) {
                if (isTTY()) {
                    await firstRunWizard(cfg);
                }
                else {
                    process.stderr.write("ibrcli: not configured — run `ibrcli login <url> <key> [model]` first (or run `ibrcli` in a terminal to see the setup wizard)\n");
                }
                process.exit(1);
            }
            if (!isTTY()) {
                // Non-interactive: read stdin and treat as a single prompt
                const chunks = [];
                for await (const c of process.stdin)
                    chunks.push(c);
                const text = Buffer.concat(chunks).toString("utf8").trim();
                if (!text) {
                    process.stderr.write("ibrcli: stdin empty and not a TTY\n");
                    process.exit(1);
                }
                const model = cfg.models.find((m) => m.id === cfg.active_model_id) || cfg.models[0];
                const sys = model.system_prompt || cfg.system_prompt;
                const { streamChat } = await import("./api/client.js");
                const { StreamingLine } = await import("./ui/render.js");
                const stream = new StreamingLine();
                await new Promise((resolve) => {
                    streamChat(cfg, model, [
                        { role: "system", content: sys },
                        { role: "user", content: text },
                    ], null, {
                        onDelta: (d) => stream.append(d),
                        onDone: () => { stream.finish(); resolve(); },
                        onError: (e) => { process.stderr.write("\nError: " + safeErrorMsg(e) + "\n"); resolve(); },
                    });
                });
                process.exit(0);
            }
            await startChat();
            process.exit(0);
        }
        default:
            process.stderr.write(`ibrcli: unknown command "${cmd}"\n${USAGE}\n`);
            process.exit(2);
    }
}
// Strip any api_key leakage from server error messages
function safeErrorMsg(err) {
    let msg = err.message || String(err);
    // mask common patterns: Authorization: Bearer xxx, "api_key":"xxx"
    msg = msg.replace(/(Bearer\s+)([\w\-\.]{8,})/gi, "$1***");
    msg = msg.replace(/"(api_key|apiKey|key)"\s*:\s*"([^"]+)"/gi, '"$1":"***"');
    return msg;
}
async function firstRunWizard(cfg) {
    printBanner();
    process.stdout.write(COLOR.brand("Welcome to IBR cli!") + "\n");
    process.stdout.write(COLOR.muted("  IBR cli works with any OpenAI-compatible API — pick your own provider.\n"));
    process.stdout.write(COLOR.muted("  Your API key is stored locally at " + configPath() + " (mode 0600) and never printed.\n\n"));
    process.stdout.write(COLOR.brand("Option A — one-line setup") + "\n");
    process.stdout.write(COLOR.muted("  ibrcli login <api_url> <api_key> <model>\n\n"));
    process.stdout.write(COLOR.muted("  examples:\n"));
    const examples = [
        ["  OpenAI       ", "https://api.openai.com/v1", "gpt-4o-mini"],
        ["  OpenRouter   ", "https://openrouter.ai/api/v1", "anthropic/claude-3.5-sonnet"],
        ["  Groq         ", "https://api.groq.com/openai/v1", "llama-3.3-70b-versatile"],
        ["  Together     ", "https://api.together.xyz/v1", "meta-llama/Llama-3.3-70B-Instruct-Turbo"],
        ["  Mistral      ", "https://api.mistral.ai/v1", "mistral-large-latest"],
        ["  NVIDIA NIM   ", "https://integrate.api.nvidia.com/v1", "z-ai/glm-5.3"],
        ["  Ollama local ", "http://localhost:11434/v1", "llama3.2"],
        ["  LM Studio    ", "http://localhost:1234/v1", "local-model"],
    ];
    for (const [name, url, model] of examples) {
        process.stdout.write(COLOR.user(name) + COLOR.muted(url.padEnd(45)) + model + "\n");
    }
    process.stdout.write("\n" + COLOR.brand("Option B — set fields individually") + "\n");
    process.stdout.write(COLOR.muted("  ibrcli set api_url <url>\n"));
    process.stdout.write(COLOR.muted("  ibrcli set api_key <key>\n"));
    process.stdout.write(COLOR.muted("  ibrcli set model <model_id>\n\n"));
    process.stdout.write(COLOR.muted("Then run `ibrcli` again to start chatting.\n"));
}
async function runDoctor(cfg) {
    const m = cfg.models.find((x) => x.id === cfg.active_model_id) || cfg.models[0];
    process.stdout.write(COLOR.brand("ibrcli doctor") + COLOR.muted(` — testing ${sanitizeUrl(cfg.api_url)}`) + "\n");
    process.stdout.write(COLOR.muted("  model:    " + (m.model || "(empty — run `ibrcli set model <id>`)") + "\n"));
    process.stdout.write(COLOR.muted("  api_key:  " + maskApiKey(cfg.api_key) + "\n"));
    process.stdout.write(COLOR.muted("  headers:  " + (cfg.headers.length ? cfg.headers.map((h) => h.key).join(", ") : "(none)") + "\n"));
    process.stdout.write("\n");
    const { Spinner } = await import("./ui/render.js");
    const spinner = new Spinner("sending probe");
    spinner.start();
    const t0 = Date.now();
    try {
        const { streamChat } = await import("./api/client.js");
        await new Promise((resolve) => {
            streamChat(cfg, m, [
                { role: "system", content: "Reply with exactly: OK" },
                { role: "user", content: "ping" },
            ], null, {
                onDelta: () => { },
                onDone: (full) => {
                    spinner.stop();
                    const ms = Date.now() - t0;
                    process.stdout.write(renderNotice(`OK in ${ms}ms — reply: "${full.slice(0, 80)}"`, "ok") + "\n");
                    resolve();
                },
                onError: (e) => {
                    spinner.stop();
                    process.stdout.write(renderNotice(`FAIL: ${safeErrorMsg(e).slice(0, 200)}`, "err") + "\n");
                    resolve();
                },
            });
        });
    }
    catch (e) {
        spinner.stop();
        process.stdout.write(renderNotice(`FAIL: ${e.message}`, "err") + "\n");
    }
}
main().catch((e) => {
    process.stderr.write("ibrcli: " + e.message + "\n");
    process.exit(1);
});
