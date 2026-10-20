// IBR cli — render helpers (cross-platform, no ink)
import chalk from "chalk";
import stringWidth from "string-width";
import wrapAnsi from "wrap-ansi";
import { BOX, COLOR } from "./theme.js";
export function termWidth() {
    const w = process.stdout.columns;
    if (typeof w === "number" && w > 0)
        return Math.min(w, 200);
    return 80;
}
export function termHeight() {
    const h = process.stdout.rows;
    if (typeof h === "number" && h > 0)
        return h;
    return 24;
}
export function isTTY() {
    return !!(process.stdin.isTTY && process.stdout.isTTY);
}
// Wrap a paragraph to fit width, preserving CJK width
export function wrap(text, width) {
    return wrapAnsi(text, Math.max(10, width), { hard: true, trim: false });
}
export function renderBubble({ role, text, width, meta }) {
    const w = width ?? termWidth();
    const inner = Math.max(20, Math.min(w - 4, 120));
    const label = role === "user" ? COLOR.user("you") :
        role === "assistant" ? COLOR.brand("IBR") :
            COLOR.muted("system");
    const wrapped = wrap(text, inner - 4);
    const lines = wrapped.split("\n");
    const top = `${BOX.tl}${BOX.h.repeat(2)} ${label} ${BOX.h.repeat(Math.max(1, inner - 6 - stringWidth(role === "user" ? "you" : role === "assistant" ? "IBR" : "system")))}${BOX.tr}`;
    const mid = lines.map((l) => `${BOX.v}  ${l.padEnd(inner - 4, " ")}  ${BOX.v}`).join("\n");
    const metaLine = meta ? COLOR.muted("  " + meta) + "\n" : "";
    return metaLine + top + "\n" + mid + "\n" + `${BOX.bl}${BOX.h.repeat(inner)}${BOX.br}`;
}
// Spinner with cross-platform frames. Falls back to |/-\ when color level is 0.
const SPINNER_FRAMES_UNICODE = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const SPINNER_FRAMES_ASCII = ["|", "/", "-", "\\"];
export class Spinner {
    idx = 0;
    timer = null;
    label;
    frames;
    lastLen = 0;
    constructor(label) {
        this.label = label;
        this.frames = chalk.level >= 2 ? SPINNER_FRAMES_UNICODE : SPINNER_FRAMES_ASCII;
    }
    start() {
        if (!isTTY())
            return;
        this.stop();
        const tick = () => {
            const f = this.frames[this.idx % this.frames.length];
            this.idx++;
            const line = COLOR.brand(f) + " " + COLOR.muted(this.label);
            // pad with spaces to clear any longer previous label, then \r back to start
            this.lastLen = stringWidth(line);
            process.stdout.write("\r" + line);
        };
        tick();
        this.timer = setInterval(tick, 80);
    }
    stop(clear = true) {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        // only write the clear sequence in TTY mode — in pipes the spaces would
        // show up as literal output
        if (clear && isTTY() && this.lastLen > 0) {
            process.stdout.write("\r" + " ".repeat(this.lastLen + 2) + "\r");
            this.lastLen = 0;
        }
    }
    update(label) {
        this.label = label;
    }
}
// Streaming renderer — writes each delta as it arrives (real-time typing
// feel, like ChatGPT). Word-wraps at terminal width. Does NOT overwrite
// or clear previously printed text. Falls back to plain append on non-TTY.
export class StreamingLine {
    buf = "";
    append(delta) {
        if (!delta)
            return;
        this.buf += delta;
        if (isTTY()) {
            // Real-time typing: just write each delta as it arrives. Word-wrap
            // is handled by the terminal as long as we write the raw text.
            // We do not \r, do not pad, do not truncate.
            process.stdout.write(COLOR.assistant(delta));
        }
        else {
            // pipes/logs — also write raw (no color)
            process.stdout.write(delta);
        }
    }
    finish() {
        // just terminate with a newline so the prompt starts fresh
        if (this.buf.length > 0)
            process.stdout.write("\n");
        else
            process.stdout.write("\n");
        return this.buf;
    }
}
// Box for system messages like "switched model"
export function renderNotice(text, kind = "info") {
    const color = kind === "info" ? COLOR.brand : kind === "warn" ? COLOR.warn : kind === "err" ? COLOR.err : COLOR.ok;
    const icon = kind === "info" ? BOX.dot : kind === "warn" ? "!" : kind === "err" ? BOX.cross : BOX.check;
    return "  " + color(icon) + " " + color(text);
}
// Status bar at the bottom — active model + token usage
export function statusBar(left, right) {
    const w = termWidth();
    const pad = Math.max(1, w - stringWidth(stripAnsi(left)) - stringWidth(stripAnsi(right)));
    return COLOR.muted(left) + " ".repeat(pad) + COLOR.muted(right);
}
function stripAnsi(s) {
    // tiny ANSI stripper — avoids pulling in 'strip-ansi' dep
    return s.replace(/\u001b\[[0-9;]*m/g, "");
}
