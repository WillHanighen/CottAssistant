import type { Actor, CronComplexity, CronDeliver, CronJob } from "@cottassistant/shared";
import { CRON_SIMPLE_TOKEN_BUDGET, CRON_UNTRUSTED_MAX_SIMPLE } from "@cottassistant/shared";

export { CRON_SIMPLE_TOKEN_BUDGET, CRON_UNTRUSTED_MAX_SIMPLE };

/** WebUI, voice, and allowlisted Discord users are trusted for unlimited / complex crons. */
export function isTrustedCronCreator(actor: Actor): boolean {
  return actor.kind === "web" || actor.kind === "voice" || actor.allowSensitive;
}

export function deliverFlags(deliver: CronDeliver): {
  deliverDiscord: boolean;
  deliverVoice: boolean;
} {
  return {
    deliverDiscord: deliver === "discord_dm" || deliver === "both",
    deliverVoice: deliver === "voice" || deliver === "both",
  };
}

export function resolveCronTargets(opts: {
  actor: Actor;
  deliver: CronDeliver;
  discordUserId?: string | null;
  voicePointId?: string | null;
}): { discordUserId: string | null; voicePointId: string | null; error?: string } {
  const flags = deliverFlags(opts.deliver);
  let discordUserId: string | null = opts.discordUserId?.trim() || null;
  let voicePointId: string | null = opts.voicePointId?.trim() || null;

  if (flags.deliverDiscord) {
    if (!discordUserId && opts.actor.kind === "discord") {
      discordUserId = opts.actor.id;
    }
    if (!discordUserId) {
      return {
        discordUserId: null,
        voicePointId: null,
        error:
          "discord_user_id is required when delivering via Discord DM (unless the requester is already a Discord user).",
      };
    }
    if (!/^\d{5,30}$/.test(discordUserId)) {
      return {
        discordUserId: null,
        voicePointId: null,
        error: "discord_user_id must be a Discord snowflake ID.",
      };
    }
  } else {
    discordUserId = null;
  }

  if (flags.deliverVoice) {
    if (!voicePointId && opts.actor.kind === "voice") {
      voicePointId = opts.actor.id;
    }
    if (!voicePointId) {
      voicePointId = "local";
    }
  } else {
    voicePointId = null;
  }

  return { discordUserId, voicePointId };
}

export function computeSchedule(opts: {
  runInSeconds?: number;
  everySeconds?: number;
  now?: number;
}): { nextRunAt: number; intervalMs: number | null; error?: string } {
  const now = opts.now ?? Date.now();
  const runIn = opts.runInSeconds;
  const every = opts.everySeconds;

  if (runIn === undefined && every === undefined) {
    return {
      nextRunAt: 0,
      intervalMs: null,
      error: "Provide run_in_seconds and/or every_seconds.",
    };
  }
  if (runIn !== undefined && (!Number.isFinite(runIn) || runIn < 5)) {
    return {
      nextRunAt: 0,
      intervalMs: null,
      error: "run_in_seconds must be at least 5.",
    };
  }
  if (every !== undefined && (!Number.isFinite(every) || every < 60)) {
    return {
      nextRunAt: 0,
      intervalMs: null,
      error: "every_seconds must be at least 60 (1 minute).",
    };
  }

  const delaySec = runIn ?? every!;
  const intervalMs = every !== undefined ? Math.round(every * 1000) : null;
  return {
    nextRunAt: now + Math.round(delaySec * 1000),
    intervalMs,
  };
}

export function formatCronJob(job: CronJob): string {
  const when = new Date(job.nextRunAt).toISOString();
  const recur =
    job.intervalMs != null
      ? ` every ${Math.round(job.intervalMs / 1000)}s`
      : " (one-shot)";
  const deliver: string[] = [];
  if (job.deliverDiscord) deliver.push(`DM ${job.discordUserId}`);
  if (job.deliverVoice) deliver.push(`voice:${job.voicePointId ?? "local"}`);
  return [
    `#${job.id} [${job.status}] ${job.title}`,
    `  complexity=${job.complexity} next=${when}${recur}`,
    `  deliver=${deliver.join(" + ") || "none"}`,
    `  prompt=${job.prompt.slice(0, 160)}${job.prompt.length > 160 ? "…" : ""}`,
  ].join("\n");
}

export function cronCreateLimitError(
  actor: Actor,
  complexity: CronComplexity,
  activeSimpleCount: number,
): string | null {
  if (isTrustedCronCreator(actor)) return null;
  if (complexity === "complex") {
    return (
      "Unauthorized Discord users can only create simple crons (≤" +
      `${CRON_SIMPLE_TOKEN_BUDGET} tokens per run). ` +
      "Log into the WebUI, use voice, or get added to the Discord allowlist for complex jobs."
    );
  }
  if (activeSimpleCount >= CRON_UNTRUSTED_MAX_SIMPLE) {
    return (
      `Unauthorized Discord users may only have ${CRON_UNTRUSTED_MAX_SIMPLE} active simple crons. ` +
      "Cancel one first, or get authorized (WebUI / voice / Discord allowlist)."
    );
  }
  return null;
}
