import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface AppConfig {
  host: string;
  port: number;
  dataDir: string;
  dbPath: string;
  memoryDir: string;
  skillsDir: string;
  modelsDir: string;
  systemPromptPath: string;
  discordToken?: string;
  openrouterApiKey?: string;
  voiceDaemonToken?: string;
  workspaceRoot: string;
}

/** Monorepo root: packages/core/src → ../../.. */
function defaultWorkspaceRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, "../../..");
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const workspaceRoot = resolve(env.WORKSPACE_ROOT ?? defaultWorkspaceRoot());
  const dataDir = resolve(env.DATA_DIR ?? join(workspaceRoot, "data"));
  return {
    host: env.HOST ?? "127.0.0.1",
    port: Number(env.PORT ?? "8787"),
    dataDir,
    dbPath: resolve(dataDir, "cottassistant.sqlite"),
    memoryDir: resolve(dataDir, "memory"),
    skillsDir: resolve(dataDir, "skills"),
    modelsDir: resolve(dataDir, "models"),
    systemPromptPath: resolve(
      env.SYSTEM_PROMPT_PATH ?? join(workspaceRoot, "SYSTEM.md"),
    ),
    discordToken: env.DISCORD_TOKEN || undefined,
    openrouterApiKey: env.OPENROUTER_API_KEY || undefined,
    voiceDaemonToken: env.VOICE_DAEMON_TOKEN || undefined,
    workspaceRoot,
  };
}
