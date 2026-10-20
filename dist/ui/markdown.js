// IBR cli — markdown renderer
// Renders a markdown string to ANSI-colored terminal output with proper
// word wrapping, code blocks, headings, lists, blockquotes, and inline
// formatting (bold, italic, code, strikethrough, links).
import chalk from "chalk";
import wrapAnsi from "wrap-ansi";
import { COLOR } from "./theme.js";
export function renderMarkdown(input, opts = {}) {
    const width = opts.width || Math.min(120, Math.max(40, (process.stdout.columns || 80)));
    const indent = opts.baseIndent || 0;
    const out = [];
    const lines = input.split("\n");
    let i = 0;
    let inList = false;
    while (i < lines.length) {
        const raw = lines[i];
        const line = raw.replace(/\s+$/, "");
        // fenced code block ```lang ... ```
        const fence = line.match(/^```(\w*)\s*$/);
        if (fence) {
            const lang = fence[1] || "";
            const codeLines = [];
            i++;
            while (i < lines.length && !lines[i].match(/^```\s*$/)) {
                codeLines.push(lines[i]);
                i++;
            }
            i++; // skip closing ```
            out.push(renderCodeBlock(codeLines.join("\n"), lang, width, indent));
            out.push("");
            inList = false;
            continue;
        }
        // heading
        const h = line.match(/^(#{1,6})\s+(.*)$/);
        if (h) {
            const level = h[1].length;
            const text = h[2];
            const colors = [COLOR.brand, COLOR.brand, COLOR.user, COLOR.user, COLOR.muted, COLOR.muted];
            const fn = colors[Math.min(level - 1, colors.length - 1)];
            out.push(pad(fn(chalk.bold(text)), indent));
            out.push("");
            inList = false;
            continue;
        }
        // horizontal rule
        if (/^---+\s*$/.test(line) || /^\*\*\*\s*$/.test(line) || /^___+\s*$/.test(line)) {
            out.push(pad(COLOR.divider("─".repeat(width - indent - 1)), indent));
            out.push("");
            inList = false;
            continue;
        }
        // blockquote
        const q = line.match(/^>\s?(.*)$/);
        if (q) {
            const wrapped = wrap(q[1], width - indent - 4);
            for (const w of wrapped.split("\n")) {
                out.push(pad(COLOR.muted("│ " + w), indent));
            }
            inList = false;
            continue;
        }
        // ordered list 1. item
        const ol = line.match(/^(\s*)(\d+)\.\s+(.*)$/);
        if (ol) {
            const prefix = ol[2] + ". ";
            const content = renderInline(ol[3]);
            const wrapped = wrapPlain(ol[3], width - indent - prefix.length);
            out.push(pad(COLOR.brand(prefix) + wrapped[0], indent));
            for (let k = 1; k < wrapped.length; k++) {
                out.push(pad(" ".repeat(prefix.length) + wrapped[k], indent));
            }
            inList = true;
            continue;
        }
        // unordered list - item / * item
        const ul = line.match(/^(\s*)([-*+])\s+(.*)$/);
        if (ul) {
            const prefix = "• ";
            const content = renderInline(ul[3]);
            const wrapped = wrapPlain(ul[3], width - indent - prefix.length);
            out.push(pad(COLOR.brand(prefix) + wrapped[0], indent));
            for (let k = 1; k < wrapped.length; k++) {
                out.push(pad("  " + wrapped[k], indent));
            }
            inList = true;
            continue;
        }
        // blank line
        if (line === "") {
            out.push("");
            inList = false;
            continue;
        }
        // paragraph
        const wrapped = wrapPlain(line, width - indent);
        out.push(pad(renderInline(wrapped[0]), indent));
        for (let k = 1; k < wrapped.length; k++) {
            out.push(pad(renderInline(wrapped[k]), indent));
        }
        inList = false;
    }
    // trim trailing blank lines
    while (out.length > 0 && out[out.length - 1] === "")
        out.pop();
    return out.join("\n");
}
function renderCodeBlock(code, lang, width, indent) {
    // a soft frame: top + bottom rules, indented code
    const lines = code.split("\n");
    const innerWidth = Math.min(width - indent - 4, 100);
    const framed = [];
    const langTag = lang ? COLOR.muted(" " + lang + " ") : "";
    framed.push(pad(COLOR.divider("┌" + "─".repeat(innerWidth + 2) + "┐") + langTag, indent));
    for (const line of lines) {
        const wrapped = wrapAnsi(line, innerWidth, { hard: true, trim: false }).split("\n");
        for (const w of wrapped) {
            const padded = w.padEnd(innerWidth, " ");
            framed.push(pad(COLOR.divider("│") + COLOR.assistant(" " + padded + " ") + COLOR.divider("│"), indent));
        }
    }
    framed.push(pad(COLOR.divider("└" + "─".repeat(innerWidth + 2) + "┘"), indent));
    return framed.join("\n");
}
// Inline formatting: **bold** *italic* `code` ~~strike~~ [text](url)
export function renderInline(text) {
    // protect inline code first (don't process ** inside `...`)
    const segments = [];
    let buf = "";
    let i = 0;
    while (i < text.length) {
        if (text[i] === "`") {
            // push pending buf
            if (buf) {
                segments.push(processInlineMarkup(buf));
                buf = "";
            }
            const end = text.indexOf("`", i + 1);
            if (end === -1) {
                buf = text.slice(i);
                break;
            }
            segments.push(COLOR.user(text.slice(i + 1, end)));
            i = end + 1;
        }
        else if (text.slice(i, i + 2) === "**") {
            if (buf) {
                segments.push(processInlineMarkup(buf));
                buf = "";
            }
            const end = text.indexOf("**", i + 2);
            if (end === -1) {
                buf = text.slice(i);
                break;
            }
            segments.push(chalk.bold(text.slice(i + 2, end)));
            i = end + 2;
        }
        else if (text.slice(i, i + 2) === "~~") {
            if (buf) {
                segments.push(processInlineMarkup(buf));
                buf = "";
            }
            const end = text.indexOf("~~", i + 2);
            if (end === -1) {
                buf = text.slice(i);
                break;
            }
            segments.push(chalk.strikethrough(text.slice(i + 2, end)));
            i = end + 2;
        }
        else if (text[i] === "*" || text[i] === "_") {
            if (buf) {
                segments.push(processInlineMarkup(buf));
                buf = "";
            }
            const ch = text[i];
            const end = text.indexOf(ch, i + 1);
            if (end === -1) {
                buf = text.slice(i);
                break;
            }
            segments.push(chalk.italic(text.slice(i + 1, end)));
            i = end + 1;
        }
        else if (text[i] === "[") {
            // [text](url) — show text in brand color, drop url (terminals aren't clickable)
            const close = text.indexOf("]", i + 1);
            if (close === -1 || text[close + 1] !== "(") {
                buf += text[i];
                i++;
                continue;
            }
            const urlEnd = text.indexOf(")", close + 2);
            if (urlEnd === -1) {
                buf += text[i];
                i++;
                continue;
            }
            const linkText = text.slice(i + 1, close);
            segments.push(COLOR.brand(chalk.underline(linkText)));
            i = urlEnd + 1;
        }
        else {
            buf += text[i];
            i++;
        }
    }
    if (buf)
        segments.push(processInlineMarkup(buf));
    return segments.join("");
}
function processInlineMarkup(s) {
    // no remaining markup to apply (already split above)
    return s;
}
function wrap(text, width) {
    return wrapAnsi(text, Math.max(10, width), { hard: true, trim: false });
}
function wrapPlain(text, width) {
    const w = Math.max(10, width);
    return wrapAnsi(text, w, { hard: true, trim: false }).split("\n");
}
function pad(text, indent) {
    return indent > 0 ? " ".repeat(indent) + text : text;
}
