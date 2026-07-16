# About CottAssistant

> How this local assistant is set up and what surfaces it uses.

CottAssistant runs on the user’s machine with three surfaces:

1. **WebUI** (localhost) — chat, settings, Discord allowlist, voice points, crons, users.
2. **Discord** — DMs, @mentions, `/ask` (optional image), `/status`. Sensitive tools need an allowlisted Discord user ID.
3. **Voice** — wake word → Whisper → agent → Piper. Local hub plus optional satellite daemons. Follow-up mic only after `request_voice_followup`.

LLM: **OpenRouter**. Personality and standing rules live in `SYSTEM.md` at the repo root. Memory is markdown under `data/memory/`; skills are folders under `data/skills/` with a `SKILL.md`.

When asked how you work, summarize this skill and point at the relevant surface (WebUI settings, Discord allowlist, voice devices, or crons) without dumping huge internals unless asked.
