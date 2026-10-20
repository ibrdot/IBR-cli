// tool: grep — search file contents (uses ripgrep if available, falls back to Node regex)
import { spawnSync } from "node:child_process"
import { resolve, isAbsolute } from "node:path"
import { readdirSync, statSync, readFileSync } from "node:fs"
import type { Tool, ToolResult } from "./types.js"

export const grep: Tool = {
  name: "grep",
  description: "Search for a regex pattern across files in a directory. Returns matching lines with file:line:col prefix.",
  parameters: [
    { name: "pattern", type: "string", description: "Regex pattern to search", required: true },
    { name: "path", type: "string", description: "File or directory to search (default cwd)" },
    { name: "include", type: "string", description: "File pattern to include (e.g. *.ts)" },
    { name: "max", type: "number", description: "Max matches to return (default 100)" },
  ],
  category: "read",
  requiresPermission: false,
  async run(args, ctx): Promise<ToolResult> {
    const pattern = String(args.pattern || "")
    if (!pattern) return { ok: false, output: "error: pattern is required" }
    const root = args.path ? String(args.path) : ctx.cwd
    const rootFull = isAbsolute(root) ? root : resolve(ctx.cwd, root)
    const include = args.include ? String(args.include) : null
    const max = Number(args.max) || 100

    // try ripgrep first
    const rg = spawnSync("rg", ["--no-heading", "--line-number", "--color=never", "--max-count", String(max), pattern, rootFull], { encoding: "utf8" })
    if (rg.status === 0 && rg.stdout) {
      const lines = rg.stdout.split("\n").filter(Boolean).slice(0, max)
      return {
        ok: true,
        output: `${lines.length} matches for /${pattern}/\n` + lines.join("\n"),
        display: `${lines.length} matches for /${pattern}/`,
      }
    }

    // fallback: walk and regex
    try {
      const re = new RegExp(pattern)
      const matches: string[] = []
      const walk = (dir: string, depth: number) => {
        if (depth > 12 || matches.length >= max) return
        let entries
        try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
        for (const e of entries) {
          if (e.name === "node_modules" || e.name === ".git" || e.name === "dist") continue
          const full = resolve(dir, e.name)
          if (e.isDirectory()) walk(full, depth + 1)
          else if (e.isFile()) {
            if (include && !matchGlob(include, e.name)) continue
            const content = readFileSync(full, "utf8").split("\n")
            for (let i = 0; i < content.length && matches.length < max; i++) {
              if (re.test(content[i])) matches.push(`${full}:${i + 1}: ${content[i].trim()}`)
            }
          }
        }
      }
      walk(rootFull, 0)
      if (matches.length === 0) return { ok: true, output: `no matches for /${pattern}/` }
      return {
        ok: true,
        output: `${matches.length} matches for /${pattern}/\n` + matches.join("\n"),
        display: `${matches.length} matches for /${pattern}/`,
      }
    } catch (e) {
      return { ok: false, output: `error: ${(e as Error).message}` }
    }
  },
}

function matchGlob(pattern: string, name: string): boolean {
  const re = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")
  return new RegExp("^" + re + "$").test(name)
}
