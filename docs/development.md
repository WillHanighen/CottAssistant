# Development

## Stack

- **Runtime:** Bun (workspaces)
- **Language:** TypeScript end-to-end
- **DB:** `bun:sqlite`
- **HTTP:** `Bun.serve` (no Express)
- **WebUI:** SvelteKit 5 + Vite + Tailwind (`adapter-static`)
- **Discord:** discord.js
- **LLM:** OpenRouter chat completions + tools
- **Validation:** Zod (`packages/shared`)

Prefer Bun APIs in server/core code. The WebUI uses Vite (not Bun HTML imports).

## Scripts

```bash
bun install
bun run dev:all      # server + web
bun run typecheck
bun test             # from package dirs that have tests, or repo root if configured
```

Core tests live next to sources, e.g. `packages/core/src/*.test.ts`, `packages/shared/src/*.test.ts`. Run with `bun test` in those packages.

## Package boundaries

- `packages/shared` — types & protocol only (no Bun server I/O)
- `packages/core` — agent, DB, tools, audio (imported by server + daemon)
- `apps/server` — wiring: Discord, WS, HTTP routes, schedulers
- `apps/web` — UI only; talks to `/api`
- `apps/voice-daemon` — thin WS client + local audio/STT

## Conventions

- Bind WebUI and server to `127.0.0.1` by default.
- Never schedule “public API” style side effects without policy checks; tool sensitivity is enforced in `runTool`.
- Voice replies: plain speech; follow-ups require `request_voice_followup`.
- Keep secrets out of git (`.env`, SQLite, `data/models`).

## System prompt for agents

Human-facing docs are under `docs/`. The **model** base prompt is `SYSTEM.md` — update that when changing personality or standing tool guidance (crons, voice, emoji policy, etc.).

## CLAUDE.md / coding agents

Root `CLAUDE.md` is Bun-oriented guidance. For this repo specifically: use Bun for the server and tests; use the existing SvelteKit+Vite app for the WebUI rather than rewriting it as Bun HTML imports.
