import type { Agent, Database } from "@cottassistant/core";
import type { CronJob } from "@cottassistant/shared";
import { CRON_SIMPLE_TOKEN_BUDGET } from "@cottassistant/shared";

export interface CronSchedulerDeps {
  db: Database;
  agent: Agent;
  /** Send a Discord DM; return false if Discord is offline / failed. */
  sendDiscordDm: (discordUserId: string, text: string) => Promise<boolean>;
  /** Speak on a voice point (`local` or satellite id). */
  speakVoice: (pointId: string, text: string) => Promise<void>;
  pollIntervalMs?: number;
}

export class CronScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private readonly pollIntervalMs: number;

  constructor(private readonly deps: CronSchedulerDeps) {
    this.pollIntervalMs = deps.pollIntervalMs ?? 10_000;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, this.pollIntervalMs);
    // Catch anything due at boot
    void this.tick();
    console.log(`Cron scheduler started (poll ${this.pollIntervalMs}ms)`);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const due = this.deps.db.listDueCronJobs(Date.now(), 10);
      for (const job of due) {
        await this.fire(job);
      }
    } catch (err) {
      console.error("Cron tick error:", err);
    } finally {
      this.running = false;
    }
  }

  private async fire(job: CronJob): Promise<void> {
    const now = Date.now();
    const claimed = this.deps.db.claimDueCronJob(job.id, now);
    if (!claimed) return;

    console.log(`[cron] firing #${job.id} "${job.title}"`);
    let text: string;
    let tokens: number | null = null;
    let exceededSimple = false;

    try {
      const result = await this.deps.agent.runScheduledJob(claimed);
      text = result.text;
      tokens = result.totalTokens;
      exceededSimple = result.exceededSimpleBudget;
    } catch (err) {
      text = `Scheduled job "${job.title}" failed: ${err instanceof Error ? err.message : String(err)}`;
      console.error(`[cron] #${job.id} error:`, err);
    }

    if (exceededSimple && tokens != null) {
      console.warn(
        `[cron] #${job.id} simple job used ${tokens} tokens (budget ${CRON_SIMPLE_TOKEN_BUDGET})`,
      );
    }

    if (claimed.deliverDiscord && claimed.discordUserId) {
      const ok = await this.deps.sendDiscordDm(claimed.discordUserId, text);
      if (!ok) {
        console.warn(`[cron] #${job.id} Discord DM failed for ${claimed.discordUserId}`);
      }
    }

    if (claimed.deliverVoice) {
      const point = claimed.voicePointId ?? "local";
      try {
        await this.deps.speakVoice(point, text);
      } catch (err) {
        console.error(`[cron] #${job.id} voice delivery failed:`, err);
      }
    }

    if (claimed.intervalMs != null && claimed.intervalMs > 0) {
      const nextRunAt = Date.now() + claimed.intervalMs;
      this.deps.db.completeCronRun({
        id: claimed.id,
        tokens,
        nextRunAt,
        status: "active",
      });
    } else {
      this.deps.db.completeCronRun({
        id: claimed.id,
        tokens,
        nextRunAt: Date.now(),
        status: "completed",
      });
    }
  }
}
