// IBR cli — OpenAI-compatible streaming chat client (v2: tool calling support)
function buildHeaders(c) {
    const h = {
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
    };
    if (c.api_key && c.api_key.length > 0) {
        h["Authorization"] = `Bearer ${c.api_key}`;
    }
    for (const x of c.headers || []) {
        if (x.key && x.value)
            h[x.key] = x.value;
    }
    return h;
}
function buildBody(c, m, messages, tools) {
    const body = {
        model: m.model,
        messages,
        stream: c.stream,
        temperature: m.gen.temperature,
        top_p: m.gen.top_p,
        frequency_penalty: m.gen.frequency_penalty,
        presence_penalty: m.gen.presence_penalty,
    };
    if (m.gen.max_tokens != null && m.gen.max_tokens > 0) {
        body.max_tokens = m.gen.max_tokens;
    }
    if (tools && tools.length > 0) {
        body.tools = tools;
        body.tool_choice = "auto";
    }
    return body;
}
function endpoint(c) {
    let base = c.api_url;
    if (base.endsWith("/"))
        base = base.slice(0, -1);
    let path = c.api_path;
    if (!path.startsWith("/"))
        path = "/" + path;
    return base + path;
}
export async function streamChat(c, m, messages, tools, cb, signal) {
    const url = endpoint(c);
    const headers = buildHeaders(c);
    const body = buildBody(c, m, messages, tools);
    let resp;
    try {
        resp = await fetch(url, {
            method: "POST",
            headers,
            body: JSON.stringify(body),
            signal,
        });
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        cb.onError(new Error(`network error contacting ${url}: ${msg}`));
        return { text: "", toolCalls: [] };
    }
    if (!resp.ok) {
        let detail = "";
        try {
            const t = await resp.text();
            detail = t.slice(0, 800);
        }
        catch { }
        cb.onError(new Error(`HTTP ${resp.status} ${resp.statusText} from ${url}${detail ? "\n" + detail : ""}`));
        return { text: "", toolCalls: [] };
    }
    // non-streaming response
    if (!c.stream || !resp.body) {
        let json;
        try {
            json = await resp.json();
        }
        catch (err) {
            cb.onError(new Error(`bad JSON response: ${err instanceof Error ? err.message : String(err)}`));
            return { text: "", toolCalls: [] };
        }
        const msg = json?.choices?.[0]?.message || json;
        const text = msg?.content || "";
        const toolCalls = normalizeToolCalls(msg?.tool_calls);
        if (text)
            cb.onDelta(text);
        cb.onDone(text);
        return { text, toolCalls };
    }
    // SSE parser with tool_calls accumulation
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let full = "";
    // tool_calls accumulated across deltas (OpenAI sends them piece by piece)
    const toolCallAcc = new Map();
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done)
                break;
            buf += decoder.decode(value, { stream: true });
            let idx;
            while ((idx = buf.indexOf("\n\n")) >= 0) {
                const raw = buf.slice(0, idx);
                buf = buf.slice(idx + 2);
                for (const line of raw.split("\n")) {
                    const t = line.trim();
                    if (!t.startsWith("data:"))
                        continue;
                    const payload = t.slice(5).trim();
                    if (payload === "[DONE]") {
                        const toolCalls = finalizeToolCalls(toolCallAcc);
                        cb.onDone(full);
                        return { text: full, toolCalls };
                    }
                    try {
                        const ev = JSON.parse(payload);
                        const delta = ev?.choices?.[0]?.delta;
                        if (!delta)
                            continue;
                        if (typeof delta.content === "string" && delta.content.length > 0) {
                            full += delta.content;
                            cb.onDelta(delta.content);
                        }
                        if (Array.isArray(delta.tool_calls)) {
                            for (const tc of delta.tool_calls) {
                                const i = typeof tc.index === "number" ? tc.index : 0;
                                const entry = toolCallAcc.get(i) || { id: "", name: "", arguments: "" };
                                if (tc.id)
                                    entry.id = entry.id || tc.id;
                                if (tc.function?.name)
                                    entry.name += tc.function.name;
                                if (tc.function?.arguments)
                                    entry.arguments += tc.function.arguments;
                                toolCallAcc.set(i, entry);
                            }
                        }
                    }
                    catch {
                        /* skip malformed line */
                    }
                }
            }
        }
        const toolCalls = finalizeToolCalls(toolCallAcc);
        cb.onDone(full);
        return { text: full, toolCalls };
    }
    catch (err) {
        cb.onError(new Error(`stream interrupted: ${err instanceof Error ? err.message : String(err)}`));
        return { text: full, toolCalls: finalizeToolCalls(toolCallAcc) };
    }
}
function finalizeToolCalls(acc) {
    const out = [];
    const sorted = Array.from(acc.entries()).sort((a, b) => a[0] - b[0]);
    for (const [, v] of sorted) {
        if (!v.name)
            continue;
        out.push({
            id: v.id || `call_${Math.random().toString(36).slice(2, 10)}`,
            type: "function",
            function: { name: v.name, arguments: v.arguments || "{}" },
        });
    }
    return out;
}
function normalizeToolCalls(raw) {
    if (!Array.isArray(raw))
        return [];
    const out = [];
    for (const r of raw) {
        if (r?.function?.name) {
            out.push({
                id: r.id || `call_${Math.random().toString(36).slice(2, 10)}`,
                type: "function",
                function: { name: r.function.name, arguments: r.function.arguments || "{}" },
            });
        }
    }
    return out;
}
