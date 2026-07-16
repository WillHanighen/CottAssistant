import { test, expect } from "bun:test";
import { buildSystemPrompt, loadSystemPromptBase } from "./system-prompt";
import { SkillLoader } from "./skills";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("buildSystemPrompt appends runtime sections after base", () => {
  const dir = join(tmpdir(), `cott-skills-${crypto.randomUUID()}`);
  mkdirSync(join(dir, "demo"), { recursive: true });
  writeFileSync(join(dir, "demo", "SKILL.md"), "# Demo\n\n> A demo skill\n\nBody.\n");
  const skills = new SkillLoader(dir);

  const prompt = buildSystemPrompt({
    base: "# CottAssistant\n\nBe helpful.",
    actor: { kind: "web", id: "1", allowSensitive: true },
    skills,
    tools: [
      {
        name: "shell",
        description: "Run a command",
        sensitivity: "sensitive",
        parameters: {} as never,
        jsonSchema: {},
        execute: async () => "",
      },
    ],
  });

  expect(prompt.startsWith("# CottAssistant")).toBe(true);
  expect(prompt).toContain("## Runtime context");
  expect(prompt).toContain("Sensitive tools allowed: yes");
  expect(prompt).toContain("## Installed skills");
  expect(prompt).toContain("demo:");
  expect(prompt).toContain("## Available tools");
  expect(prompt).toContain("`shell`");

  rmSync(dir, { recursive: true, force: true });
});

test("buildSystemPrompt includes voice mode section for voice actors", () => {
  const dir = join(tmpdir(), `cott-skills-${crypto.randomUUID()}`);
  mkdirSync(join(dir, "demo"), { recursive: true });
  writeFileSync(join(dir, "demo", "SKILL.md"), "# Demo\n\n> A demo skill\n\nBody.\n");
  const skills = new SkillLoader(dir);

  const prompt = buildSystemPrompt({
    base: "# CottAssistant\n\nBe helpful.",
    actor: { kind: "voice", id: "local", allowSensitive: true },
    skills,
    tools: [],
  });

  expect(prompt).toContain("VOICE MODE");
  expect(prompt).toContain("request_voice_followup");
  expect(prompt).toContain("NO Markdown");

  rmSync(dir, { recursive: true, force: true });
});
