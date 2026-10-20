# IBR cli

World's most powerful provider-agnostic AI coding CLI. Tools, sessions, real-time streaming, slash commands, project detection, markdown rendering — works on Termux (Android), Linux, macOS, and Windows.

## What it does

- **Real-time streaming** — tokens appear as the model types them (ChatGPT-style, no flicker, no overwrite)
- **9 tools** — read_file, write_file, edit_file (with diff view), list_dir, glob, grep, run_bash, web_fetch, todo_write
- **Tool calling loop** — model can chain tool calls; results fed back automatically
- **Permission system** — ask-before-execute for destructive tools, or `--yolo` to bypass
- **Sessions** — auto-save, list, resume, export as markdown transcript
- **24 slash commands** — see below
- **Project context detection** — auto-detects Node, Rust, Go, Python, Java, etc. and injects into system prompt
- **Markdown renderer** — code blocks with borders, headings, lists, blockquotes, inline code/bold/italic, links, horizontal rules
- **Diff view** — `edit_file` shows red/green mini-diff before applying
- **Cross-platform** — pure JS, no native deps, ASCII fallback for cmd.exe, braille spinner

## Install

```bash
npm install -g https://github.com/ibrdot/IBR-cli/releases/download/v2.2.0/ibr-cli-2.2.0.tgz
```

Or from GitHub directly:

```bash
npm install -g github:ibrdot/IBR-cli
```

Requires Node 18+.

## Quick start

```bash
# one-line setup (any OpenAI-compatible API)
ibrcli login https://api.openai.com/v1 sk-xxx gpt-4o-mini

# test it
ibrcli doctor

# start chatting
ibrcli
```

## Bypass all permissions (dangerous mode)

Like Claude Code's `--dangerously-skip-permissions`:

```bash
ibrcli --yolo                    # enables bypass_permissions in config
ibrcli --dangerously-skip-permissions  # same thing
ibrcli                           # now tools auto-execute without asking
```

Or toggle inside chat:

```
/yolo on     # turn bypass on
/yolo off    # turn bypass off (default)
/permissions # show current policy + all tool permission flags
```

Turn off permanently:

```bash
ibrcli set bypass_permissions false
```

A red warning banner shows whenever bypass mode is active.

## Tools (model can call these)

| Tool | Description | Permission |
|------|-------------|------------|
| `read_file`     | Read a file from disk                    | no |
| `write_file`    | Write/create/overwrite a file           | **yes** |
| `edit_file`     | Apply old→new text replacement to a file (with diff preview) | **yes** |
| `list_dir`      | List directory entries                  | no |
| `glob`          | File pattern matching (`**/*.ts`)        | no |
| `grep`          | Search file contents (uses ripgrep if available)     | no |
| `run_bash`      | Execute shell command                   | **yes** |
| `web_fetch`     | Fetch URL, HTML stripped to text        | no |
| `todo_write`    | Manage a shared todo list              | no |

When permission is required and bypass is OFF, you'll see:
```
  ? write_file  path=foo.ts content="..."
  allow? [y/N] >
```

In bypass mode, the same call shows:
```
  ! write_file  path=foo.ts content="..."  [auto-approved]
```

## Slash commands (24 total)

| Command | Action |
|---------|--------|
| `/help`           | show commands |
| `/config`         | interactive config editor |
| `/models`         | list model presets |
| `/switch <id>`    | switch active model preset |
| `/add <id>`        | add a new model preset |
| `/rm <id>`         | remove a model preset |
| `/tools`          | list available tools |
| `/permissions`    | show tool permission policy + bypass state |
| `/yolo [on\|off]` | toggle bypass-all-permissions (dangerous) |
| `/sessions`       | list saved sessions |
| `/resume <id>`    | resume a saved session |
| `/save`           | save current session |
| `/status`         | agent/model/context status (cwd, project, model, tokens, todos, session id) |
| `/cost`           | estimated tokens used so far |
| `/compact`        | compress history (offline heuristic — keeps last 4 msgs) |
| `/undo`           | drop last user+assistant pair |
| `/diff`           | git diff --stat in cwd |
| `/export [path]`  | save transcript as markdown |
| `/cwd`            | show working directory |
| `/cd <dir>`       | change working directory |
| `/ls`             | list files in cwd |
| `/doctor`         | test API connection |
| `/show`           | print current config as JSON |
| `/clear`          | clear conversation |
| `/quit`           | exit |

Start a message with ` ``` ` to enter multi-line mode (end with a blank line). `Ctrl+C` cancels a streaming response.

## CLI commands

| Command | Action |
|---------|--------|
| `ibrcli`                                | start chat (interactive) |
| `ibrcli chat`                           | same as above |
| `ibrcli login <url> <key> [model]`      | one-shot setup (prompts for model if missing) |
| `ibrcli set <field> <value>`            | set any config field (e.g. `set api_key xxx`) |
| `ibrcli config`                         | interactive config editor |
| `ibrcli init`                           | write default config (idempotent — won't overwrite) |
| `ibrcli show [--reveal]`                | print config (api_key masked unless `--reveal`) |
| `ibrcli path`                           | print config file path |
| `ibrcli models`                         | list model presets |
| `ibrcli add <id>`                       | add model preset |
| `ibrcli rm <id>`                        | remove model preset |
| `ibrcli switch <id>`                    | switch active model |
| `ibrcli sessions`                       | list saved sessions |
| `ibrcli resume <id>`                    | resume saved session |
| `ibrcli tools`                          | list available tools |
| `ibrcli doctor`                         | test API connection |
| `ibrcli run "<prompt>"`                 | one-shot prompt (streams response) |
| `ibrcli --yolo` / `--dangerously-skip-permissions` | enable bypass mode |
| `ibrcli --help` `-h`                    | help |
| `ibrcli --version` `-v`                 | version |

## Config file

Lives at `~/.ibr/config.json` (override with `IBR_CONFIG_DIR`). Every field is editable via `ibrcli config` or by editing the JSON directly.

```jsonc
{
  "api_url": "https://api.openai.com/v1",
  "api_key": "sk-...",  // stored mode 0600, never printed back
  "api_path": "/chat/completions",
  "system_prompt": "You are IBR, a helpful AI coding assistant...",
  "context_window": 8000,
  "gen": { "temperature": 0.7, "max_tokens": null, "top_p": 1, "frequency_penalty": 0, "presence_penalty": 0 },
  "headers": [],
  "models": [{ "id": "default", "model": "gpt-4o-mini", "context_window": 8000, "system_prompt": "", "gen": { ... } }],
  "active_model_id": "default",
  "request_timeout_ms": 120000,
  "stream": true,
  "theme": "midnight",
  "bypass_permissions": false  // set to true (or --yolo) to skip all permission prompts
}
```

## Works with any OpenAI-compatible endpoint

Point `api_url` at:

- OpenAI: `https://api.openai.com/v1`
- OpenRouter: `https://openrouter.ai/api/v1`
- Groq: `https://api.groq.com/openai/v1`
- Together: `https://api.together.xyz/v1`
- Mistral: `https://api.mistral.ai/v1`
- NVIDIA NIM: `https://integrate.api.nvidia.com/v1`
- Gemini (OpenAI-compat): `https://generativelanguage.googleapis.com/v1beta/openai`
- Ollama (local): `http://localhost:11434/v1`
- LM Studio (local): `http://localhost:1234/v1`
- vLLM, LiteLLM, llama.cpp server, LocalAI, your own custom server — anything that speaks `/chat/completions`.

The API client only sends `frequency_penalty`/`presence_penalty` when non-zero (some endpoints reject them otherwise).

## Environment overrides

| Var | Purpose |
|-----|---------|
| `IBR_API_URL`  | override `api_url` |
| `IBR_API_KEY`  | override `api_key` |
| `IBR_API_PATH` | override `api_path` |
| `IBR_MODEL`    | override active model preset |
| `IBR_CONFIG_DIR` | override config file location |
| `NO_COLOR`     | disable ANSI colors |
| `FORCE_COLOR`  | force color level (0/1/2/3) |

## Cross-platform notes

- **Termux (Android)**: `pkg install nodejs && npm install -g github:ibrdot/IBR-cli`
- **Windows cmd.exe**: ASCII box chars auto-fallback. Run `chcp 65001` for Unicode.
- **PowerShell / Windows Terminal**: full Unicode + truecolor.
- **Linux / macOS**: full Unicode + truecolor.
- **dumb pipes / CI**: streaming writes raw text (no `\r` overwrite), so logs are clean.

## Security

- API keys are stored in `~/.ibr/config.json` with file mode `0600` (owner-only).
- Keys are NEVER printed in terminal output, error messages, or logs.
- `ibrcli show` masks the key by default; pass `--reveal` to view it.
- `ibrcli doctor` masks the key.
- Status bar shows `sanitizeUrl(api_url)` (strips `?key=`/`?token=` query params if any).
- Error messages from the server are scrubbed for `Bearer xxx` and `"api_key":"xxx"` patterns.
- Session files (`.ibr/sessions/*.json`) are written mode `0600`.
- Existing config is NEVER overwritten by `ibrcli init` (idempotent).
- v1.x configs are auto-merged with new defaults on upgrade (no migration needed).

## License

MIT


