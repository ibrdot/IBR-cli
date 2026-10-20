export const todo_write = {
    name: "todo_write",
    description: "Update the running todo list. Pass the full list (replaces existing). Each item: {text, status: pending|in_progress|done|cancelled}. Keep ≤12 items.",
    parameters: [
        { name: "todos", type: "array", description: "Array of {text, status} objects", required: true },
    ],
    category: "memory",
    requiresPermission: false,
    async run(args, ctx) {
        const list = Array.isArray(args.todos) ? args.todos : [];
        const items = list.map((t, i) => ({
            text: String(t.text || `item ${i + 1}`),
            status: (t.status || "pending"),
        }));
        // mutate the shared list in-place
        ctx.todo.length = 0;
        for (const it of items)
            ctx.todo.push(`${it.status || "pending"}::${it.text}`);
        return {
            ok: true,
            output: `todo list updated (${items.length} items):\n` + items.map((i, n) => `${n + 1}. [${i.status}] ${i.text}`).join("\n"),
            display: `${items.length} todos`,
        };
    },
};
