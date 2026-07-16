import { test, expect } from "bun:test";
import {
  computeSchedule,
  cronCreateLimitError,
  deliverFlags,
  isTrustedCronCreator,
  resolveCronTargets,
} from "./cron";
import { CRON_UNTRUSTED_MAX_SIMPLE } from "@cottassistant/shared";
import { Database } from "./db";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { rmSync } from "node:fs";

test("isTrustedCronCreator: web, voice, and allowlisted discord", () => {
  expect(isTrustedCronCreator({ kind: "web", id: "1", allowSensitive: true })).toBe(true);
  expect(isTrustedCronCreator({ kind: "voice", id: "local", allowSensitive: true })).toBe(true);
  expect(isTrustedCronCreator({ kind: "discord", id: "99", allowSensitive: true })).toBe(true);
  expect(isTrustedCronCreator({ kind: "discord", id: "99", allowSensitive: false })).toBe(false);
});

test("cronCreateLimitError enforces 3 simple for untrusted discord", () => {
  const actor = { kind: "discord" as const, id: "1", allowSensitive: false };
  expect(cronCreateLimitError(actor, "complex", 0)).toContain("simple");
  expect(cronCreateLimitError(actor, "simple", CRON_UNTRUSTED_MAX_SIMPLE - 1)).toBeNull();
  expect(cronCreateLimitError(actor, "simple", CRON_UNTRUSTED_MAX_SIMPLE)).toContain(
    String(CRON_UNTRUSTED_MAX_SIMPLE),
  );
  expect(
    cronCreateLimitError({ kind: "web", id: "1", allowSensitive: true }, "complex", 100),
  ).toBeNull();
});

test("computeSchedule one-shot and recurring", () => {
  const now = 1_000_000;
  const once = computeSchedule({ runInSeconds: 600, now });
  expect(once.error).toBeUndefined();
  expect(once.nextRunAt).toBe(now + 600_000);
  expect(once.intervalMs).toBeNull();

  const recur = computeSchedule({ everySeconds: 3600, now });
  expect(recur.intervalMs).toBe(3_600_000);
  expect(recur.nextRunAt).toBe(now + 3_600_000);

  const both = computeSchedule({ runInSeconds: 120, everySeconds: 7200, now });
  expect(both.nextRunAt).toBe(now + 120_000);
  expect(both.intervalMs).toBe(7_200_000);

  expect(computeSchedule({ now }).error).toBeTruthy();
  expect(computeSchedule({ runInSeconds: 2, now }).error).toBeTruthy();
});

test("resolveCronTargets defaults discord and voice ids", () => {
  const flags = deliverFlags("both");
  expect(flags.deliverDiscord).toBe(true);
  expect(flags.deliverVoice).toBe(true);

  const fromDiscord = resolveCronTargets({
    actor: { kind: "discord", id: "123456789012345678", allowSensitive: false },
    deliver: "discord_dm",
  });
  expect(fromDiscord.discordUserId).toBe("123456789012345678");

  const fromVoice = resolveCronTargets({
    actor: { kind: "voice", id: "kitchen", allowSensitive: true },
    deliver: "voice",
  });
  expect(fromVoice.voicePointId).toBe("kitchen");

  const webNeedsId = resolveCronTargets({
    actor: { kind: "web", id: "1", allowSensitive: true },
    deliver: "discord_dm",
  });
  expect(webNeedsId.error).toBeTruthy();

  const webLocal = resolveCronTargets({
    actor: { kind: "web", id: "1", allowSensitive: true },
    deliver: "voice",
  });
  expect(webLocal.voicePointId).toBe("local");
});

test("Database cron CRUD and due claim", () => {
  const path = join(tmpdir(), `cott-cron-${crypto.randomUUID()}.sqlite`);
  const db = new Database(path);
  try {
    const job = db.createCronJob({
      title: "Dogs",
      prompt: "Remind to let the dogs out",
      complexity: "simple",
      deliverDiscord: true,
      deliverVoice: false,
      discordUserId: "123456789012345678",
      voicePointId: null,
      nextRunAt: Date.now() - 1000,
      intervalMs: 3600_000,
      createdByKind: "discord",
      createdById: "123456789012345678",
    });
    expect(job.id).toBeGreaterThan(0);
    expect(db.countActiveSimpleCrons("discord", "123456789012345678")).toBe(1);

    const due = db.listDueCronJobs(Date.now());
    expect(due.some((j) => j.id === job.id)).toBe(true);

    const claimed = db.claimDueCronJob(job.id, Date.now());
    expect(claimed?.id).toBe(job.id);
    // Second claim should fail while next_run is pushed forward
    expect(db.claimDueCronJob(job.id, Date.now())).toBeNull();

    db.completeCronRun({
      id: job.id,
      tokens: 42,
      nextRunAt: Date.now() + 3600_000,
      status: "active",
    });
    const again = db.getCronJob(job.id);
    expect(again?.lastTokens).toBe(42);
    expect(again?.status).toBe("active");

    const cancelled = db.cancelCronJob(job.id);
    expect(cancelled?.status).toBe("cancelled");
  } finally {
    db.db.close();
    rmSync(path, { force: true });
  }
});
