// IBR cli — tool types & schema converter
// Every tool is a self-contained module implementing this interface.

export interface ToolParam {
  name: string
  type: "string" | "number" | "boolean" | "array"
  description: string
  required?: boolean
  enum?: (string | number)[]
}

export interface ToolContext {
  cwd: string
  todo: string[]                       // shared todo list (mutated by todo_write)
  askPermission: (toolName: string, summary: string) => Promise<boolean>
}

export interface ToolResult {
  ok: boolean
  output: string                       // text sent back to the model
  display?: string                     // pretty text for the chat UI (defaults to output)
  diff?: string                        // optional unified diff to render with red/green
}

export interface Tool {
  name: string
  description: string
  parameters: ToolParam[]
  category: "read" | "write" | "exec" | "web" | "memory"
  requiresPermission: boolean
  run: (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>
}

// Convert a Tool to OpenAI function-calling JSON schema
export function toOpenAISchema(t: Tool) {
  const properties: Record<string, unknown> = {}
  const required: string[] = []
  for (const p of t.parameters) {
    const schema: Record<string, unknown> = { type: p.type, description: p.description }
    if (p.enum) schema.enum = p.enum
    properties[p.name] = schema
    if (p.required) required.push(p.name)
  }
  return {
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: { type: "object", properties, required },
    },
  }
}

// Parse streaming arguments safely (model may send partial JSON)
export function safeParseArgs(raw: string): Record<string, unknown> {
  if (!raw) return {}
  try { return JSON.parse(raw) }
  catch {
    // try a tolerant parse — common case: trailing comma or missing closing brace
    try { return JSON.parse(raw + "}") } catch {}
    try { return JSON.parse(raw + "]") } catch {}
    try { return JSON.parse(raw + "}}") } catch {}
    return {}
  }
}
