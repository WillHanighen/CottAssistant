import { existsSync, readFileSync } from "node:fs";
import type { Actor } from "@cottassistant/shared";
import type { SkillLoader } from "./skills";
import type { ToolDefinition } from "./tools";

const FALLBACK_PROMPT = `You are CottAssistant, a personal AI assistant running locally on the user's machine.
Be concise and helpful. Prefer tools over guessing about local state.`;

export function loadSystemPromptBase(path: string): string {
  if (!existsSync(path)) return FALLBACK_PROMPT;
  const text = readFileSync(path, "utf8").trim();
  return text || FALLBACK_PROMPT;
}

/** Build the full system prompt: static SYSTEM.md + runtime sections. */
export function buildSystemPrompt(opts: {
  base: string;
  actor: Actor;
  skills: SkillLoader;
  tools: ToolDefinition[];
}): string {
  const sections: string[] = [opts.base.trim()];

  sections.push(
    [
      "## Runtime context",
      "",
      `- Actor: \`${opts.actor.kind}:${opts.actor.id}\``,
      `- Sensitive tools allowed: ${opts.actor.allowSensitive ? "yes" : "no"}`,
    ].join("\n"),
  );

  if (opts.actor.kind === "voice") {
    sections.push(
      [
        "## VOICE MODE (mandatory)",
        "",
        "You are on a LIVE MICROPHONE + SPEAKER channel right now — not chat, not Discord text.",
        "",
        "Output rules:",
        "- Speak in plain spoken English only. NO Markdown, NO bullet lists, NO code fences, NO bold/italic markers, NO headings, NO URLs unless you must say them out loud.",
        "- Keep replies short: one to three sentences you would actually say aloud.",
        "- Sound warm, playful, and a little theatrical — still useful, never stiff.",
        "",
        "Follow-up mic (critical):",
        "- Follow-up mic opens ONLY if you call `request_voice_followup`. Asking a question in speech alone does nothing — you must call the tool.",
        "- If your spoken reply asks the user a question or needs their next answer, you MUST call the tool `request_voice_followup` in the SAME turn BEFORE your final spoken reply.",
        "- If you are finished and not waiting on them, do NOT call `request_voice_followup`.",
        "- Pattern when clarifying: call `request_voice_followup`, then speak one short clear question.",
        "- Pattern when done: just speak the answer; no follow-up tool — even if you used a question mark rhetorically.",
        "- Never call `request_voice_followup` unless you actually want the mic to open again.",
      ].join("\n"),
    );
  }

  sections.push(
    [
      "## Installed skills",
      "",
      opts.skills.promptBlock(),
      "",
      "Use `list_skills` / `read_skill` when a skill applies.",
    ].join("\n"),
  );

  const toolLines = opts.tools.map(
    (t) => `- \`${t.name}\` (${t.sensitivity}): ${t.description}`,
  );
  sections.push(["## Available tools", "", ...toolLines].join("\n"));

  return sections.join("\n\n");
}
