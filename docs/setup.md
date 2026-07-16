# Setup

## Requirements

- [Bun](https://bun.sh) (runtime + package manager)
- Linux recommended for voice (PipeWire/ALSA helpers: `pw-record` / `pw-play` or `parec` / `paplay`)
- For voice STT/TTS: `whisper-cli` and `piper` / `piper-tts` on `PATH`
- Optional: Discord bot token, OpenRouter API key

## Install

```bash
cd CottAssistant
bun install
cp .env.example .env
```

Edit `.env` only if you want bootstrap secrets before opening the WebUI:

```bash
HOST=127.0.0.1
PORT=8787
DATA_DIR=./data
# SYSTEM_PROMPT_PATH=./SYSTEM.md
OPENROUTER_API_KEY=
DISCORD_TOKEN=
VOICE_DAEMON_TOKEN=
```

Bun loads `.env` automatically. Prefer setting tokens in **Settings** after the first admin exists.

## Run

```bash
# Recommended while developing UI + API
bun run dev:all

# Or split terminals
bun run dev
bun run dev:web
```

| URL | Use |
|-----|-----|
| http://127.0.0.1:5173 | Vite WebUI (dev) |
| http://127.0.0.1:8787 | API (+ built SPA after `bun run build`) |

## First-time WebUI

1. Visit the WebUI. If no users exist, `/setup` creates the first **admin** (password min 8 chars).
2. **Settings** → OpenRouter API key + model (default `openai/gpt-4.1-mini`).
3. Optional: Discord bot token → save (bot reconnects).
4. **Discord** page → add your Discord user snowflake for sensitive tools.
5. Optional: **Users** (admin) → create additional web accounts.

## Discord bot

1. Create an application + bot in the [Discord Developer Portal](https://discord.com/developers/applications).
2. Enable intents: **Message Content**, **Server Members** not required; need Guilds, Guild Messages, Direct Messages.
3. Invite the bot to your server with message/slash permissions.
4. Paste the bot token in WebUI Settings.
5. Add your user ID under **Discord** (Developer Mode → Copy User ID).

Slash commands `/ask` and `/status` register on bot ready.

## Voice binaries & models

1. Install CLI tools on the host (names configurable in Settings):
   - Whisper: `whisper-cli` (default)
   - Piper: `piper-tts` (default)
2. In **Settings**, pick wake word / Whisper / Piper from the catalog and save.
3. Models download into `data/models/` via **Ensure models** / settings save.
4. **Voice** page: select host mic/speakers, enable the local hub.

Defaults favor quality on ~8GB+ VRAM hosts (`medium.en` Whisper, `en_US-lessac-high` Piper, `hey_jarvis` wake). Lighter options remain in the dropdowns.

## Satellite daemon

```bash
VOICE_DAEMON_TOKEN=<from WebUI Voice / Settings> \
VOICE_POINT_NAME="Kitchen" \
VOICE_POINT_ID=kitchen \
COTT_SERVER_URL=ws://127.0.0.1:8787/ws/voice \
bun run voice-daemon
```

Configure each point’s input/output in the WebUI once connected. See [voice.md](voice.md).

## Data directory

| Path | Contents |
|------|----------|
| `data/cottassistant.sqlite` | App DB |
| `data/memory/` | Memory markdown |
| `data/skills/` | Skill packs |
| `data/models/` | Downloaded voice models |

Most of `data/` is gitignored; skills under `data/skills/` may be committed if you choose.
