# CottAssistant

Personal AI on your local machine: **Discord**, **localhost WebUI**, and **wake-word voice** (openWakeWord → Whisper → Piper), powered by **OpenRouter**. Sensitive tools (shell, filesystem, memory writes) are gated by Discord allowlist or a logged-in WebUI / voice session.

## Quick start

```bash
bun install
cp .env.example .env          # optional bootstrap keys
bun run dev:all               # API (:8787) + WebUI (:5173) together
# or separately:
bun run dev                   # API + Discord + voice hub
bun run dev:web               # SvelteKit UI (proxies /api)
```

1. Open http://127.0.0.1:5173 (or build and use http://127.0.0.1:8787).
2. Create the first **admin** account on setup.
3. Under **Settings**, set OpenRouter (and optionally Discord) tokens.
4. Under **Discord**, add authorized Discord user IDs for sensitive tools.

## Features

| Surface | What you get |
|--------|----------------|
| WebUI | Chat, settings, users, Discord allowlist, voice points, crons |
| Discord | DMs, `@` mentions, `/ask` (+ image), `/status` |
| Voice | Local hub + optional satellite daemons; TTS follow-up mic |
| Agent | Tools, memory markdown, skills, scheduled crons |
| Vision | Image attachments on Discord (and multimodal OpenRouter models) |

## Scripts

| Script | Purpose |
|--------|---------|
| `bun run dev` | Main server (API, Discord, voice hub) on `127.0.0.1:8787` |
| `bun run dev:web` | SvelteKit UI with `/api` proxy |
| `bun run dev:all` | Server + WebUI without racing a production build |
| `bun run build` | Build WebUI into `apps/web/build` (served by main server) |
| `bun run voice-daemon` | Extra listen/speak point |
| `bun run typecheck` | Typecheck packages + server + voice-daemon |

## System prompt

Edit [`SYSTEM.md`](SYSTEM.md) for personality and standing instructions. At runtime the agent appends actor context, installed skills, and the tool list. Override path with `SYSTEM_PROMPT_PATH`.

## Layout

```
apps/server          Bun main process (API, Discord, voice hub, cron scheduler)
apps/web             SvelteKit SPA (localhost)
apps/voice-daemon    Satellite voice client
packages/core        Agent, SQLite, tools, audio, crons
packages/shared      Types, policy, WS protocol
data/                DB, memory, models, skills (mostly gitignored)
docs/                Documentation
```

## Docs

- [Architecture](docs/architecture.md)
- [Setup](docs/setup.md)
- [HTTP API](docs/api.md)
- [Tools & policy](docs/tools.md)
- [Discord](docs/discord.md)
- [Voice](docs/voice.md)
- [Crons](docs/crons.md)
- [Memory & skills](docs/memory-skills.md)
- [Development](docs/development.md)

## Env (bootstrap)

See [`.env.example`](.env.example). Keys can also be set in the WebUI after login.

| Variable | Default | Notes |
|----------|---------|--------|
| `HOST` / `PORT` | `127.0.0.1` / `8787` | Bind address |
| `DATA_DIR` | `./data` | SQLite, memory, models, skills |
| `SYSTEM_PROMPT_PATH` | `<workspace>/SYSTEM.md` | Base system prompt |
| `OPENROUTER_API_KEY` | — | Optional seed |
| `DISCORD_TOKEN` | — | Optional seed |
| `VOICE_DAEMON_TOKEN` | auto-generated | Shared with satellites |
