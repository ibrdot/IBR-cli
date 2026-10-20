// IBR cli — chat REPL (v2 architecture: one rl per line so /config can own stdin)
import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { activeModel, loadConfig, saveConfig, switchModel, addModel, removeModel, sanitizeUrl, isConfigured, maskApiKey } from "./config/store.js";
import { streamChat } from "./api/client.js";
import { buildOutgoing } from "./context/window.js";
import { BOX, COLOR, printBanner } from "./ui/theme.js";
import { isTTY, renderNotice, Spinner, StreamingLine, statusBar } from "./ui/render.js";
import { openConfigEditor } from "./config-editor.js";
import { TOOLS, getTool, allOpenAISchemas, safeParseArgs } from "./tools/index.js";
import { detectProject } from "./project/detect.js";
import { saveSession, loadSession, listSessions } from "./sessions/store.js";
export async function startChat() {
    let cfg;
    try {
        cfg = loadConfig();
    }
    catch (e) {
        process.stdout.write(COLOR.err("Could not load config: " + e.message) + "\n");
        process.stdout.write(COLOR.muted("Run `ibrcli config` to fix.") + "\n");
        process.exit(1);
    }
    if (!isConfigured(cfg)) {
        // shouldn't reach here — index.ts guards this — but be defensive
        process.stdout.write(COLOR.warn("Config incomplete. Run `ibrcli login <url> <key> [model]` to set up.") + "\n");
        process.exit(1);
    }
    printBanner();
    if (cfg.bypass_permissions) {
        process.stdout.write(COLOR.err("  !  BYPASS PERMISSIONS IS ON  -  every tool (write/edit/bash) will auto-execute without asking  "));
        process.stdout.write("\n");
        process.stdout.write(COLOR.muted("     turn off: ibrcli set bypass_permissions false   |   /yolo off\n\n"));
    }
    printHelp();
    printStatus(cfg);
    const projectHint = detectProject(process.cwd());
    if (projectHint) {
        process.stdout.write(renderNotice("project: " + projectHint, "info") + "\n");
    }
    const state = {
        cfg,
        history: [],
        todo: [],
        sessionId: `s-${Date.now()}`,
        cwd: process.cwd(),
        projectHint,
        shouldQuit: false,
    };
    // load session if --resume <id> was passed
    const resumeArg = process.argv.find((a, i) => process.argv[i - 1] === "--resume");
    if (resumeArg) {
        try {
            const sess = loadSession(resumeArg);
            state.history = sess.history;
            state.sessionId = resumeArg;
            process.stdout.write(renderNotice(`resumed session ${resumeArg} (${state.history.length} messages)`, "ok") + "\n");
        }
        catch (e) {
            process.stdout.write(renderNotice(`could not resume ${resumeArg}: ${e.message}`, "err") + "\n");
        }
    }
    // Main loop: create a fresh rl per line so commands like /config can own stdin
    let pending = [];
    let inMulti = false;
    while (!state.shouldQuit) {
        if (inMulti) {
            process.stdout.write(COLOR.muted("  ... | ") + pending.join("\\n").slice(0, 60) + (pending.length > 0 ? "…" : "") + "\n");
        }
        const line = await readLine(COLOR.prompt(`${BOX.arrow} `));
        if (line === null) { // Ctrl+D
            process.stdout.write("\n");
            break;
        }
        const trimmed = line.trim();
        if (inMulti) {
            if (trimmed === "") {
                const text = pending.join("\n");
                pending = [];
                inMulti = false;
                await handleUserText(state, text);
            }
            else {
                pending.push(line);
            }
            continue;
        }
        if (trimmed === "")
            continue;
        if (trimmed.startsWith("/")) {
            await runSlashCommand(trimmed, state);
            continue;
        }
        if (trimmed.startsWith("```")) {
            inMulti = true;
            pending = [""];
            process.stdout.write(COLOR.muted("  multi-line mode — end with a blank line to send") + "\n");
            continue;
        }
        await handleUserText(state, trimmed);
    }
    // auto-save session
    if (state.history.length > 0) {
        try {
            saveSession(state.sessionId, state.history, state.cfg.active_model_id);
        }
        catch {
            /* ignore */
        }
    }
}
// Read one line. Returns null on EOF.
function readLine(prompt) {
    return new Promise((resolve) => {
        const rl = readline.createInterface({
            input: stdin,
            output: stdout,
            prompt,
            terminal: isTTY(),
        });
        rl.prompt();
        let resolved = false;
        const done = (v) => {
            if (resolved)
                return;
            resolved = true;
            rl.close();
            resolve(v);
        };
        rl.on("line", (line) => done(line));
        rl.on("close", () => done(null));
        rl.on("SIGINT", () => done(null));
    });
}
function printHelp() {
    const cmds = [
        ["/help", "show commands"],
        ["/config", "interactive config editor"],
        ["/models", "list model presets"],
        ["/switch <id>", "switch active model preset"],
        ["/add <id>", "add a new model preset"],
        ["/rm <id>", "remove a model preset"],
        ["/tools", "list available tools"],
        ["/permissions", "show tool permission policy"],
        ["/yolo [on|off]", "toggle bypass-all-permissions mode (dangerous)"],
        ["/sessions", "list saved sessions"],
        ["/resume <id>", "resume a saved session"],
        ["/save", "save current session"],
        ["/status", "agent/model/context status"],
        ["/cost", "estimated token usage so far"],
        ["/compact", "compress history (offline heuristic)"],
        ["/undo", "drop last user+assistant pair"],
        ["/diff", "git diff --stat in cwd"],
        ["/export [path]", "save transcript as markdown"],
        ["/cwd", "show working directory"],
        ["/cd <dir>", "change working directory"],
        ["/ls", "list files in cwd"],
        ["/doctor", "test API connection"],
        ["/show", "print current config as JSON"],
        ["/clear", "clear conversation history"],
        ["/quit", "exit"],
    ];
    process.stdout.write(COLOR.brand("commands") + "\n");
    for (const [cmd, desc] of cmds) {
        process.stdout.write("  " + COLOR.brand(cmd.padEnd(20)) + COLOR.muted(desc) + "\n");
    }
    process.stdout.write(COLOR.muted("  (start a message with ``` for multi-line — end with a blank line)") + "\n");
    process.stdout.write(COLOR.muted("  (Ctrl+C cancels a streaming response)") + "\n\n");
}
function printStatus(cfg, usedTokens = 0, budget = 0) {
    const m = activeModel(cfg);
    const modelName = m.model || "(unset)";
    const left = `${COLOR.brand("IBR")} ${COLOR.muted("·")} ${COLOR.brand(modelName)}`;
    const right = usedTokens > 0
        ? `${usedTokens}/${budget} tokens`
        : (state_memory.cwd_short || "");
    process.stdout.write(statusBar(left, right) + "\n");
}
// tiny module-scope scratch so printStatus can show cwd without plumbing
const state_memory = { cwd_short: "" };
async function handleUserText(state, text) {
    const model = activeModel(state.cfg);
    const sysPrompt = model.system_prompt && model.system_prompt.length > 0
        ? model.system_prompt
        : state.cfg.system_prompt;
    const cw = model.context_window > 0 ? model.context_window : state.cfg.context_window;
    const built = buildOutgoing(state.history, text, sysPrompt + (state.projectHint ? `\n\nProject context: ${state.projectHint}` : ""), cw);
    if (built.droppedCount > 0) {
        process.stdout.write(renderNotice(`trimmed ${built.droppedCount} old message(s) to fit ${cw} token window`, "info") + "\n");
    }
    // Multi-turn tool loop: send → maybe tool_calls → execute → send back → repeat
    let turn = 0;
    const maxTurns = 8;
    let lastMessages = built.messages;
    let lastUserText = text;
    while (turn < maxTurns) {
        turn++;
        const spinner = new Spinner(turn === 1 ? `asking ${model.model}` : "following up tool result");
        spinner.start();
        const stream = new StreamingLine();
        let abortController = null;
        if (isTTY()) {
            // Listen for Ctrl+C to abort streaming
            abortController = new AbortController();
            const onSigint = () => {
                spinner.stop();
                stream.finish();
                process.stdout.write(COLOR.warn("\n  (interrupted by user)") + "\n");
                abortController?.abort();
            };
            process.once("SIGINT", onSigint);
        }
        const result = await new Promise((resolve) => {
            streamChat(state.cfg, model, lastMessages, allOpenAISchemas(), {
                onDelta: (delta) => {
                    spinner.stop();
                    stream.append(delta);
                },
                onDone: (full) => {
                    spinner.stop();
                    // Real-time typing is already shown above (each delta was written
                    // as it arrived). We just finalize the line and resolve.
                    stream.finish();
                    resolve({ text: full, toolCalls: [] });
                },
                onError: (err) => {
                    spinner.stop();
                    stream.finish();
                    process.stdout.write("\n" + COLOR.err("Error: ") + err.message + "\n");
                    if (err.message.includes("401")) {
                        process.stdout.write(COLOR.muted("  → run `ibrcli login <api_url> <api_key> <model>` to fix in one line") + "\n");
                    }
                    else {
                        process.stdout.write(COLOR.muted("  → run `ibrcli config` to check API URL/Key/Headers") + "\n");
                    }
                    process.stdout.write("\n");
                    resolve(null);
                },
            }, abortController?.signal);
        });
        if (!result)
            return;
        if (result.text && result.text.length > 0) {
            // record assistant turn
            state.history.push({ role: "user", content: lastUserText });
            state.history.push({ role: "assistant", content: result.text });
            lastUserText = "(tool result)"; // for next iteration if needed
            printStatus(state.cfg, built.usedTokens, cw);
            return; // done — no tool calls
        }
        if (result.toolCalls && result.toolCalls.length > 0) {
            // record assistant message WITH tool_calls
            state.history.push({ role: "user", content: lastUserText });
            state.history.push({ role: "assistant", content: result.text || "", tool_calls: result.toolCalls });
            lastUserText = "(continue)";
            // execute each tool call
            const toolMessages = [];
            for (const tc of result.toolCalls) {
                const tool = getTool(tc.function.name);
                if (!tool) {
                    process.stdout.write(renderNotice(`unknown tool: ${tc.function.name}`, "err") + "\n");
                    toolMessages.push({
                        role: "tool",
                        tool_call_id: tc.id,
                        name: tc.function.name,
                        content: `error: unknown tool ${tc.function.name}`,
                    });
                    continue;
                }
                const args = safeParseArgs(tc.function.arguments);
                const summary = formatToolSummary(tool.name, args);
                // permission gate for destructive tools
                let allowed = true;
                if (tool.requiresPermission && !state.cfg.bypass_permissions) {
                    process.stdout.write("  " + COLOR.warn("?") + " " + COLOR.brand(tool.name) + " " + COLOR.muted(summary) + "\n");
                    allowed = await askPermission(tool.name, summary);
                    if (!allowed) {
                        process.stdout.write(renderNotice(`denied — skipping ${tool.name}`, "warn") + "\n");
                        toolMessages.push({
                            role: "tool",
                            tool_call_id: tc.id,
                            name: tool.name,
                            content: "user denied permission",
                        });
                        continue;
                    }
                }
                else if (tool.requiresPermission && state.cfg.bypass_permissions) {
                    // bypass mode — show that we're auto-approving
                    process.stdout.write("  " + COLOR.warn("!") + " " + COLOR.brand(tool.name) + " " + COLOR.muted(summary + "  [auto-approved]") + "\n");
                }
                // run with a per-tool spinner so the user sees progress
                const toolSpinner = new Spinner(`${tool.name} ${summary}`);
                toolSpinner.start();
                const t0 = Date.now();
                const ctx = {
                    cwd: state.cwd,
                    todo: state.todo,
                    askPermission: async (n, s) => askPermission(n, s),
                };
                const res = await tool.run(args, ctx);
                toolSpinner.stop();
                const ms = Date.now() - t0;
                // render result with status icon
                const icon = res.ok ? COLOR.ok("\u2713") : COLOR.err("\u2717");
                const statusLabel = res.display ? res.display : (res.ok ? "ok" : "failed");
                process.stdout.write("  " + icon + " " + COLOR.brand(tool.name) + " " + COLOR.muted(statusLabel + " (" + ms + "ms)") + "\n");
                if (res.diff) {
                    printDiff(res.diff);
                }
                toolMessages.push({
                    role: "tool",
                    tool_call_id: tc.id,
                    name: tool.name,
                    content: res.output.slice(0, 12000),
                });
            }
            // append tool results to messages for next API call
            lastMessages = [...lastMessages, ...toolMessages];
            // also push into history so it persists
            // (assistant with tool_calls is already in history; tool messages go too)
            for (const tm of toolMessages)
                state.history.push(tm);
            continue; // loop back to model with tool results
        }
        // No text and no tool calls — model gave nothing useful
        process.stdout.write(renderNotice("model returned empty response", "warn") + "\n");
        return;
    }
    process.stdout.write(renderNotice(`max turns (${maxTurns}) reached — stopping tool loop`, "warn") + "\n");
}
function formatToolSummary(name, args) {
    const top = Object.entries(args).slice(0, 3).map(([k, v]) => {
        const s = typeof v === "string" ? v : JSON.stringify(v);
        return `${k}=${s.slice(0, 40)}${s.length > 40 ? "…" : ""}`;
    }).join(" ");
    return top;
}
async function askPermission(toolName, summary) {
    process.stdout.write(COLOR.warn(`  ? ${toolName}: ${summary}`) + "\n");
    const ans = await readLine(COLOR.prompt("  allow? [y/N] > "));
    if (ans === null)
        return false;
    return ans.trim().toLowerCase().startsWith("y");
}
function printDiff(diff) {
    for (const line of diff.split("\n")) {
        if (line.startsWith("+ ")) {
            process.stdout.write(COLOR.ok("  " + line) + "\n");
        }
        else if (line.startsWith("- ")) {
            process.stdout.write(COLOR.err("  " + line) + "\n");
        }
        else if (line.startsWith("@@")) {
            process.stdout.write(COLOR.brand("  " + line) + "\n");
        }
        else {
            process.stdout.write(COLOR.muted("  " + line) + "\n");
        }
    }
}
async function runSlashCommand(input, state) {
    const [cmd, ...rest] = input.slice(1).split(/\s+/);
    const arg = rest.join(" ");
    switch (cmd.toLowerCase()) {
        case "help":
        case "?":
            printHelp();
            return;
        case "quit":
        case "exit":
        case "q":
            state.shouldQuit = true;
            return;
        case "clear":
        case "cls":
            state.history.length = 0;
            process.stdout.write("\x1b[2J\x1b[H"); // ANSI clear screen
            printBanner();
            printStatus(state.cfg);
            return;
        case "config":
        case "cfg": {
            await openConfigEditor(state.cfg, readLine);
            saveConfig(state.cfg);
            process.stdout.write(renderNotice("config saved", "ok") + "\n");
            return;
        }
        case "models":
        case "list": {
            process.stdout.write(renderModelList(state.cfg) + "\n");
            return;
        }
        case "switch":
        case "model": {
            if (!arg) {
                process.stdout.write(renderNotice("usage: /switch <id>", "warn") + "\n");
                return;
            }
            try {
                state.cfg = switchModel(state.cfg, arg);
                saveConfig(state.cfg);
                process.stdout.write(renderNotice(`active model → ${arg}`, "ok") + "\n");
            }
            catch (e) {
                process.stdout.write(renderNotice(e.message, "err") + "\n");
            }
            return;
        }
        case "add": {
            if (!arg) {
                process.stdout.write(renderNotice("usage: /add <id>", "warn") + "\n");
                return;
            }
            try {
                state.cfg = addModel(state.cfg, arg);
                saveConfig(state.cfg);
                process.stdout.write(renderNotice(`added model preset "${arg}"`, "ok") + "\n");
            }
            catch (e) {
                process.stdout.write(renderNotice(e.message, "err") + "\n");
            }
            return;
        }
        case "rm":
        case "remove": {
            if (!arg) {
                process.stdout.write(renderNotice("usage: /rm <id>", "warn") + "\n");
                return;
            }
            try {
                state.cfg = removeModel(state.cfg, arg);
                saveConfig(state.cfg);
                process.stdout.write(renderNotice(`removed model preset "${arg}"`, "ok") + "\n");
            }
            catch (e) {
                process.stdout.write(renderNotice(e.message, "err") + "\n");
            }
            return;
        }
        case "tools": {
            process.stdout.write(COLOR.brand("tools") + COLOR.muted("  (model can call these)") + "\n");
            for (const t of TOOLS) {
                const perm = t.requiresPermission ? COLOR.warn(" [perm]") : "";
                process.stdout.write(`  ${COLOR.brand(t.name.padEnd(14))} ${COLOR.muted(t.description.slice(0, 60))}${perm}\n`);
            }
            return;
        }
        case "sessions":
        case "history": {
            const list = listSessions();
            if (list.length === 0) {
                process.stdout.write(renderNotice("no saved sessions yet", "info") + "\n");
                return;
            }
            for (const s of list) {
                process.stdout.write(`  ${COLOR.brand(s.id)}  ${COLOR.muted(new Date(s.ts).toISOString().slice(0, 19))}  ${s.model}  ${s.msgCount} msgs\n`);
            }
            return;
        }
        case "resume": {
            if (!arg) {
                process.stdout.write(renderNotice("usage: /resume <id>", "warn") + "\n");
                return;
            }
            try {
                const sess = loadSession(arg);
                state.history = sess.history;
                state.sessionId = arg;
                process.stdout.write(renderNotice(`resumed ${arg} (${state.history.length} messages)`, "ok") + "\n");
            }
            catch (e) {
                process.stdout.write(renderNotice(e.message, "err") + "\n");
            }
            return;
        }
        case "save": {
            try {
                saveSession(state.sessionId, state.history, state.cfg.active_model_id);
                process.stdout.write(renderNotice(`saved as ${state.sessionId}`, "ok") + "\n");
            }
            catch (e) {
                process.stdout.write(renderNotice(e.message, "err") + "\n");
            }
            return;
        }
        case "cost":
        case "tokens": {
            const used = state.history.reduce((a, m) => a + (m.content.length / 4), 0);
            process.stdout.write(renderNotice(`~${Math.ceil(used)} tokens in conversation so far`, "info") + "\n");
            return;
        }
        case "cwd": {
            process.stdout.write(state.cwd + "\n");
            return;
        }
        case "cd": {
            if (!arg) {
                process.stdout.write(renderNotice("usage: /cd <dir>", "warn") + "\n");
                return;
            }
            try {
                process.chdir(arg);
                state.cwd = process.cwd();
                state.projectHint = detectProject(state.cwd);
                process.stdout.write(renderNotice("cwd → " + state.cwd + (state.projectHint ? "  (" + state.projectHint + ")" : ""), "ok") + "\n");
            }
            catch (e) {
                process.stdout.write(renderNotice(e.message, "err") + "\n");
            }
            return;
        }
        case "ls":
        case "dir": {
            const { list_dir } = await import("./tools/list_dir.js");
            const r = await list_dir.run({ path: state.cwd }, { cwd: state.cwd, todo: state.todo, askPermission: async () => true });
            process.stdout.write(r.output + "\n");
            return;
        }
        case "doctor":
        case "ping":
        case "test": {
            await runDoctor(state.cfg);
            return;
        }
        case "status": {
            printAgentStatus(state);
            return;
        }
        case "compact":
        case "summarize": {
            await compactHistory(state);
            return;
        }
        case "diff": {
            await runGitDiff(state);
            return;
        }
        case "export": {
            await exportTranscript(state, arg);
            return;
        }
        case "undo": {
            // pop last user+assistant pair
            if (state.history.length < 2) {
                process.stdout.write(renderNotice("nothing to undo", "info") + "\n");
                return;
            }
            // pop assistant (last) and the matching user
            state.history.pop();
            state.history.pop();
            process.stdout.write(renderNotice("undid last turn", "ok") + "\n");
            return;
        }
        case "permissions":
        case "perms": {
            process.stdout.write(COLOR.brand("Permissions") + "\n");
            const mode = state.cfg.bypass_permissions ? COLOR.err("BYPASS ON") : COLOR.ok("ask-each-time");
            process.stdout.write("  mode: " + mode + "\n\n");
            for (const t of TOOLS) {
                const perm = t.requiresPermission ? COLOR.warn("ask   ") : COLOR.ok("auto  ");
                process.stdout.write(`  ${perm} ${COLOR.brand(t.name.padEnd(14))} ${COLOR.muted(t.description.slice(0, 60))}\n`);
            }
            return;
        }
        case "yolo": {
            const target = arg.toLowerCase().trim();
            if (target === "on" || target === "true" || target === "1") {
                state.cfg.bypass_permissions = true;
                saveConfig(state.cfg);
                process.stdout.write(COLOR.err("  !  BYPASS PERMISSIONS ON  —  destructive tools will auto-execute") + "\n");
            }
            else if (target === "off" || target === "false" || target === "0") {
                state.cfg.bypass_permissions = false;
                saveConfig(state.cfg);
                process.stdout.write(COLOR.ok("  ✓  bypass permissions OFF  —  destructive tools will ask") + "\n");
            }
            else {
                // toggle or query
                const current = state.cfg.bypass_permissions;
                process.stdout.write(renderNotice(`bypass_permissions = ${current}  (use /yolo on or /yolo off)`, "info") + "\n");
            }
            return;
        }
        case "show": {
            process.stdout.write(JSON.stringify(state.cfg, null, 2) + "\n");
            return;
        }
        default:
            process.stdout.write(renderNotice(`unknown command: /${cmd} — try /help`, "warn") + "\n");
    }
}
function printAgentStatus(state) {
    const m = activeModel(state.cfg);
    const usedTokens = state.history.reduce((a, m2) => a + Math.ceil(m2.content.length / 4), 0);
    process.stdout.write(COLOR.brand("IBR cli status") + "\n");
    process.stdout.write(COLOR.muted("  cwd:           ") + state.cwd + "\n");
    process.stdout.write(COLOR.muted("  project:        ") + (state.projectHint || "(none detected)") + "\n");
    process.stdout.write(COLOR.muted("  active model:  ") + (m.model || "(unset)") + "  (preset: " + m.id + ")\n");
    process.stdout.write(COLOR.muted("  api_url:       ") + sanitizeUrl(state.cfg.api_url) + "\n");
    process.stdout.write(COLOR.muted("  api_key:       ") + maskApiKey(state.cfg.api_key) + "\n");
    process.stdout.write(COLOR.muted("  messages:      ") + state.history.length + " in history\n");
    process.stdout.write(COLOR.muted("  est. tokens:  ") + usedTokens + " (in-conversation, not billed)\n");
    process.stdout.write(COLOR.muted("  context win:   ") + (m.context_window || state.cfg.context_window) + " tokens\n");
    process.stdout.write(COLOR.muted("  todo items:    ") + state.todo.length + "\n");
    if (state.todo.length > 0) {
        for (const t of state.todo) {
            const [status, ...rest] = t.split("::");
            process.stdout.write("    " + COLOR.brand(status.padEnd(12)) + rest.join("::") + "\n");
        }
    }
    process.stdout.write(COLOR.muted("  session id:    ") + state.sessionId + "\n");
}
async function compactHistory(state) {
    if (state.history.length < 4) {
        process.stdout.write(renderNotice("not enough history to compact (need ≥4 messages)", "info") + "\n");
        return;
    }
    // simple compaction: keep system + last 2 turns, summarize the middle
    // (real compaction would call the model — we keep it offline for now)
    const before = state.history.length;
    const kept = state.history.slice(-4);
    state.history = kept;
    process.stdout.write(renderNotice(`compacted ${before - kept.length} messages (offline heuristic — kept last 4)`, "ok") + "\n");
    process.stdout.write(COLOR.muted("  (full summarization via model is a future improvement)\n") + "\n");
}
async function runGitDiff(state) {
    // run `git diff` in cwd via the run_bash tool
    const { run_bash } = await import("./tools/run_bash.js");
    process.stdout.write(COLOR.brand("git diff (working tree)") + "\n");
    const res = await run_bash.run({ command: "git diff --stat" }, { cwd: state.cwd, todo: state.todo, askPermission: async () => true });
    if (!res.ok) {
        process.stdout.write(renderNotice("git not available or not a git repo: " + res.output.slice(0, 200), "warn") + "\n");
        return;
    }
    process.stdout.write(res.output + "\n");
}
async function exportTranscript(state, dest) {
    // export current session as markdown
    const { writeFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const target = dest ? resolve(state.cwd, dest) : resolve(state.cwd, `ibrcli-transcript-${state.sessionId}.md`);
    const lines = [`# IBR cli transcript`, ``, `**Session:** ${state.sessionId}`, `**Date:** ${new Date().toISOString()}`, `**Model:** ${activeModel(state.cfg).model}`, ``, `---`, ``];
    for (const m of state.history) {
        if (m.role === "user")
            lines.push(`## You`, ``, m.content, ``);
        else if (m.role === "assistant")
            lines.push(`## IBR`, ``, m.content, ``);
        else if (m.role === "tool")
            lines.push(`<details><summary>tool: ${m.name}</summary>`, ``, "```", m.content.slice(0, 800), "```", `</details>`, ``);
    }
    writeFileSync(target, lines.join("\n"), "utf8");
    process.stdout.write(renderNotice(`transcript exported to ${target}`, "ok") + "\n");
}
function renderModelList(cfg) {
    const out = [];
    out.push(COLOR.brand("models") + COLOR.muted("  (active marked with " + BOX.star + ")"));
    for (const m of cfg.models) {
        const mark = m.id === cfg.active_model_id ? COLOR.brand(BOX.star + " ") : "  ";
        out.push(`  ${mark}${COLOR.brand(m.id.padEnd(14))} ${COLOR.muted(m.model.padEnd(28))} ${m.context_window} tokens`);
    }
    return out.join("\n");
}
async function runDoctor(cfg) {
    const m = activeModel(cfg);
    process.stdout.write(COLOR.brand("doctor") + COLOR.muted(` — testing ${cfg.api_url}`) + "\n");
    process.stdout.write(COLOR.muted("  model: " + m.model + "\n"));
    process.stdout.write(COLOR.muted("  api_key: " + (cfg.api_key ? cfg.api_key.slice(0, 4) + "…" + cfg.api_key.slice(-4) : "(empty)") + "\n"));
    process.stdout.write(COLOR.muted("  headers: " + (cfg.headers.length ? cfg.headers.map((h) => h.key).join(", ") : "(none)") + "\n"));
    process.stdout.write("\n");
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
                    process.stdout.write(renderNotice(`FAIL: ${e.message.slice(0, 200)}`, "err") + "\n");
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
