import { z } from "zod";
import type { Actor, Sensitivity, CronComplexity, CronDeliver } from "@cottassistant/shared";
import { canUseTool, refusalMessage } from "@cottassistant/shared";
import type { MemoryStore } from "./memory";
import type { SkillLoader } from "./skills";
import type { Database } from "./db";
import {
  computeSchedule,
  cronCreateLimitError,
  deliverFlags,
  formatCronJob,
  resolveCronTargets,
} from "./cron";
import { resolve, relative, isAbsolute } from "node:path";
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";

export interface ToolContext {
  actor: Actor;
  memory: MemoryStore;
  skills: SkillLoader;
  workspaceRoot: string;
  db: Database;
  /** Voice sessions: mark that the mic should reopen after TTS. */
  requestFollowupListen?: () => void;
}

export interface ToolDefinition {
  name: string;
  description: string;
  sensitivity: Sensitivity;
  parameters: z.ZodType;
  /** OpenAI-compatible JSON schema fragment */
  jsonSchema: Record<string, unknown>;
  execute: (ctx: ToolContext, args: unknown) => Promise<string>;
}

function openAiTool(def: ToolDefinition): Record<string, unknown> {
  return {
    type: "function",
    function: {
      name: def.name,
      description: def.description,
      parameters: def.jsonSchema,
    },
  };
}

export function createToolRegistry(workspaceRoot: string): ToolDefinition[] {
  const ensureInside = (path: string): string => {
    const abs = isAbsolute(path) ? resolve(path) : resolve(workspaceRoot, path);
    const rel = relative(workspaceRoot, abs);
    if (rel.startsWith("..") || isAbsolute(rel)) {
      throw new Error("Path escapes workspace root");
    }
    return abs;
  };

  return [
    {
      name: "web_fetch",
      description: "Fetch a URL and return text content (truncated).",
      sensitivity: "public",
      parameters: z.object({ url: z.string().url() }),
      jsonSchema: {
        type: "object",
        properties: { url: { type: "string", description: "HTTP(S) URL" } },
        required: ["url"],
      },
      execute: async (_ctx, args) => {
        const { url } = z.object({ url: z.string().url() }).parse(args);
        const res = await fetch(url, {
          headers: { "User-Agent": "CottAssistant/0.1" },
          signal: AbortSignal.timeout(15_000),
        });
        const text = await res.text();
        return text.slice(0, 12_000);
      },
    },
    {
      name: "memory_list",
      description: "List memory markdown files.",
      sensitivity: "public",
      parameters: z.object({}),
      jsonSchema: { type: "object", properties: {} },
      execute: async (ctx) => JSON.stringify(ctx.memory.list(), null, 2),
    },
    {
      name: "memory_read",
      description: "Read a memory markdown file by name.",
      sensitivity: "public",
      parameters: z.object({ name: z.string() }),
      jsonSchema: {
        type: "object",
        properties: { name: { type: "string" } },
        required: ["name"],
      },
      execute: async (ctx, args) => {
        const { name } = z.object({ name: z.string() }).parse(args);
        return ctx.memory.read(name) || "(empty)";
      },
    },
    {
      name: "memory_write",
      description: "Write or overwrite a memory markdown file.",
      sensitivity: "sensitive",
      parameters: z.object({ name: z.string(), content: z.string() }),
      jsonSchema: {
        type: "object",
        properties: {
          name: { type: "string" },
          content: { type: "string" },
        },
        required: ["name", "content"],
      },
      execute: async (ctx, args) => {
        const { name, content } = z.object({ name: z.string(), content: z.string() }).parse(args);
        ctx.memory.write(name, content);
        return `Wrote memory file ${name}`;
      },
    },
    {
      name: "memory_append",
      description: "Append a line/note to a memory markdown file.",
      sensitivity: "sensitive",
      parameters: z.object({ name: z.string(), content: z.string() }),
      jsonSchema: {
        type: "object",
        properties: {
          name: { type: "string" },
          content: { type: "string" },
        },
        required: ["name", "content"],
      },
      execute: async (ctx, args) => {
        const { name, content } = z.object({ name: z.string(), content: z.string() }).parse(args);
        ctx.memory.append(name, content);
        return `Appended to ${name}`;
      },
    },
    {
      name: "list_skills",
      description: "List installed skills.",
      sensitivity: "public",
      parameters: z.object({}),
      jsonSchema: { type: "object", properties: {} },
      execute: async (ctx) =>
        JSON.stringify(
          ctx.skills.list().map((s) => ({ id: s.id, name: s.name, description: s.description })),
          null,
          2,
        ),
    },
    {
      name: "read_skill",
      description: "Read a skill's SKILL.md body.",
      sensitivity: "public",
      parameters: z.object({ id: z.string() }),
      jsonSchema: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
      execute: async (ctx, args) => {
        const { id } = z.object({ id: z.string() }).parse(args);
        const skill = ctx.skills.get(id);
        if (!skill) return `Skill not found: ${id}`;
        return skill.body;
      },
    },
    {
      name: "fs_list",
      description: "List files in a directory under the workspace root.",
      sensitivity: "sensitive",
      parameters: z.object({ path: z.string().default(".") }),
      jsonSchema: {
        type: "object",
        properties: { path: { type: "string" } },
      },
      execute: async (_ctx, args) => {
        const { path } = z.object({ path: z.string().default(".") }).parse(args);
        const abs = ensureInside(path);
        if (!existsSync(abs)) return "Path not found";
        const st = statSync(abs);
        if (!st.isDirectory()) return "Not a directory";
        return readdirSync(abs).join("\n");
      },
    },
    {
      name: "fs_read",
      description: "Read a text file under the workspace root.",
      sensitivity: "sensitive",
      parameters: z.object({ path: z.string() }),
      jsonSchema: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
      execute: async (_ctx, args) => {
        const { path } = z.object({ path: z.string() }).parse(args);
        const abs = ensureInside(path);
        if (!existsSync(abs)) return "File not found";
        return readFileSync(abs, "utf8").slice(0, 20_000);
      },
    },
    {
      name: "fs_write",
      description: "Write a text file under the workspace root.",
      sensitivity: "sensitive",
      parameters: z.object({ path: z.string(), content: z.string() }),
      jsonSchema: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" },
        },
        required: ["path", "content"],
      },
      execute: async (_ctx, args) => {
        const { path, content } = z.object({ path: z.string(), content: z.string() }).parse(args);
        const abs = ensureInside(path);
        writeFileSync(abs, content, "utf8");
        return `Wrote ${path}`;
      },
    },
    {
      name: "shell",
      description: "Run a shell command on the host (cwd = workspace). Sensitive.",
      sensitivity: "sensitive",
      parameters: z.object({ command: z.string() }),
      jsonSchema: {
        type: "object",
        properties: { command: { type: "string" } },
        required: ["command"],
      },
      execute: async (_ctx, args) => {
        const { command } = z.object({ command: z.string() }).parse(args);
        const proc = Bun.spawn(["bash", "-lc", command], {
          cwd: workspaceRoot,
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, code] = await Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
          proc.exited,
        ]);
        return `exit ${code}\nstdout:\n${stdout.slice(0, 8000)}\nstderr:\n${stderr.slice(0, 4000)}`;
      },
    },
    {
      name: "request_voice_followup",
      description:
        "VOICE MODE ONLY. Call this in the same turn whenever your spoken reply asks the user a question or needs their next answer. Opens the mic again after TTS. Do not call if you are finished. Do not ask a spoken question without calling this.",
      sensitivity: "public",
      parameters: z.object({}),
      jsonSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      execute: async (ctx) => {
        if (ctx.actor.kind !== "voice") {
          return "Not on a voice channel; ask the user in text instead.";
        }
        if (!ctx.requestFollowupListen) {
          return "Follow-up listen is not available in this session.";
        }
        ctx.requestFollowupListen();
        return "Follow-up armed. Speak one short clarifying question in your final reply. The mic will open after TTS with a start tone.";
      },
    },
    {
      name: "cron_create",
      description:
        "Schedule a reminder/alarm/check that fires later (and optionally repeats). When it fires, the assistant runs your prompt with the LLM and can reply via Discord DM, speak IRL (voice), or both. Use for 'in 10 minutes', 'remind me every X hours', alarms, etc. Simple jobs must stay under ~500 tokens when they run. Unauthorized Discord users may only create up to 3 active simple jobs.",
      sensitivity: "public",
      parameters: z.object({
        title: z.string(),
        prompt: z.string(),
        run_in_seconds: z.number().optional(),
        every_seconds: z.number().optional(),
        deliver: z.enum(["discord_dm", "voice", "both"]),
        complexity: z.enum(["simple", "complex"]).default("simple"),
        discord_user_id: z.string().optional(),
        voice_point_id: z.string().optional(),
      }),
      jsonSchema: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "Short label, e.g. 'Let dogs out'",
          },
          prompt: {
            type: "string",
            description:
              "Instruction for the assistant when the job fires (what to say/check/do).",
          },
          run_in_seconds: {
            type: "number",
            description: "Delay before first/only run (min 5). Optional if every_seconds is set.",
          },
          every_seconds: {
            type: "number",
            description: "Repeat interval in seconds (min 60). Omit for one-shot.",
          },
          deliver: {
            type: "string",
            enum: ["discord_dm", "voice", "both"],
            description: "Where to deliver the result: Discord DM, IRL voice, or both.",
          },
          complexity: {
            type: "string",
            enum: ["simple", "complex"],
            description:
              "simple = lightweight (≤500 tokens on run). complex = full tools/budget. Default simple.",
          },
          discord_user_id: {
            type: "string",
            description: "Discord snowflake to DM. Required for discord_dm/both unless requester is Discord.",
          },
          voice_point_id: {
            type: "string",
            description: "Voice point id to speak on (default: current voice point or 'local').",
          },
        },
        required: ["title", "prompt", "deliver"],
      },
      execute: async (ctx, args) => {
        const parsed = z
          .object({
            title: z.string().min(1).max(120),
            prompt: z.string().min(1).max(4000),
            run_in_seconds: z.number().optional(),
            every_seconds: z.number().optional(),
            deliver: z.enum(["discord_dm", "voice", "both"]),
            complexity: z.enum(["simple", "complex"]).default("simple"),
            discord_user_id: z.string().optional(),
            voice_point_id: z.string().optional(),
          })
          .parse(args);

        const complexity = parsed.complexity as CronComplexity;
        const deliver = parsed.deliver as CronDeliver;
        const activeSimple = ctx.db.countActiveSimpleCrons(ctx.actor.kind, ctx.actor.id);
        const limitErr = cronCreateLimitError(ctx.actor, complexity, activeSimple);
        if (limitErr) return limitErr;

        const schedule = computeSchedule({
          runInSeconds: parsed.run_in_seconds,
          everySeconds: parsed.every_seconds,
        });
        if (schedule.error) return schedule.error;

        const targets = resolveCronTargets({
          actor: ctx.actor,
          deliver,
          discordUserId: parsed.discord_user_id,
          voicePointId: parsed.voice_point_id,
        });
        if (targets.error) return targets.error;

        const flags = deliverFlags(deliver);
        const job = ctx.db.createCronJob({
          title: parsed.title.trim(),
          prompt: parsed.prompt.trim(),
          complexity,
          deliverDiscord: flags.deliverDiscord,
          deliverVoice: flags.deliverVoice,
          discordUserId: targets.discordUserId,
          voicePointId: targets.voicePointId,
          nextRunAt: schedule.nextRunAt,
          intervalMs: schedule.intervalMs,
          createdByKind: ctx.actor.kind,
          createdById: ctx.actor.id,
        });

        return `Created cron #${job.id}\n${formatCronJob(job)}`;
      },
    },
    {
      name: "cron_list",
      description: "List scheduled crons for the current user (active and recent).",
      sensitivity: "public",
      parameters: z.object({
        include_finished: z.boolean().optional(),
      }),
      jsonSchema: {
        type: "object",
        properties: {
          include_finished: {
            type: "boolean",
            description: "If true, also include completed/cancelled jobs.",
          },
        },
      },
      execute: async (ctx, args) => {
        const { include_finished } = z
          .object({ include_finished: z.boolean().optional() })
          .parse(args);
        const jobs = ctx.db.listCronJobs({
          createdByKind: ctx.actor.kind,
          createdById: ctx.actor.id,
          status: include_finished
            ? undefined
            : ["active", "paused"],
        });
        if (jobs.length === 0) return "No crons found for you.";
        return jobs.map(formatCronJob).join("\n\n");
      },
    },
    {
      name: "cron_cancel",
      description: "Cancel one of your active scheduled crons by id.",
      sensitivity: "public",
      parameters: z.object({ id: z.number() }),
      jsonSchema: {
        type: "object",
        properties: {
          id: { type: "number", description: "Cron job id from cron_list / cron_create" },
        },
        required: ["id"],
      },
      execute: async (ctx, args) => {
        const { id } = z.object({ id: z.number().int().positive() }).parse(args);
        const existing = ctx.db.getCronJob(id);
        if (!existing) return `Cron #${id} not found.`;
        const isOwner =
          existing.createdByKind === ctx.actor.kind && existing.createdById === ctx.actor.id;
        const canCancelAny =
          ctx.actor.kind === "web" || ctx.actor.kind === "voice" || ctx.actor.allowSensitive;
        if (!isOwner && !canCancelAny) {
          return `Cron #${id} is not yours.`;
        }
        if (existing.status === "cancelled" || existing.status === "completed") {
          return `Cron #${id} is already ${existing.status}.`;
        }
        const updated = ctx.db.cancelCronJob(id);
        if (!updated || updated.status !== "cancelled") {
          return `Could not cancel cron #${id}.`;
        }
        return `Cancelled cron #${id} (${updated.title}).`;
      },
    },
  ];
}

export function toolsAsOpenAI(tools: ToolDefinition[]): Record<string, unknown>[] {
  return tools.map(openAiTool);
}

export async function runTool(
  tools: ToolDefinition[],
  ctx: ToolContext,
  name: string,
  argsJson: string,
): Promise<string> {
  const tool = tools.find((t) => t.name === name);
  if (!tool) return `Unknown tool: ${name}`;
  if (!canUseTool(ctx.actor, tool.sensitivity)) {
    return refusalMessage(name);
  }
  let args: unknown = {};
  try {
    args = argsJson ? JSON.parse(argsJson) : {};
  } catch {
    return `Invalid JSON arguments for ${name}`;
  }
  try {
    return await tool.execute(ctx, args);
  } catch (err) {
    return `Tool error (${name}): ${err instanceof Error ? err.message : String(err)}`;
  }
}
