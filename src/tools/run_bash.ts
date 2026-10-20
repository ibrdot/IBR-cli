// tool: run_bash — execute a shell command (with permission)
import { spawn } from "node:child_process"
import type { Tool, ToolResult } from "./types.js"

export const run_bash: Tool = {
  name: "run_bash",
  description: "Execute a shell command (bash on Unix, cmd on Windows). Returns stdout/stderr. Use sparingly — prefer file tools.",
  parameters: [
    { name: "command", type: "string", description: "Shell command to execute", required: true },
    { name: "timeout_ms", type: "number", description: "Kill after N ms (default 30000)" },
  ],
  category: "exec",
  requiresPermission: true,
  async run(args, ctx): Promise<ToolResult> {
    const command = String(args.command || "")
    if (!command) return { ok: false, output: "error: command is required" }
    const timeout = Number(args.timeout_ms) || 30_000

    return new Promise((resolve) => {
      const isWin = process.platform === "win32"
      const shell = isWin ? "cmd.exe" : "bash"
      const shellArgs = isWin ? ["/c", command] : ["-c", command]
      const child = spawn(shell, shellArgs, {
        cwd: ctx.cwd,
        env: { ...process.env, TERM: process.env.TERM || "dumb" },
        stdio: ["ignore", "pipe", "pipe"],
      })

      let stdout = ""
      let stderr = ""
      let killed = false
      const timer = setTimeout(() => {
        killed = true
        child.kill("SIGKILL")
      }, timeout)

      child.stdout.on("data", (d) => { stdout += d.toString("utf8") })
      child.stderr.on("data", (d) => { stderr += d.toString("utf8") })
      child.on("close", (code) => {
        clearTimeout(timer)
        const truncated = (s: string) => s.length > 8000 ? s.slice(0, 8000) + `\n... (${s.length - 8000} more bytes)` : s
        const out = `${truncated(stdout)}${stderr ? "\n[stderr]\n" + truncated(stderr) : ""}`.trim() || "(no output)"
        const status = killed ? `killed after ${timeout}ms` : `exit ${code}`
        resolve({
          ok: code === 0,
          output: `${command}\n[${status}]\n${out}`,
          display: `${command.split("\n")[0].slice(0, 60)}${command.length > 60 ? "…" : ""} (${status})`,
        })
      })
      child.on("error", (e) => {
        clearTimeout(timer)
        resolve({ ok: false, output: `error spawning: ${e.message}` })
      })
    })
  },
}
