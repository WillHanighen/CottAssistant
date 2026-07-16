import { mkdirSync, readdirSync, readFileSync, writeFileSync, appendFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

export class MemoryStore {
  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  list(): string[] {
    return readdirSync(this.dir).filter((f) => f.endsWith(".md"));
  }

  read(name: string): string {
    const safe = name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = join(this.dir, safe.endsWith(".md") ? safe : `${safe}.md`);
    if (!existsSync(path)) return "";
    return readFileSync(path, "utf8");
  }

  write(name: string, content: string): void {
    const safe = name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = join(this.dir, safe.endsWith(".md") ? safe : `${safe}.md`);
    writeFileSync(path, content, "utf8");
  }

  append(name: string, content: string): void {
    const safe = name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = join(this.dir, safe.endsWith(".md") ? safe : `${safe}.md`);
    appendFileSync(path, content.endsWith("\n") ? content : `${content}\n`, "utf8");
  }

  heartbeatNote(text: string): void {
    const day = new Date().toISOString().slice(0, 10);
    this.append(`heartbeat-${day}.md`, `- ${new Date().toISOString()}: ${text}`);
  }

  root(): string {
    return resolve(this.dir);
  }
}
