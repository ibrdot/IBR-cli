// IBR cli — OpenAI-compatible streaming chat client
// Talks to whatever API the user pointed at. No vendor lock-in.

import type { Config, ModelPreset } from "../config/schema.js"

export interface ChatMessage {
  role: "system" | "user" | "assistant"
  content: string
}

export interface StreamCallbacks {
  onDelta: (text: string) => void
  onDone: (full: string) => void
  onError: (err: Error) => void
}

function buildHeaders(c: Config): Record<string, string> {
  const h: Record<string, string> = {
    "Content-Type": "application/json",
    "Accept": "text/event-stream",
  }
  if (c.api_key && c.api_key.length > 0) {
    h["Authorization"] = `Bearer ${c.api_key}`
  }
  for (const x of c.headers || []) {
    if (x.key && x.value) h[x.key] = x.value
  }
  return h
}

function buildBody(c: Config, m: ModelPreset, messages: ChatMessage[]) {
  const body: Record<string, unknown> = {
    model: m.model,
    messages,
    stream: c.stream,
    temperature: m.gen.temperature,
    top_p: m.gen.top_p,
    frequency_penalty: m.gen.frequency_penalty,
    presence_penalty: m.gen.presence_penalty,
  }
  if (m.gen.max_tokens != null && m.gen.max_tokens > 0) {
    body.max_tokens = m.gen.max_tokens
  }
  return body
}

function endpoint(c: Config): string {
  let base = c.api_url
  if (base.endsWith("/")) base = base.slice(0, -1)
  let path = c.api_path
  if (!path.startsWith("/")) path = "/" + path
  return base + path
}

export async function streamChat(
  c: Config,
  m: ModelPreset,
  messages: ChatMessage[],
  cb: StreamCallbacks,
  signal?: AbortSignal,
): Promise<void> {
  const url = endpoint(c)
  const headers = buildHeaders(c)
  const body = buildBody(c, m, messages)

  let resp: Response
  try {
    resp = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal,
    })
  } catch (err) {
    cb.onError(new Error(`Network error contacting ${url}: ${err instanceof Error ? err.message : String(err)}`))
    return
  }

  if (!resp.ok) {
    let detail = ""
    try {
      const t = await resp.text()
      detail = t.slice(0, 600)
    } catch {
      /* ignore */
    }
    cb.onError(new Error(`HTTP ${resp.status} ${resp.statusText} from ${url}${detail ? "\n" + detail : ""}`))
    return
  }

  // Non-streaming fallback
  if (!c.stream || !resp.body) {
    let json: any
    try {
      json = await resp.json()
    } catch (err) {
      cb.onError(new Error(`Bad JSON response: ${err instanceof Error ? err.message : String(err)}`))
      return
    }
    const txt = extractContent(json)
    cb.onDelta(txt)
    cb.onDone(txt)
    return
  }

  // SSE parser
  const reader = resp.body.getReader()
  const decoder = new TextDecoder()
  let buf = ""
  let full = ""

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      let idx
      while ((idx = buf.indexOf("\n\n")) >= 0) {
        const raw = buf.slice(0, idx)
        buf = buf.slice(idx + 2)
        for (const line of raw.split("\n")) {
          const t = line.trim()
          if (!t.startsWith("data:")) continue
          const payload = t.slice(5).trim()
          if (payload === "[DONE]") {
            cb.onDone(full)
            return
          }
          try {
            const ev = JSON.parse(payload)
            const delta = extractDelta(ev)
            if (delta) {
              full += delta
              cb.onDelta(delta)
            }
          } catch {
            /* skip malformed line */
          }
        }
      }
    }
    cb.onDone(full)
  } catch (err) {
    cb.onError(new Error(`Stream interrupted: ${err instanceof Error ? err.message : String(err)}`))
  }
}

function extractDelta(ev: any): string {
  // OpenAI / OpenRouter / most compatibles
  const choices = ev?.choices
  if (Array.isArray(choices) && choices.length) {
    const ch0 = choices[0]
    const d = ch0?.delta?.content ?? ch0?.message?.content
    if (typeof d === "string") return d
  }
  // Some servers send { content: "..." }
  if (typeof ev?.content === "string") return ev.content
  // Mistral-style
  const out = ev?.choices?.[0]?.delta?.content
  if (typeof out === "string") return out
  return ""
}

function extractContent(json: any): string {
  const ch = json?.choices?.[0]
  return ch?.message?.content ?? ch?.text ?? ""
}
