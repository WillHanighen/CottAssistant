import type { Actor, ChatImage, ChatMessage, CronJob, SessionChannel } from "@cottassistant/shared";
import { CRON_SIMPLE_TOKEN_BUDGET } from "@cottassistant/shared";
import type { Database } from "./db";
import type { MemoryStore } from "./memory";
import type { SkillLoader } from "./skills";
import { createToolRegistry, runTool, toolsAsOpenAI, type ToolDefinition } from "./tools";
import { buildSystemPrompt, loadSystemPromptBase } from "./system-prompt";
import { buildMultimodalUserContent, historyNoteForImages } from "./images";
import { stripMarkdownForSpeech } from "./voice-text";

export interface AgentOptions {
  db: Database;
  memory: MemoryStore;
  skills: SkillLoader;
  workspaceRoot: string;
  systemPromptPath: string;
  getApiKey: () => string | undefined;
  getModel: () => string;
}

export interface ChatInput {
  text: string;
  images?: ChatImage[];
}

export interface ChatResult {
  text: string;
  /** True when the model called request_voice_followup (re-open mic after TTS). */
  listenAgain: boolean;
}

export interface ScheduledJobResult {
  text: string;
  totalTokens: number | null;
  exceededSimpleBudget: boolean;
}

interface OpenRouterMessage {
  role: string;
  content?:
    | string
    | null
    | Array<{ type: string; text?: string; image_url?: { url: string } }>;
  name?: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
}

interface OpenRouterUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

/** Tools allowed during simple cron runs (keep token use low). */
const SIMPLE_CRON_TOOLS = new Set([
  "web_fetch",
  "memory_list",
  "memory_read",
  "list_skills",
  "read_skill",
]);

export class Agent {
  private readonly tools: ToolDefinition[];
  private basePrompt: string;

  constructor(private readonly opts: AgentOptions) {
    this.tools = createToolRegistry(opts.workspaceRoot);
    this.basePrompt = loadSystemPromptBase(opts.systemPromptPath);
  }

  /** Reload SYSTEM.md from disk (e.g. after edits without restart). */
  reloadSystemPrompt(): void {
    this.basePrompt = loadSystemPromptBase(this.opts.systemPromptPath);
  }

  systemPrompt(actor: Actor): string {
    // Re-read on each turn so edits to SYSTEM.md apply without restart
    this.reloadSystemPrompt();
    return buildSystemPrompt({
      base: this.basePrompt,
      actor,
      skills: this.opts.skills,
      tools: this.tools,
    });
  }

  async chat(
    channel: SessionChannel,
    actor: Actor,
    userTextOrInput: string | ChatInput,
  ): Promise<ChatResult> {
    const apiKey = this.opts.getApiKey();
    if (!apiKey) {
      return {
        text: "OpenRouter API key is not configured. Add it in the WebUI Settings.",
        listenAgain: false,
      };
    }

    const input: ChatInput =
      typeof userTextOrInput === "string"
        ? { text: userTextOrInput }
        : userTextOrInput;
    const images = (input.images ?? []).slice(0, 4);
    const text = input.text.trim();
    if (!text && images.length === 0) {
      return { text: "Send a message or an image.", listenAgain: false };
    }

    const historyText = historyNoteForImages(text, images);
    this.opts.db.appendMessage(channel, "user", historyText);
    const history = this.opts.db.getMessages(channel, 30);

    // History as text; current turn may include vision parts (last user msg rebuilt)
    const messages: OpenRouterMessage[] = [
      { role: "system", content: this.systemPrompt(actor) },
      ...history.slice(0, -1).map((m) => ({ role: m.role, content: m.content })),
      {
        role: "user",
        content: buildMultimodalUserContent(text || historyText, images),
      },
    ];

    let listenAgain = false;
    const ctx = {
      actor,
      memory: this.opts.memory,
      skills: this.opts.skills,
      workspaceRoot: this.opts.workspaceRoot,
      db: this.opts.db,
      requestFollowupListen: () => {
        listenAgain = true;
      },
    };

    let finalText = "";
    for (let step = 0; step < 8; step++) {
      const { message: choice } = await this.complete(apiKey, messages, {
        tools: this.tools,
      });
      if (!choice) {
        finalText = "No response from model.";
        break;
      }

      if (choice.tool_calls && choice.tool_calls.length > 0) {
        messages.push({
          role: "assistant",
          content: choice.content ?? null,
          tool_calls: choice.tool_calls,
        });
        for (const call of choice.tool_calls) {
          const result = await runTool(this.tools, ctx, call.function.name, call.function.arguments);
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: result,
          });
        }
        continue;
      }

      const raw = choice.content;
      finalText =
        (typeof raw === "string" ? raw : "")?.trim() || "(empty reply)";
      break;
    }

    this.opts.db.appendMessage(channel, "assistant", finalText);
    this.opts.memory.heartbeatNote(
      `[${channel}] user spoke${images.length ? ` (+${images.length} image(s))` : ""}; assistant replied (${finalText.length} chars)${listenAgain ? "; listen_again" : ""}`,
    );

    // Voice: speakable text only. Follow-up listen is armed solely by request_voice_followup.
    if (actor.kind === "voice") {
      finalText = stripMarkdownForSpeech(finalText);
    }

    return { text: finalText, listenAgain };
  }

  /**
   * Run a scheduled cron job through the LLM (no chat history; dedicated channel).
   * Simple jobs use a short prompt, limited tools, and a completion token cap.
   */
  async runScheduledJob(job: CronJob): Promise<ScheduledJobResult> {
    const apiKey = this.opts.getApiKey();
    if (!apiKey) {
      return {
        text: "OpenRouter API key is not configured; scheduled job could not run.",
        totalTokens: null,
        exceededSimpleBudget: false,
      };
    }

    const actor: Actor = {
      kind: job.createdByKind,
      id: job.createdById,
      allowSensitive:
        job.createdByKind === "web" ||
        job.createdByKind === "voice" ||
        this.opts.db.isDiscordAuthorized(job.createdById),
    };

    const tools =
      job.complexity === "simple"
        ? this.tools.filter((t) => SIMPLE_CRON_TOOLS.has(t.name))
        : this.tools;

    const channel = `cron:${job.id}` as SessionChannel;
    const system =
      job.complexity === "simple"
        ? [
            "You are CottAssistant running a SHORT scheduled reminder/check.",
            "Keep the reply brief (one or two sentences). Prefer speaking/DM-ready text.",
            "Use tools only if essential. Stay well under a tiny token budget.",
            job.deliverVoice && !job.deliverDiscord
              ? "Output plain speech only — no Markdown."
              : "",
          ]
            .filter(Boolean)
            .join("\n")
        : [
            this.systemPrompt(actor),
            "",
            "## Scheduled job mode",
            "This turn was triggered by a cron/reminder — not a live user message.",
            "Complete the job prompt below, then produce the message to deliver.",
            job.deliverVoice && !job.deliverDiscord
              ? "If delivering only via voice, use plain speakable prose (no Markdown)."
              : "",
          ]
            .filter(Boolean)
            .join("\n");

    const userContent = [
      `Scheduled job #${job.id}: ${job.title}`,
      `Complexity: ${job.complexity}`,
      `Deliver: ${[
        job.deliverDiscord ? "discord_dm" : null,
        job.deliverVoice ? "voice" : null,
      ]
        .filter(Boolean)
        .join(" + ")}`,
      "",
      "Job prompt:",
      job.prompt,
    ].join("\n");

    this.opts.db.appendMessage(channel, "user", userContent);

    const messages: OpenRouterMessage[] = [
      { role: "system", content: system },
      { role: "user", content: userContent },
    ];

    const ctx = {
      actor,
      memory: this.opts.memory,
      skills: this.opts.skills,
      workspaceRoot: this.opts.workspaceRoot,
      db: this.opts.db,
    };

    let finalText = "";
    let totalTokens = 0;
    let sawUsage = false;
    const maxSteps = job.complexity === "simple" ? 3 : 8;

    for (let step = 0; step < maxSteps; step++) {
      const { message: choice, usage } = await this.complete(apiKey, messages, {
        tools,
        maxTokens: job.complexity === "simple" ? 180 : undefined,
      });
      if (usage) {
        sawUsage = true;
        totalTokens +=
          usage.total_tokens ??
          (usage.prompt_tokens ?? 0) + (usage.completion_tokens ?? 0);
      }
      if (!choice) {
        finalText = "No response from model for scheduled job.";
        break;
      }

      if (choice.tool_calls && choice.tool_calls.length > 0) {
        messages.push({
          role: "assistant",
          content: choice.content ?? null,
          tool_calls: choice.tool_calls,
        });
        for (const call of choice.tool_calls) {
          const result = await runTool(tools, ctx, call.function.name, call.function.arguments);
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: result,
          });
        }
        continue;
      }

      const raw = choice.content;
      finalText =
        (typeof raw === "string" ? raw : "")?.trim() || "(empty scheduled reply)";
      break;
    }

    if (job.deliverVoice && !job.deliverDiscord) {
      finalText = stripMarkdownForSpeech(finalText);
    }

    this.opts.db.appendMessage(channel, "assistant", finalText);
    const tokens = sawUsage ? totalTokens : null;
    const exceededSimpleBudget =
      job.complexity === "simple" && tokens != null && tokens > CRON_SIMPLE_TOKEN_BUDGET;

    this.opts.memory.heartbeatNote(
      `[cron:${job.id}] ran "${job.title}" tokens=${tokens ?? "?"} exceededSimple=${exceededSimpleBudget}`,
    );

    return { text: finalText, totalTokens: tokens, exceededSimpleBudget };
  }

  private async complete(
    apiKey: string,
    messages: OpenRouterMessage[],
    opts: { tools: ToolDefinition[]; maxTokens?: number },
  ): Promise<{ message: OpenRouterMessage | undefined; usage: OpenRouterUsage | null }> {
    const body: Record<string, unknown> = {
      model: this.opts.getModel(),
      messages,
      tools: toolsAsOpenAI(opts.tools),
      tool_choice: "auto",
    };
    if (opts.maxTokens != null) {
      body.max_tokens = opts.maxTokens;
    }

    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "http://127.0.0.1:8787",
        "X-Title": "CottAssistant",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`OpenRouter error ${res.status}: ${errBody}`);
    }

    const data = (await res.json()) as {
      choices?: Array<{ message: OpenRouterMessage }>;
      usage?: OpenRouterUsage;
    };
    return {
      message: data.choices?.[0]?.message,
      usage: data.usage ?? null,
    };
  }

  listTools(): Array<{ name: string; description: string; sensitivity: string }> {
    return this.tools.map((t) => ({
      name: t.name,
      description: t.description,
      sensitivity: t.sensitivity,
    }));
  }
}

export type { ChatMessage };
