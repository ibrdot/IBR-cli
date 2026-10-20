// IBR cli — detect project type from cwd (package.json, Cargo.toml, etc.)
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

export function detectProject(cwd: string): string {
  // try parent chain — walk up
  let dir = cwd
  for (let depth = 0; depth < 5; depth++) {
    const hit = checkOne(dir)
    if (hit) return hit
    const parent = join(dir, "..")
    if (parent === dir) break
    dir = parent
  }
  return ""
}

function checkOne(dir: string): string {
  const has = (f: string) => existsSync(join(dir, f))
  const read = (f: string) => { try { return readFileSync(join(dir, f), "utf8") } catch { return null } }

  if (has("package.json")) {
    const p = read("package.json")
    if (p) {
      try {
        const j = JSON.parse(p)
        const name = j.name || "(unnamed)"
        const ver = j.version || "?"
        const type = j.type === "module" ? "ESM" : "CJS"
        return `node.js ${type} project "${name}" v${ver}`
      } catch {}
    }
    return "node.js project"
  }
  if (has("Cargo.toml")) {
    const p = read("Cargo.toml")
    if (p) {
      const m = p.match(/name\s*=\s*"([^"]+)"/)
      const mv = p.match(/version\s*=\s*"([^"]+)"/)
      return `rust project "${m?.[1] || "?"}" v${mv?.[1] || "?"}`
    }
    return "rust project"
  }
  if (has("go.mod")) {
    const p = read("go.mod")
    if (p) {
      const m = p.match(/^module\s+(\S+)/m)
      return `go project "${m?.[1] || "?"}"`
    }
    return "go project"
  }
  if (has("pyproject.toml") || has("setup.py") || has("requirements.txt")) {
    const p = read("pyproject.toml")
    if (p) {
      const m = p.match(/name\s*=\s*"([^"]+)"/)
      return `python project "${m?.[1] || "?"}"`
    }
    return "python project"
  }
  if (has("pom.xml")) return "java maven project"
  if (has("build.gradle") || has("build.gradle.kts")) return "java gradle project"
  if (has("Gemfile")) return "ruby project"
  if (has("composer.json")) return "php composer project"
  if (has("mix.exs")) return "elixir project"
  if (has("deno.json") || has("deno.jsonc")) return "deno project"
  if (has("bunfig.toml")) return "bun project"
  if (has(".git")) return "git repo (no project manifest)"
  return ""
}
