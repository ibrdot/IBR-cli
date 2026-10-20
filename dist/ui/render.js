// IBR cli — render helpers (cross-platform, no ink)
import chalk from "chalk";
import cliTruncate from "cli-truncate";
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
    constructor(label) {
        this.label = label;
        this.frames = chalk.level >= 2 ? SPINNER_FRAMES_UNICODE : SPINNER_FRAMES_ASCII;
    }
    start() {
        if (!isTTY())
            return; // can't animate without a TTY
        this.stop();
        const tick = () => {
            const f = this.frames[this.idx % this.frames.length];
            this.idx++;
            process.stdout.write("\r" + COLOR.brand(f) + " " + COLOR.muted(this.label) + "   \b\b\b");
        };
        tick();
        this.timer = setInterval(tick, 80);
    }
    stop(clear = true) {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        if (clear)
            process.stdout.write("\r" + " ".repeat(60) + "\r");
    }
    update(label) {
        this.label = label;
    }
}
// Streaming renderer — overwrites the last line on each delta. Falls back to
// plain append on non-TTY (so logs/captures still look fine).
export class StreamingLine {
    buf = "";
    wrote = 0;
    append(delta) {
        this.buf += delta;
        if (isTTY()) {
            const w = termWidth();
            const tail = this.buf.slice(-w);
            const line = cliTruncate(tail, w);
            const pad = Math.max(0, this.wrote - stringWidth(line));
            process.stdout.write("\r" + COLOR.assistant(line) + " ".repeat(pad));
            this.wrote = stringWidth(line);
        }
        else {
            process.stdout.write(delta);
        }
    }
    finish() {
        if (this.wrote > 0)
            process.stdout.write("\n");
        else if (!isTTY() && this.buf.length === 0)
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
