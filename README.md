# IBR cli

Minimal AI chat CLI for any OpenAI-compatible API. No built-in providers, no telemetry, no nonsense — just your API URL, your API key, your model.

Works on Termux (Android), Linux, macOS, and Windows (cmd.exe / PowerShell / Windows Terminal).

## Install

```bash
npm install -g ibr-cli
```

Requires Node 18+.

## Quick start

```bash
ibr init              # writes ~/.ibr/config.json
ibr config            # interactive editor — set API URL, key, model, etc.
ibr                   # start chatting
```

Or one-shot:

```bash
ibr run "explain this bash one-liner: ls -la | awk '{print \$9}'"
echo "what is 2+2" | ibr chat
```

## Config file

Lives at `~/.ibr/config.json` (override with `IBR_CONFIG_DIR`). Every field is editable via `ibr config` or by editing the JSON directly.

```jsonc
{
  "api_url": "https://api.openai.com/v1",
  "api_key": "sk-...",
  "api_path": "/chat/completions",
  "system_prompt": "You are IBR, a helpful assistant in the terminal.",
  "context_window": 128000,
  "gen": {
    "temperature": 0.7,
    "max_tokens": null,
    "top_p": 1,
    "frequency_penalty": 0,
    "presence_penalty": 0
  },
  "headers": [],
  "models": [
    { "id": "fast", "model": "gpt-4o-mini", "context_window": 128000, "system_prompt": "", "gen": { "temperature": 0.5, "max_tokens": null, "top_p": 1, "frequency_penalty": 0, "presence_penalty": 0 } }
  ],
  "active_model_id": "fast",
  "request_timeout_ms": 120000,
  "stream": true,
  "theme": "midnight"
}
```

## Works with any OpenAI-compatible endpoint

Point `api_url` at:

- OpenAI: `https://api.openai.com/v1`
- OpenRouter: `https://openrouter.ai/api/v1`
- Groq: `https://api.groq.com/openai/v1`
- Together: `https://api.together.xyz/v1`
- Mistral: `https://api.mistral.ai/v1`
- Ollama (local): `http://localhost:11434/v1`
- LM Studio (local): `http://localhost:1234/v1`
- vLLM, LiteLLM, llama.cpp server, LocalAI, your own custom server — anything that speaks `/chat/completions`.

Use `api_path` to override the request path (e.g. `/responses` for OpenAI Responses API).

## Slash commands

| Command | Action |
|---------|--------|
| `/help`        | show commands |
| `/config`     | interactive config editor |
| `/models`     | list model presets |
| `/switch <id>` | switch active model |
| `/add <id>`   | add a model preset |
| `/rm <id>`    | remove a model preset |
| `/cost`       | estimated tokens used |
| `/clear`      | clear conversation |
| `/quit`       | exit |

Start a message with ` ``` ` to enter multi-line mode (end with a blank line).

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

- **Termux**: install Node (`pkg install nodejs`), then `npm i -g ibr-cli`.
- **Windows cmd.exe**: ASCII box chars auto-fallback when ANSI is unavailable. Run `chcp 65001` for Unicode.
- **PowerShell / Windows Terminal**: full Unicode + truecolor.
- **Linux / macOS**: full Unicode + truecolor.
- **dumb pipes / CI**: streaming auto-degrades to plain append.

## License

MIT
