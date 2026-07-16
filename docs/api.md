# HTTP API

Base URL: `http://127.0.0.1:8787`. JSON bodies. Session auth uses an HTTP-only cookie (`cottassistant_session`).

Unauthenticated endpoints are listed first. Everything else under `/api/*` requires a valid session unless noted.

## Public / bootstrap

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | `{ ok, users }` |
| GET | `/api/bootstrap` | `{ needsSetup }` — true when no users |
| POST | `/api/setup` | Create first admin; sets session cookie |
| POST | `/api/login` | `{ username, password }` → user + cookie |
| POST | `/api/logout` | Clears session |
| GET | `/api/me` | `{ user }` or `{ user: null }` |

## Account

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/me/password` | Change password; other sessions revoked |

## Users (admin)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/users` | List users |
| POST | `/api/users` | Create user `{ username, password, role? }` |
| PATCH | `/api/users/:id` | Update role / password (admin) |

## Chat

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/chat` | `{ message }` → agent reply for `web:{userId}` |
| GET | `/api/chat/history` | Message history for current web channel |

## Settings & models

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/settings` | Settings (secrets masked) |
| PUT | `/api/settings` | Update settings; may restart Discord / voice |
| GET | `/api/models/catalog` | Wake / Whisper / Piper options + ready flags |
| POST | `/api/models/ensure` | Download selected models into `data/models/` |

## Discord allowlist

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/discord/users` | Authorized Discord IDs |
| POST | `/api/discord/users` | `{ discordId, label? }` |
| DELETE | `/api/discord/users/:id` | Remove allowlist entry |

## Audio / voice

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/audio/devices` | Host input/output devices |
| GET | `/api/voice/points` | Local + connected satellites |
| PUT | `/api/voice/points/local` | Local hub device prefs / enable |
| PUT | `/api/voice/points/:id` | Satellite device prefs |

## Tools, skills, memory (read)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/tools` | Registered tool names / sensitivity |
| GET | `/api/skills` | Installed skills |
| GET | `/api/memory` | Memory file list |

## Crons

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/crons` | All jobs; `?mine=1` for current web user only |
| POST | `/api/crons` | Create job (web actor, trusted) |
| DELETE | `/api/crons/:id` | Cancel job |

### POST `/api/crons` body

```json
{
  "title": "Let dogs out",
  "prompt": "Remind the user to let the dogs out.",
  "runInSeconds": 600,
  "everySeconds": null,
  "deliver": "discord_dm",
  "complexity": "simple",
  "discordUserId": "123456789012345678",
  "voicePointId": "local"
}
```

`deliver`: `discord_dm` | `voice` | `both`. Provide `runInSeconds` and/or `everySeconds` (min 5s delay, min 60s interval).

## WebSocket

| Path | Purpose |
|------|---------|
| `/ws/voice` | Satellite daemon protocol (see [voice.md](voice.md)) |

## Errors

Typical shapes: `{ "error": "message" }` with HTTP 400 / 401 / 403 / 404.
