# Discord

The Discord bot runs inside `apps/server` via discord.js.

## Intents & triggers

**Intents:** Guilds, Guild Messages, Message Content, Direct Messages (plus partials for channel/message/attachment).

| Trigger | Channel key | Behavior |
|---------|-------------|----------|
| DM text | `discord:dm:{userId}` | Full agent turn |
| Guild `@mention` | `discord:guild:{channelId}` | Agent turn (mention stripped) |
| `/ask` | Same as DM or guild context | Prompt + optional image |
| `/status` | — | Online + sensitive/cron entitlement summary |

Image attachments on messages or `/ask` (up to 4) are fetched and passed to OpenRouter as multimodal content when the model supports vision.

## Allowlist

Sensitive tools require the author’s Discord snowflake in `authorized_discord_users` (WebUI **Discord** page).

Unauthorized users still get chat + **public** tools (fetch, memory read, skills, simple crons with limits).

## Slash commands

Registered globally when the bot becomes ready:

- `/ask prompt:… [image]` — ask the assistant
- `/status` — sensitive tools allowed/denied; cron limits for this user

## Crons from Discord

Users can ask the bot to create reminders; the agent uses `cron_create`. Untrusted Discord: max **3 active simple** jobs; **complex** denied. Allowlisted users: unlimited / complex OK. Delivery often uses `discord_dm` to the requester’s ID.

## Token

Set `DISCORD_TOKEN` in `.env` or Settings. Saving a new token in the WebUI restarts the bot connection.
