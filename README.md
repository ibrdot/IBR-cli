# IBR cli

World's most powerful AI coding CLI for any OpenAI-compatible API. Tools, sessions, slash commands, project detection — no built-in providers, no telemetry. Works on Termux (Android), Linux, macOS, and Windows.

## What it does

- **Tool calling** — the AI can read/write/edit files, list dirs, glob, grep, run shell, fetch URLs, manage todos
- **Sessions** — auto-saved, resumable, branchable
- **Slash commands** — `/help /config /models /switch /add /rm /tools /sessions /resume /save /cost /cwd /cd /ls /doctor /show /clear /quit`
- **Project context detection** — auto-detects Node, Rust, Go, Python, Java, etc.
- **Streaming SSE** with non-streaming fallback
- **Context-window-aware history trimming**
- **Cross-platform** — pure JS, no native deps, ASCII fallback for cmd.exe

## Install

```bash
npm install -g https://github.com/ibrdot/IBR-cli/releases/download/v2.0.0/ibr-cli-2.0.0.tgz
```

Or from GitHub directly:

```bash
npm install -g github:ibrdot/IBR-cli
```

Requires Node 18+.

## Quick start

```bash
# one-line setup
ibrcli login https://integrate.api.nvidia.com/v1 nvapi-xxx z-ai/glm-5.3

# or set fields individually
ibrcli set api_url https://api.openai.com/v1
ibrcli set api_key sk-xxx
ibrcli switch default

# test it
ibrcli doctor

# start chatting
ibrcli
```

## Tools (model can call these)

| Tool | Description | Permission |
|------|-------------|------------|
| `read_file`     | Read a file from disk                    | no |
| `write_file`    | Write/create/overwrite a file           | **yes** |
| `edit_file`     | Apply old→new text replacement to a file | **yes** |
| `list_dir`      | List directory entries                  | no |
| `glob`          | File pattern matching (`**/*.ts`)        | no |
| `grep`          | Search file contents (uses ripgrep)     | no |
| `run_bash`      | Execute shell command                   | **yes** |
| `web_fetch`     | Fetch URL, HTML stripped to text        | no |
| `todo_write`    | Manage a shared todo list              | no |

Permission prompts appear inline as `allow? [y/N]` before destructive tools run.

## Config file

Lives at `~/.ibr/config.json` (override with `IBR_CONFIG_DIR`). Every field is editable via `ibrcli config` or by editing the JSON.

```jsonc
{
  "api_url": "https://integrate.api.nvidia.com/v1",
  "api_key": "nvapi-...",
  "api_path": "/chat/completions",
  "system_prompt": "You are IBR, a helpful AI coding assistant...",
  "context_window": 128000,
  "gen": { "temperature": 0.7, "max_tokens": null, "top_p": 1, "frequency_penalty": 0, "presence_penalty": 0 },
  "headers": [],
  "models": [{ "id": "glm", "model": "z-ai/glm-5.3", "context_window": 128000, "system_prompt": "", "gen": { ... } }],
  "active_model_id": "glm",
  "request_timeout_ms": 120000,
  "stream": true,
  "theme": "midnight"
}
```

## Works with any OpenAI-compatible endpoint

Point `api_url` at:

- NVIDIA NIM: `https://integrate.api.nvidia.com/v1`
- OpenAI: `https://api.openai.com/v1`
- OpenRouter: `https://openrouter.ai/api/v1`
- Groq: `https://api.groq.com/openai/v1`
- Together: `https://api.together.xyz/v1`
- Mistral: `https://api.mistral.ai/v1`
- Ollama (local): `http://localhost:11434/v1`
- LM Studio (local): `http://localhost:1234/v1`
- vLLM, LiteLLM, llama.cpp server, LocalAI, your own custom server — anything that speaks `/chat/completions`.

## CLI commands

| Command | Action |
|---------|--------|
| `ibrcli`                       | start chat (interactive) |
| `ibrcli chat`                  | same as above |
| `ibrcli login <url> <key> <model>` | one-shot setup |
| `ibrcli set <field> <value>`   | set any config field (e.g. `set api_key xxx`) |
| `ibrcli config`                | interactive config editor |
| `ibrcli init`                  | write default config |
| `ibrcli show`                  | print config as JSON |
| `ibrcli path`                  | print config file path |
| `ibrcli models`                | list model presets |
| `ibrcli add <id>`              | add model preset |
| `ibrcli rm <id>`               | remove model preset |
| `ibrcli switch <id>`           | switch active model |
| `ibrcli sessions`              | list saved sessions |
| `ibrcli resume <id>`          | resume saved session |
| `ibrcli tools`                 | list available tools |
| `ibrcli doctor`                | test API connection |
| `ibrcli run "<prompt>"`        | one-shot prompt |
| `ibrcli --help` `-h`           | help |
| `ibrcli --version` `-v`        | version |

## Slash commands (inside chat)

| Command | Action |
|---------|--------|
| `/help`         | show commands |
| `/config`       | interactive config editor |
| `/models`       | list model presets |
| `/switch <id>`  | switch active model |
| `/add <id>`     | add a model preset |
| `/rm <id>`      | remove a model preset |
| `/tools`        | list available tools |
| `/sessions`     | list saved sessions |
| `/resume <id>`  | resume a saved session |
| `/save`         | save current session |
| `/cost`         | estimated tokens used |
| `/cwd`          | show working directory |
| `/cd <dir>`     | change working directory |
| `/ls`           | list files in cwd |
| `/doctor`       | test API connection |
| `/show`         | print current config |
| `/clear`        | clear conversation |
| `/quit`         | exit |

Start a message with ` ``` ` to enter multi-line mode (end with a blank line). `Ctrl+C` cancels a streaming response.

## Environment overrides

| Var | Purpose |
|-----|---------|
| `IBR_API_URL`  | override `api_url` |
| `IBR_API_KEY`  | override `api_key` |
| `IBR_API_PATH` | override `api_path` |
| `IBR_MODEL`    | override active model preset |
| `NO_COLOR`     | disable ANSI colors |
| `FORCE_COLOR`  | force color level (0/1/2/3) |

## Cross-platform notes

- **Termux (Android)**: `pkg install nodejs && npm install -g github:ibrdot/IBR-cli`
- **Windows cmd.exe**: ASCII box chars auto-fallback. Run `chcp 65001` for Unicode.
- **PowerShell / Windows Terminal**: full Unicode + truecolor.
- **Linux / macOS**: full Unicode + truecolor.
- **dumb pipes / CI**: streaming auto-degrades to plain append.

## License

MIT
