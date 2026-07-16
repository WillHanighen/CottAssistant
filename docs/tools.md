# Tools & policy

Tools live in `packages/core/src/tools.ts`. Each tool has a **sensitivity**: `public` or `sensitive`. The actor’s `allowSensitive` flag gates sensitive tools; refusals return a clear message (no fake success).

## Sensitivity matrix

| Surface | Actor | Sensitive tools |
|---------|-------|-----------------|
| WebUI chat | Logged-in web user | Allowed |
| Voice (local / satellite) | Voice point | Allowed (owner-trusted) |
| Discord allowlisted ID | Discord user | Allowed |
| Discord other users | Discord user | Public tools only |

Sensitive-tool refusal (Discord unauthorized): add the Discord user ID in the WebUI, or use a logged-in WebUI / voice session.

## Tool catalog

| Tool | Sensitivity | Purpose |
|------|-------------|---------|
| `web_fetch` | public | Fetch URL text (truncated) |
| `memory_list` | public | List memory files |
| `memory_read` | public | Read a memory file |
| `memory_write` | sensitive | Overwrite a memory file |
| `memory_append` | sensitive | Append to a memory file |
| `list_skills` | public | List installed skills |
| `read_skill` | public | Read a skill’s `SKILL.md` |
| `fs_list` | sensitive | List dir under workspace root |
| `fs_read` | sensitive | Read file under workspace (capped) |
| `fs_write` | sensitive | Write file under workspace |
| `shell` | sensitive | `bash -lc` in workspace cwd |
| `request_voice_followup` | public | Voice only: reopen mic after TTS |
| `cron_create` | public | Schedule reminder / recurring job |
| `cron_list` | public | List your crons |
| `cron_cancel` | public | Cancel a cron (owner or trusted) |

Filesystem tools resolve paths under the monorepo **workspace root** and reject path escape.

## Voice follow-up

On voice channels, asking a question in speech does **not** reopen the mic. The model must call `request_voice_followup` in the same turn. See [voice.md](voice.md) and `SYSTEM.md`.

## Crons via tools

`cron_create` / `cron_list` / `cron_cancel` are public but enforce complexity limits for untrusted Discord actors. Details in [crons.md](crons.md).
