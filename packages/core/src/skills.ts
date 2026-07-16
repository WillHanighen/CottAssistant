import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export interface Skill {
  id: string;
  name: string;
  description: string;
  body: string;
  path: string;
}

export class SkillLoader {
  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  list(): Skill[] {
    if (!existsSync(this.dir)) return [];
    const skills: Skill[] = [];
    for (const entry of readdirSync(this.dir)) {
      const skillDir = join(this.dir, entry);
      if (!statSync(skillDir).isDirectory()) continue;
      const skillMd = join(skillDir, "SKILL.md");
      if (!existsSync(skillMd)) continue;
      const body = readFileSync(skillMd, "utf8");
      const nameMatch = body.match(/^#\s+(.+)$/m);
      const descMatch = body.match(/^>\s*(.+)$/m) ?? body.match(/^description:\s*(.+)$/im);
      skills.push({
        id: entry,
        name: nameMatch?.[1]?.trim() ?? entry,
        description: descMatch?.[1]?.trim() ?? "No description",
        body,
        path: skillDir,
      });
    }
    return skills;
  }

  get(id: string): Skill | null {
    return this.list().find((s) => s.id === id) ?? null;
  }

  promptBlock(): string {
    const skills = this.list();
    if (skills.length === 0) return "No skills installed.";
    return skills.map((s) => `- ${s.id}: ${s.description}`).join("\n");
  }
}
