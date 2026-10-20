// tool: read_file — read a file from disk
import { readFileSync, statSync } from "node:fs"
import { resolve, isAbsolute } from "node:path"
import type { Tool, ToolResult } from "./types.js"

export const read_file: Tool = {
  name: "read_file",
  description: "Read a file from disk and return its text contents. Use absolute or cwd-relative paths.",
  parameters: [
    { name: "path", type: "string", description: "Path to the file", required: true },
    { name: "max_bytes", type: "number", description: "Cap on bytes returned (default 200000)" },
  ],
  category: "read",
  requiresPermission: false,
  async run(args, ctx): Promise<ToolResult> {
    const p = String(args.path || "")
    if (!p) return { ok: false, output: "error: path is required" }
    const full = isAbsolute(p) ? p : resolve(ctx.cwd, p)
    try {
      const st = statSync(full)
      if (!st.isFile()) return { ok: false, output: `error: ${p} is not a regular file` }
      const max = Number(args.max_bytes) || 200_000
      const buf = readFileSync(full)
      const truncated = buf.length > max
      const text = buf.subarray(0, max).toString("utf8")
      const header = `${full}  (${buf.length} bytes${truncated ? `, truncated to ${max}` : ""})\n`
      return { ok: true, output: header + text, display: header.trim() }
    } catch (e) {
      return { ok: false, output: `error: ${(e as Error).message}` }
    }
  },
}
