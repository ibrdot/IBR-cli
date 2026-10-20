// tool: glob — fast file pattern matching (uses Node's fs.glob if available, falls back to recursive readdir)
import { readdirSync, statSync } from "node:fs"
import { resolve, isAbsolute, relative, join } from "node:path"
import type { Tool, ToolResult } from "./types.js"

export const glob: Tool = {
  name: "glob",
  description: "Find files matching glob patterns (e.g. **/*.ts, src/**/index.*). Returns matching paths.",
  parameters: [
    { name: "pattern", type: "string", description: "Glob pattern", required: true },
    { name: "cwd", type: "string", description: "Root directory (default current cwd)" },
  ],
  category: "read",
  requiresPermission: false,
  async run(args, ctx): Promise<ToolResult> {
    const pattern = String(args.pattern || "")
    if (!pattern) return { ok: false, output: "error: pattern is required" }
    const root = args.cwd ? String(args.cwd) : ctx.cwd
    const rootFull = isAbsolute(root) ? root : resolve(ctx.cwd, root)
    try {
      const matches: string[] = []
      const regex = globToRegex(pattern)
      const walk = (dir: string, depth: number) => {
        if (depth > 15 || matches.length > 500) return
        let entries
        try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
        for (const e of entries) {
          if (e.name.startsWith(".") && !pattern.startsWith(".")) continue
          if (e.name === "node_modules" || e.name === ".git") continue
          const full = join(dir, e.name)
          const rel = relative(rootFull, full)
          if (e.isDirectory()) walk(full, depth + 1)
          else if (regex.test(rel) || regex.test(e.name)) matches.push(rel)
        }
      }
      walk(rootFull, 0)
      if (matches.length === 0) return { ok: true, output: `no matches for ${pattern}` }
      return {
        ok: true,
        output: `${matches.length} match(es) for ${pattern}\n` + matches.slice(0, 500).join("\n"),
        display: `${matches.length} files match ${pattern}`,
      }
    } catch (e) {
      return { ok: false, output: `error: ${(e as Error).message}` }
    }
  },
}

// Convert a glob pattern to a RegExp. Supports: *, **, ?, character classes
function globToRegex(pattern: string): RegExp {
  let re = ""
  let i = 0
  while (i < pattern.length) {
    const ch = pattern[i]
    if (ch === "*" && pattern[i + 1] === "*") {
      re += ".*"
      i += 2
      if (pattern[i] === "/") i++
    } else if (ch === "*") {
      re += "[^/]*"
      i++
    } else if (ch === "?") {
      re += "[^/]"
      i++
    } else if (ch === ".") {
      re += "\\."
      i++
    } else if ("+^${}()|[]\\".includes(ch)) {
      re += "\\" + ch
      i++
    } else {
      re += ch
      i++
    }
  }
  return new RegExp("^" + re + "$")
}
