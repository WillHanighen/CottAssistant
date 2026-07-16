# Crons

Scheduled jobs run inside the main process (`CronScheduler`). When due, the agent runs the job’s **prompt** on channel `cron:{id}`, then delivers the reply.

## Delivery

| `deliver` | Effect |
|-----------|--------|
| `discord_dm` | DM `discordUserId` |
| `voice` | Speak on `voicePointId` (default `local`) |
| `both` | DM + speak |

From Discord, `discord_user_id` defaults to the requester. From web/voice, pass a Discord snowflake when delivering to Discord.

## Schedule

| Field | Rules |
|-------|--------|
| `run_in_seconds` / `runInSeconds` | Delay before first run; minimum **5** |
| `every_seconds` / `everySeconds` | Repeat interval; minimum **60**; omit for one-shot |

At least one of delay or interval is required. If only interval is set, first fire is after one interval.

## Complexity

| Kind | Intent |
|------|--------|
| `simple` | Lightweight when it fires (~**500** tokens budget) |
| `complex` | Full tools / larger budget |

Prefer `simple` for alarms and short reminders.

## Trust limits

| Creator | Limits |
|---------|--------|
| WebUI, voice, Discord allowlist | Unlimited; complex allowed |
| Discord not on allowlist | Max **3** active **simple** jobs; complex refused |

Constants: `CRON_SIMPLE_TOKEN_BUDGET`, `CRON_UNTRUSTED_MAX_SIMPLE` in `@cottassistant/shared`.

## Surfaces

- **Agent tools:** `cron_create`, `cron_list`, `cron_cancel`
- **WebUI:** Crons page + `GET/POST/DELETE /api/crons`
- **SYSTEM.md:** Instructs the model when to schedule

## Status lifecycle

`active` → runs → one-shot becomes `completed`; recurring updates `next_run_at`. Cancel → `cancelled`. Soft fields: `last_run_at`, `last_tokens`.
