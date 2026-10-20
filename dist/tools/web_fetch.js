export const web_fetch = {
    name: "web_fetch",
    description: "Fetch a URL over HTTP/HTTPS and return its text contents. HTML is stripped to plain text.",
    parameters: [
        { name: "url", type: "string", description: "HTTP(S) URL to fetch", required: true },
        { name: "max_bytes", type: "number", description: "Cap on bytes returned (default 50000)" },
    ],
    category: "web",
    requiresPermission: false,
    async run(args) {
        const url = String(args.url || "");
        if (!url)
            return { ok: false, output: "error: url is required" };
        if (!/^https?:\/\//i.test(url))
            return { ok: false, output: "error: only http(s) URLs allowed" };
        const max = Number(args.max_bytes) || 50_000;
        try {
            const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(20_000) });
            if (!res.ok)
                return { ok: false, output: `error: HTTP ${res.status} ${res.statusText}` };
            const ct = res.headers.get("content-type") || "";
            const raw = await res.text();
            const text = ct.includes("text/html") ? htmlToText(raw) : raw;
            const truncated = text.length > max;
            return {
                ok: true,
                output: `${url}  [${res.status} ${ct}]\n${text.slice(0, max)}${truncated ? `\n... (${text.length - max} more bytes)` : ""}`,
                display: `${url}  [${res.status}]`,
            };
        }
        catch (e) {
            return { ok: false, output: `error: ${e.message}` };
        }
    },
};
// Tiny HTML-to-text: strips tags, decodes a few common entities, collapses whitespace
function htmlToText(html) {
    // remove scripts/styles/comments
    html = html.replace(/<script[\s\S]*?<\/script>/gi, "");
    html = html.replace(/<style[\s\S]*?<\/style>/gi, "");
    html = html.replace(/<!--[\s\S]*?-->/g, "");
    // block-level → newlines
    html = html.replace(/<\/(p|div|li|h[1-6]|br|tr|table|section|article|header|footer)>/gi, "\n");
    html = html.replace(/<br\s*\/?>/gi, "\n");
    // strip remaining tags
    html = html.replace(/<[^>]+>/g, "");
    // entities
    html = html.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    // collapse whitespace
    return html.replace(/\n\s*\n/g, "\n\n").replace(/[ \t]+/g, " ").trim();
}
