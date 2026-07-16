# Memory & skills

## Memory

Markdown files under `$DATA_DIR/memory/` (default `data/memory/`).

| Tool | Access |
|------|--------|
| `memory_list` / `memory_read` | Public |
| `memory_write` / `memory_append` | Sensitive |

Use for lasting preferences and notes the user asks to remember. Heartbeat-style daily notes may appear as `heartbeat-YYYY-MM-DD.md` when the agent appends them.

WebUI can list memory filenames via `GET /api/memory`.

## Skills

Folder packs under `$DATA_DIR/skills/<id>/` with a required `SKILL.md`:

```markdown
# Skill title

> One-line description (optional; used in listings)

Body instructions the agent should follow when this skill applies.
```

Discovered at startup by `SkillLoader`. The system prompt includes a short skills block; the model should `list_skills` / `read_skill` when relevant.

A sample `about` skill is created on first boot if missing. Edit or add packs under `data/skills/`.

| Tool | Access |
|------|--------|
| `list_skills` | Public |
| `read_skill` | Public |

`GET /api/skills` exposes the same inventory to the WebUI.

## Workspace files vs memory

- **Memory** — intentional assistant notes (`data/memory/`).
- **Filesystem tools** — scoped to the monorepo workspace root (`fs_*`); sensitive.
- **Skills** — playbooks, not free-form scratch space.
