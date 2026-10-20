// tool: write_file — write text to a file (create or overwrite)
import { writeFileSync, mkdirSync } from "node:fs"
import { dirname, resolve, isAbsolute } from "node:path"
import type { Tool, ToolResult } from "./types.js"

export const write_file: Tool = {
  name: "write_file",
  description: "Write text content to a file. Creates parent directories. Overwrites if exists.",
  parameters: [
    { name: "path", type: "string", description: "Path to the file", required: true },
    { name: "content", type: "string", description: "Full text content to write", required: true },
  ],
  category: "write",
  requiresPermission: true,
  async run(args, ctx): Promise<ToolResult> {
    const p = String(args.path || "")
    const content = String(args.content ?? "")
    if (!p) return { ok: false, output: "error: path is required" }
    const full = isAbsolute(p) ? p : resolve(ctx.cwd, p)
    try {
      mkdirSync(dirname(full), { recursive: true })
      writeFileSync(full, content, "utf8")
      const bytes = Buffer.byteLength(content)
      return {
        ok: true,
        output: `wrote ${bytes} bytes to ${p}`,
        display: `wrote ${bytes} bytes to ${p}`,
      }
    } catch (e) {
      return { ok: false, output: `error: ${(e as Error).message}` }
    }
  },
}
