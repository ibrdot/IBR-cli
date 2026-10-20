// IBR cli — context window management
// We don't ship a heavy tokenizer; we approximate token counts with a
// whitespace-and-CJK-aware heuristic, then trim from the head of the
// conversation so the most recent turns always fit. This is portable across
// Termux / cmd.exe / Linux without native deps.

import type { ChatMessage } from "../api/client.js"

// Rough estimate: ~4 chars per token for English, ~2 chars for CJK because
// each character is typically its own token in modern tokenizers.
export function estimateTokens(text: string): number {
  if (!text) return 0
  let cjk = 0
  let other = 0
  for (const ch of text) {
    const code = ch.codePointAt(0)!
    if (
      (code >= 0x3000 && code <= 0x9fff) ||
      (code >= 0xac00 && code <= 0xd7a3) || // Hangul
      (code >= 0xff00 && code <= 0xffef)    // full-width forms
    ) {
      cjk++
    } else {
      other++
    }
  }
  return Math.ceil(cjk / 1.5 + other / 4)
}

export function messageTokens(m: ChatMessage): number {
  // role marker + content + ~4 token overhead per message (mirror OpenAI)
  return 4 + estimateTokens(m.content)
}

export interface TrimResult {
  messages: ChatMessage[]
  droppedCount: number
  usedTokens: number
  budget: number
}

/**
 * Trim a message list so the total estimated tokens fit in `budget`.
 * Rules:
 *  - Always keep the system prompt (index 0) if present.
 *  - Always keep the last user message.
 *  - Drop oldest (user, assistant) pairs from the middle.
 */
export function trimToBudget(msgs: ChatMessage[], budget: number): TrimResult {
  if (msgs.length === 0) {
    return { messages: [], droppedCount: 0, usedTokens: 0, budget }
  }
  const head = msgs[0]?.role === "system" ? [msgs[0]] : []
  const rest = msgs[0]?.role === "system" ? msgs.slice(1) : msgs.slice()
  const tokens = rest.map(messageTokens)
  const headTokens = head.reduce((a, m) => a + messageTokens(m), 0)
  let total = headTokens
  // start from the end (most recent) and walk backwards until budget hit
  const keepIdx: number[] = []
  for (let i = rest.length - 1; i >= 0; i--) {
    const t = tokens[i]
    if (total + t > budget) break
    total += t
    keepIdx.unshift(i)
  }
  if (keepIdx.length === 0 && rest.length > 0) {
    // last user message alone overflows the budget; keep just it
    keepIdx.push(rest.length - 1)
    total = headTokens + tokens[rest.length - 1]
  }
  const kept = keepIdx.map((i) => rest[i])
  const out = [...head, ...kept]
  return {
    messages: out,
    droppedCount: rest.length - keepIdx.length,
    usedTokens: total,
    budget,
  }
}

/**
 * Build the outgoing message array: system prompt + trimmed history + the new
 * user message appended at the end.
 */
export function buildOutgoing(
  history: ChatMessage[],
  newPrompt: string,
  systemPrompt: string,
  contextWindow: number,
): { messages: ChatMessage[]; droppedCount: number; usedTokens: number } {
  const sysMsg: ChatMessage = { role: "system", content: systemPrompt }
  const userMsg: ChatMessage = { role: "user", content: newPrompt }
  const base: ChatMessage[] = [sysMsg, ...history, userMsg]
  const res = trimToBudget(base, contextWindow)
  return {
    messages: res.messages,
    droppedCount: res.droppedCount,
    usedTokens: res.usedTokens,
  }
}
