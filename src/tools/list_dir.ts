// tool: list_dir — list directory entries
import { readdirSync, statSync } from "node:fs"
import { resolve, isAbsolute, basename } from "node:path"
import type { Tool, ToolResult } from "./types.js"

export const list_dir: Tool = {
  name: "list_dir",
  description: "List entries in a directory. Returns names, types, and sizes.",
  parameters: [
    { name: "path", type: "string", description: "Directory path (default cwd)", required: false },
    { name: "max", type: "number", description: "Max entries to return (default 200)" },
  ],
  category: "read",
  requiresPermission: false,
  async run(args, ctx): Promise<ToolResult> {
    const p = args.path ? String(args.path) : ctx.cwd
    const full = isAbsolute(p) ? p : resolve(ctx.cwd, p)
    try {
      const st = statSync(full)
      if (!st.isDirectory()) return { ok: false, output: `error: ${p} is not a directory` }
      const entries = readdirSync(full, { withFileTypes: true })
      const limit = Number(args.max) || 200
      const rows = entries.slice(0, limit).map((e) => {
        let type = "file"
        let size = ""
        try {
          const es = statSync(resolve(full, e.name))
          if (es.isDirectory()) type = "dir"
          else if (es.isSymbolicLink()) type = "link"
          size = type === "dir" ? "" : `${es.size}b`
        } catch {}
        return { name: e.name, type, size }
      })
      const text = rows.map((r) => `[${r.type === "dir" ? "D" : "F"}] ${r.name.padEnd(40)} ${r.size}`).join("\n")
      return { ok: true, output: `${full}\n${text}`, display: `listed ${rows.length} entries in ${p}` }
    } catch (e) {
      return { ok: false, output: `error: ${(e as Error).message}` }
    }
  },
}
