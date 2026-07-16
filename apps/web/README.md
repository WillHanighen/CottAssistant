# @cottassistant/web

Localhost SvelteKit SPA for CottAssistant. Talks to the main server’s `/api` (cookie session).

## Dev

From the monorepo root:

```bash
bun run dev:all
# or
bun run --filter @cottassistant/web dev
```

Vite binds `127.0.0.1:5173` and proxies `/api` (and voice WS) to `127.0.0.1:8787`.

## Build

```bash
bun run build
```

Output: `apps/web/build` (static). The main Bun server can serve it on port 8787.

## Routes

| Path | Purpose |
|------|---------|
| `/` | Chat |
| `/setup` | First admin bootstrap |
| `/login` | Login |
| `/settings` | OpenRouter, Discord token, voice models |
| `/discord` | Discord allowlist |
| `/users` | Web users (admin) |
| `/voice` | Local hub + satellite points |
| `/crons` | Scheduled jobs |

See [docs/api.md](../../docs/api.md) and [docs/setup.md](../../docs/setup.md).
