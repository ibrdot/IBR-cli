// IBR cli — cross-platform theme
// Detects dumb terminals (cmd.exe without ANSI) and falls back to ASCII box
// chars + plain text. On Linux/macOS/Termux we get full Unicode + 24-bit.

import chalk from "chalk"

// Chalk auto-detects color level on import. We tweak it here for cmd.exe.
function detectLevel(): 0 | 1 | 2 | 3 {
  // Respect NO_COLOR (https://no-color.org/)
  if (process.env.NO_COLOR !== undefined) return 0
  // Force chalk level if user pinned it
  if (process.env.FORCE_COLOR === "0" || process.env.FORCE_COLOR === "false") return 0
  // cmd.exe — pre-Windows 10 had no ANSI at all
  const isWin = process.platform === "win32"
  const isCmd = isWin && !process.env.WT_SESSION && !process.env.TERM_PROGRAM && process.env.TERM !== "xterm-256color"
  if (isCmd && !process.env.CI) {
    // cmd.exe usually supports basic 16 colors after Windows 10 1511
    return 1
  }
  return 3
}

;(chalk as any).level = detectLevel()

// Box chars — Unicode if level >= 2, ASCII fallback if level 0/1
export const BOX = chalk.level >= 2
  ? {
      tl: "╭", tr: "╮", bl: "╰", br: "╯",
      h: "─", v: "│",
      dot: "·",
      arrow: "→",
      bullet: "•",
      check: "✓",
      cross: "✗",
      star: "★",
    }
  : {
      tl: "+", tr: "+", bl: "+", br: "+",
      h: "-", v: "|",
      dot: ".",
      arrow: "->",
      bullet: "*",
      check: "OK",
      cross: "X",
      star: "*",
    }

// Theme colors — use a small palette so dumb terminals still look OK
const c = chalk
export const COLOR = {
  brand: c.hex("#7CF5C9"),      // IBR mint accent
  brandDim: c.hex("#3FB389"),
  user: c.hex("#82AAFF"),       // user msg blue
  assistant: c.hex("#E6EDF3"),   // assistant text white
  muted: c.hex("#7D8590"),       // grey hints
  warn: c.hex("#F0883E"),       // orange warnings
  err: c.hex("#FF6B6B"),        // red errors
  ok: c.hex("#7CF5C9"),         // green ok
  prompt: c.hex("#7CF5C9").bold,
  divider: c.hex("#30363D"),
  meta: c.hex("#8B949E").italic,
}

// ASCII art header. Works on every terminal — no emoji, no special chars.
export const BANNER = String.raw`
   ___  ____ _____
  /_ / / __// ___/   IBR cli
   / /_/ _ (__  )    v2.2
  /___//___/____/     your AI, your tools, your API
`

export function printBanner(): void {
  const lines = BANNER.split("\n").filter((x, i) => i > 0 || x !== "")
  for (const line of lines) {
    process.stdout.write(COLOR.brand(line) + "\n")
  }
  process.stdout.write(COLOR.muted("  chat with any OpenAI-compatible API  ·  markdown + tools + sessions  ·  /help for commands\n"))
  process.stdout.write("\n")
}

export function hr(width: number): string {
  return COLOR.divider(BOX.h.repeat(Math.max(1, width)))
}
