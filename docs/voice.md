# Voice

Pipeline: **wake word (openWakeWord)** → **utterance capture** → **Whisper STT** → **agent** → **Piper TTS** → speakers.

The browser is never the assistant’s mic/speaker — only config and chat. Capture/play happen on the **host** or a **satellite daemon**.

## Local hub

Managed by `apps/server` (`LocalVoiceHub`):

1. Enable voice and pick input/output on the **Voice** page.
2. Ensure models are downloaded (Settings catalog).
3. Wake → record until silence → transcribe → agent (`voice:local`) → speak.

Voice actors are trusted (`allowSensitive: true`).

## Follow-up listening

If the agent needs another spoken answer, it must call `request_voice_followup`. After TTS, the mic opens again (local hub or `listen_again` to a satellite). Do not rely on a question mark in the spoken text alone.

TTS strips Markdown so speech stays plain.

## Models

Catalog in `packages/core/src/model-catalog.ts`. Defaults:

| Kind | Default id |
|------|------------|
| Wake | `hey_jarvis` |
| Whisper | `medium.en` |
| Piper | `en_US-lessac-high` |

Installed under `data/models/`. Binary names default to `whisper-cli` and `piper-tts` (overridable in Settings).

## Satellite daemon

`apps/voice-daemon` connects to `ws://HOST:PORT/ws/voice`.

```bash
VOICE_DAEMON_TOKEN=<shared token> \
VOICE_POINT_ID=kitchen \
VOICE_POINT_NAME="Kitchen" \
COTT_SERVER_URL=ws://127.0.0.1:8787/ws/voice \
bun run voice-daemon
```

Optional: `DATA_DIR`, `MODELS_DIR`, `WHISPER_BINARY`, `WHISPER_MODEL`.

Device lists are reported by the daemon; the WebUI applies `set_devices` back to that host.

## WebSocket protocol

Defined in `packages/shared/src/protocol.ts`.

**Daemon → server:** `hello`, `device_list`, `wake`, `transcript`, `audio_chunk`, `ping`  
**Server → daemon:** `welcome`, `error`, `set_devices`, `tts_audio`, `pong`, `request_devices`, `listen_again`

Auth: `hello.token` must match the configured voice daemon token.

## Cron delivery

Jobs with `deliver: voice` or `both` speak on `voicePointId` (`local` or a satellite id) via the same TTS path.
