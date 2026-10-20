// IBR cli — sessions store (auto-save + resume)
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import { configDir } from "../config/store.js"
import type { ChatMessage } from "../api/client.js"

export interface SessionMeta {
  id: string
  ts: number
  model: string
  msgCount: number
}

function sessionsDir(): string {
  return join(configDir(), "sessions")
}

export function saveSession(id: string, history: ChatMessage[], model: string): void {
  const dir = sessionsDir()
  mkdirSync(dir, { recursive: true })
  const path = join(dir, `${id}.json`)
  const data = { id, ts: Date.now(), model, history }
  writeFileSync(path, JSON.stringify(data, null, 2), { mode: 0o600 })
}

export function loadSession(id: string): { id: string; ts: number; model: string; history: ChatMessage[] } {
  const path = join(sessionsDir(), `${id}.json`)
  if (!existsSync(path)) throw new Error(`session ${id} not found`)
  try {
    const raw = readFileSync(path, "utf8")
    return JSON.parse(raw)
  } catch (e) {
    throw new Error(`invalid session file: ${(e as Error).message}`)
  }
}

export function listSessions(): SessionMeta[] {
  const dir = sessionsDir()
  if (!existsSync(dir)) return []
  const out: SessionMeta[] = []
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json")) continue
    try {
      const raw = readFileSync(join(dir, f), "utf8")
      const j = JSON.parse(raw)
      out.push({ id: j.id, ts: j.ts, model: j.model, msgCount: j.history?.length || 0 })
    } catch {}
  }
  out.sort((a, b) => b.ts - a.ts)
  return out
}
