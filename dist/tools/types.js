// IBR cli — tool types & schema converter
// Every tool is a self-contained module implementing this interface.
// Convert a Tool to OpenAI function-calling JSON schema
export function toOpenAISchema(t) {
    const properties = {};
    const required = [];
    for (const p of t.parameters) {
        const schema = { type: p.type, description: p.description };
        if (p.enum)
            schema.enum = p.enum;
        properties[p.name] = schema;
        if (p.required)
            required.push(p.name);
    }
    return {
        type: "function",
        function: {
            name: t.name,
            description: t.description,
            parameters: { type: "object", properties, required },
        },
    };
}
// Parse streaming arguments safely (model may send partial JSON)
export function safeParseArgs(raw) {
    if (!raw)
        return {};
    try {
        return JSON.parse(raw);
    }
    catch {
        // try a tolerant parse — common case: trailing comma or missing closing brace
        try {
            return JSON.parse(raw + "}");
        }
        catch { }
        try {
            return JSON.parse(raw + "]");
        }
        catch { }
        try {
            return JSON.parse(raw + "}}");
        }
        catch { }
        return {};
    }
}
