// IBR cli — tool registry. Single source of truth for all available tools.
import { toOpenAISchema, safeParseArgs } from "./types.js";
import { read_file } from "./read_file.js";
import { write_file } from "./write_file.js";
import { edit_file } from "./edit_file.js";
import { list_dir } from "./list_dir.js";
import { glob } from "./glob.js";
import { grep } from "./grep.js";
import { run_bash } from "./run_bash.js";
import { web_fetch } from "./web_fetch.js";
import { todo_write } from "./todo.js";
export const TOOLS = [
    read_file,
    write_file,
    edit_file,
    list_dir,
    glob,
    grep,
    run_bash,
    web_fetch,
    todo_write,
];
export const TOOL_MAP = Object.fromEntries(TOOLS.map((t) => [t.name, t]));
export function getTool(name) {
    return TOOL_MAP[name];
}
export function allOpenAISchemas() {
    return TOOLS.map(toOpenAISchema);
}
// Optional subset by name (for future per-session tool filtering)
export function schemasByName(names) {
    return TOOLS.filter((t) => names.includes(t.name)).map(toOpenAISchema);
}
export { safeParseArgs };
