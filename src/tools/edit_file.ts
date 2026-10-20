// tool: edit_file — apply a unified diff to a file (replace old → new)
import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { resolve, isAbsolute } from "node:path"
import type { Tool, ToolResult } from "./types.js"

export const edit_file: Tool = {
  name: "edit_file",
  description: "Edit a file by replacing a known `old` text block with a `new` text block. The `old` block must appear exactly once in the file.",
  parameters: [
    { name: "path", type: "string", description: "Path to the file", required: true },
    { name: "old", type: "string", description: "Exact existing text block to be replaced", required: true },
    { name: "new", type: "string", description: "New text block to insert in place of `old`", required: true },
  ],
  category: "write",
  requiresPermission: true,
  async run(args, ctx): Promise<ToolResult> {
    const p = String(args.path || "")
    const oldText = String(args.old ?? "")
    const newText = String(args.new ?? "")
    if (!p) return { ok: false, output: "error: path is required" }
    const full = isAbsolute(p) ? p : resolve(ctx.cwd, p)
    if (!existsSync(full)) return { ok: false, output: `error: ${p} does not exist` }
    try {
      const original = readFileSync(full, "utf8")
      const occurrences = original.split(oldText).length - 1
      if (occurrences === 0) {
        return { ok: false, output: `error: old block not found in ${p} — refusing to write` }
      }
      if (occurrences > 1) {
        return { ok: false, output: `error: old block found ${occurrences} times in ${p} — must be unique. Include more surrounding lines.` }
      }
      const updated = original.replace(oldText, newText)
      writeFileSync(full, updated, "utf8")
      const diff = makeMiniDiff(oldText, newText)
      return {
        ok: true,
        output: `edited ${p}: replaced ${oldText.length} bytes with ${newText.length} bytes`,
        display: `edited ${p}`,
        diff,
      }
    } catch (e) {
      return { ok: false, output: `error: ${(e as Error).message}` }
    }
  },
}

function makeMiniDiff(oldText: string, newText: string): string {
  const oldLines = oldText.split("\n")
  const newLines = newText.split("\n")
  const out: string[] = ["@@ edit @@"]
  const max = Math.max(oldLines.length, newLines.length)
  for (let i = 0; i < max; i++) {
    if (oldLines[i] !== newLines[i]) {
      if (oldLines[i] !== undefined) out.push("- " + oldLines[i])
      if (newLines[i] !== undefined) out.push("+ " + newLines[i])
    } else {
      out.push("  " + oldLines[i])
    }
  }
  return out.join("\n")
}
