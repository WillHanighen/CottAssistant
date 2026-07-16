# @cottassistant/server

Main Bun process: HTTP API, static WebUI, Discord bot, local voice hub, voice WebSocket, cron scheduler.

```bash
bun run --filter @cottassistant/server dev   # bun --hot
bun run --filter @cottassistant/server start
```

Default bind: `127.0.0.1:8787`. See [docs/architecture.md](../../docs/architecture.md) and [docs/api.md](../../docs/api.md).
