import { Database as BunDatabase } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type {
  PublicUser,
  Settings,
  DiscordUser,
  VoicePointConfig,
  AudioDevice,
  CronJob,
  CronComplexity,
  CronStatus,
  ActorKind,
} from "@cottassistant/shared";
import {
  DEFAULT_PIPER_MODEL,
  DEFAULT_WAKE_WORD_MODEL,
  DEFAULT_WHISPER_MODEL,
} from "./model-catalog";

const DEFAULT_SETTINGS: Settings = {
  openrouterModel: "openai/gpt-4.1-mini",
  whisperBinary: "whisper-cli",
  whisperModel: DEFAULT_WHISPER_MODEL,
  piperBinary: "piper-tts",
  piperModel: DEFAULT_PIPER_MODEL,
  wakeWordModel: DEFAULT_WAKE_WORD_MODEL,
  localInputDeviceId: null,
  localOutputDeviceId: null,
  voiceEnabled: false,
};

export class Database {
  readonly db: BunDatabase;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new BunDatabase(path, { create: true });
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('admin', 'user')),
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS authorized_discord_users (
        discord_id TEXT PRIMARY KEY,
        label TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS voice_points (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        input_device_id TEXT,
        output_device_id TEXT,
        last_seen_at INTEGER,
        devices_json TEXT
      );

      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        channel TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel, id);
      CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

      CREATE TABLE IF NOT EXISTS cron_jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        prompt TEXT NOT NULL,
        complexity TEXT NOT NULL CHECK(complexity IN ('simple', 'complex')),
        deliver_discord INTEGER NOT NULL DEFAULT 0,
        deliver_voice INTEGER NOT NULL DEFAULT 0,
        discord_user_id TEXT,
        voice_point_id TEXT,
        next_run_at INTEGER NOT NULL,
        interval_ms INTEGER,
        created_by_kind TEXT NOT NULL CHECK(created_by_kind IN ('web', 'discord', 'voice')),
        created_by_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('active', 'paused', 'completed', 'cancelled')),
        last_run_at INTEGER,
        last_tokens INTEGER,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_cron_due ON cron_jobs(status, next_run_at);
      CREATE INDEX IF NOT EXISTS idx_cron_creator ON cron_jobs(created_by_kind, created_by_id, status);
    `);
    try {
      this.db.exec("ALTER TABLE voice_points ADD COLUMN devices_json TEXT");
    } catch {
      /* column exists */
    }
  }

  private mapCronRow(row: {
    id: number;
    title: string;
    prompt: string;
    complexity: CronComplexity;
    deliver_discord: number;
    deliver_voice: number;
    discord_user_id: string | null;
    voice_point_id: string | null;
    next_run_at: number;
    interval_ms: number | null;
    created_by_kind: ActorKind;
    created_by_id: string;
    status: CronStatus;
    last_run_at: number | null;
    last_tokens: number | null;
    created_at: number;
  }): CronJob {
    return {
      id: row.id,
      title: row.title,
      prompt: row.prompt,
      complexity: row.complexity,
      deliverDiscord: Boolean(row.deliver_discord),
      deliverVoice: Boolean(row.deliver_voice),
      discordUserId: row.discord_user_id,
      voicePointId: row.voice_point_id,
      nextRunAt: row.next_run_at,
      intervalMs: row.interval_ms,
      createdByKind: row.created_by_kind,
      createdById: row.created_by_id,
      status: row.status,
      lastRunAt: row.last_run_at,
      lastTokens: row.last_tokens,
      createdAt: row.created_at,
    };
  }

  userCount(): number {
    const row = this.db.query("SELECT COUNT(*) AS c FROM users").get() as { c: number };
    return row.c;
  }

  createUser(username: string, passwordHash: string, role: "admin" | "user"): PublicUser {
    const createdAt = Date.now();
    const result = this.db
      .query(
        "INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?, ?, ?) RETURNING id, username, role",
      )
      .get(username, passwordHash, role, createdAt) as PublicUser;
    return result;
  }

  listUsers(): PublicUser[] {
    return this.db
      .query("SELECT id, username, role FROM users ORDER BY username COLLATE NOCASE")
      .all() as PublicUser[];
  }

  getUserByUsername(username: string): (PublicUser & { password_hash: string }) | null {
    return this.db
      .query("SELECT id, username, role, password_hash FROM users WHERE username = ?")
      .get(username) as (PublicUser & { password_hash: string }) | null;
  }

  getUserById(id: number): PublicUser | null {
    return this.db.query("SELECT id, username, role FROM users WHERE id = ?").get(id) as PublicUser | null;
  }

  getUserAuthById(id: number): (PublicUser & { password_hash: string }) | null {
    return this.db
      .query("SELECT id, username, role, password_hash FROM users WHERE id = ?")
      .get(id) as (PublicUser & { password_hash: string }) | null;
  }

  updatePassword(id: number, passwordHash: string): void {
    this.db.query("UPDATE users SET password_hash = ? WHERE id = ?").run(passwordHash, id);
  }

  updateUserRole(id: number, role: "admin" | "user"): PublicUser | null {
    this.db.query("UPDATE users SET role = ? WHERE id = ?").run(role, id);
    return this.getUserById(id);
  }

  adminCount(): number {
    const row = this.db
      .query("SELECT COUNT(*) AS c FROM users WHERE role = 'admin'")
      .get() as { c: number };
    return row.c;
  }

  createSession(id: string, userId: number, expiresAt: number): void {
    this.db
      .query("INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
      .run(id, userId, expiresAt, Date.now());
  }

  getSession(id: string): { user_id: number; expires_at: number } | null {
    return this.db
      .query("SELECT user_id, expires_at FROM sessions WHERE id = ?")
      .get(id) as { user_id: number; expires_at: number } | null;
  }

  deleteSession(id: string): void {
    this.db.query("DELETE FROM sessions WHERE id = ?").run(id);
  }

  deleteSessionsForUser(userId: number, exceptSessionId?: string): void {
    if (exceptSessionId) {
      this.db
        .query("DELETE FROM sessions WHERE user_id = ? AND id != ?")
        .run(userId, exceptSessionId);
      return;
    }
    this.db.query("DELETE FROM sessions WHERE user_id = ?").run(userId);
  }

  listDiscordUsers(): DiscordUser[] {
    return this.db
      .query("SELECT discord_id AS discordId, label, created_at AS createdAt FROM authorized_discord_users ORDER BY created_at")
      .all() as DiscordUser[];
  }

  addDiscordUser(discordId: string, label?: string): void {
    this.db
      .query(
        "INSERT OR REPLACE INTO authorized_discord_users (discord_id, label, created_at) VALUES (?, ?, ?)",
      )
      .run(discordId, label ?? null, Date.now());
  }

  removeDiscordUser(discordId: string): void {
    this.db.query("DELETE FROM authorized_discord_users WHERE discord_id = ?").run(discordId);
  }

  isDiscordAuthorized(discordId: string): boolean {
    const row = this.db
      .query("SELECT 1 AS ok FROM authorized_discord_users WHERE discord_id = ?")
      .get(discordId) as { ok: number } | null;
    return Boolean(row);
  }

  getSettings(): Settings {
    const rows = this.db.query("SELECT key, value FROM settings").all() as Array<{ key: string; value: string }>;
    const raw: Record<string, unknown> = { ...DEFAULT_SETTINGS };
    for (const row of rows) {
      try {
        raw[row.key] = JSON.parse(row.value) as unknown;
      } catch {
        raw[row.key] = row.value;
      }
    }
    const settings = { ...DEFAULT_SETTINGS, ...raw } as Settings;
    // Normalize legacy whisper ids like "ggml-base.en" / "ggml-base.en.bin"
    if (typeof settings.whisperModel === "string") {
      let w = settings.whisperModel;
      if (w.endsWith(".bin")) w = w.slice(0, -4);
      if (w.startsWith("ggml-")) w = w.slice(5);
      settings.whisperModel = w;
    }
    return settings;
  }

  setSetting<K extends keyof Settings>(key: K, value: Settings[K]): void {
    this.db
      .query("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(key, JSON.stringify(value));
  }

  updateSettings(partial: Partial<Settings>): Settings {
    for (const [key, value] of Object.entries(partial)) {
      if (value !== undefined) {
        this.setSetting(key as keyof Settings, value as Settings[keyof Settings]);
      }
    }
    return this.getSettings();
  }

  listVoicePoints(): Array<VoicePointConfig & { devices?: AudioDevice[] }> {
    const rows = this.db
      .query(
        `SELECT id, name, input_device_id AS inputDeviceId, output_device_id AS outputDeviceId,
                last_seen_at AS lastSeenAt, devices_json AS devicesJson
         FROM voice_points ORDER BY name`,
      )
      .all() as Array<{
      id: string;
      name: string;
      inputDeviceId: string | null;
      outputDeviceId: string | null;
      lastSeenAt: number | null;
      devicesJson: string | null;
    }>;
    return rows.map((p) => {
      let devices: AudioDevice[] | undefined;
      if (p.devicesJson) {
        try {
          devices = JSON.parse(p.devicesJson) as AudioDevice[];
        } catch {
          devices = undefined;
        }
      }
      return {
        id: p.id,
        name: p.name,
        inputDeviceId: p.inputDeviceId,
        outputDeviceId: p.outputDeviceId,
        lastSeenAt: p.lastSeenAt,
        connected: false,
        devices,
      };
    });
  }

  upsertVoicePoint(id: string, name: string, devices?: AudioDevice[]): void {
    const devicesJson = devices ? JSON.stringify(devices) : null;
    this.db
      .query(
        `INSERT INTO voice_points (id, name, last_seen_at, devices_json) VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           last_seen_at = excluded.last_seen_at,
           devices_json = COALESCE(excluded.devices_json, voice_points.devices_json)`,
      )
      .run(id, name, Date.now(), devicesJson);
  }

  updateVoicePointDevices(id: string, inputDeviceId: string | null, outputDeviceId: string | null): void {
    this.db
      .query("UPDATE voice_points SET input_device_id = ?, output_device_id = ? WHERE id = ?")
      .run(inputDeviceId, outputDeviceId, id);
  }

  touchVoicePoint(id: string): void {
    this.db.query("UPDATE voice_points SET last_seen_at = ? WHERE id = ?").run(Date.now(), id);
  }

  appendMessage(channel: string, role: string, content: string): void {
    this.db
      .query("INSERT INTO messages (channel, role, content, created_at) VALUES (?, ?, ?, ?)")
      .run(channel, role, content, Date.now());
  }

  getMessages(channel: string, limit = 40): Array<{ role: string; content: string }> {
    const rows = this.db
      .query(
        `SELECT role, content FROM (
           SELECT id, role, content FROM messages WHERE channel = ? ORDER BY id DESC LIMIT ?
         ) ORDER BY id ASC`,
      )
      .all(channel, limit) as Array<{ role: string; content: string }>;
    return rows;
  }

  clearMessages(channel: string): void {
    this.db.query("DELETE FROM messages WHERE channel = ?").run(channel);
  }

  createCronJob(input: {
    title: string;
    prompt: string;
    complexity: CronComplexity;
    deliverDiscord: boolean;
    deliverVoice: boolean;
    discordUserId: string | null;
    voicePointId: string | null;
    nextRunAt: number;
    intervalMs: number | null;
    createdByKind: ActorKind;
    createdById: string;
  }): CronJob {
    const createdAt = Date.now();
    const row = this.db
      .query(
        `INSERT INTO cron_jobs (
           title, prompt, complexity, deliver_discord, deliver_voice,
           discord_user_id, voice_point_id, next_run_at, interval_ms,
           created_by_kind, created_by_id, status, last_run_at, last_tokens, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', NULL, NULL, ?)
         RETURNING *`,
      )
      .get(
        input.title,
        input.prompt,
        input.complexity,
        input.deliverDiscord ? 1 : 0,
        input.deliverVoice ? 1 : 0,
        input.discordUserId,
        input.voicePointId,
        input.nextRunAt,
        input.intervalMs,
        input.createdByKind,
        input.createdById,
        createdAt,
      ) as Parameters<Database["mapCronRow"]>[0];
    return this.mapCronRow(row);
  }

  getCronJob(id: number): CronJob | null {
    const row = this.db.query("SELECT * FROM cron_jobs WHERE id = ?").get(id) as
      | Parameters<Database["mapCronRow"]>[0]
      | null;
    return row ? this.mapCronRow(row) : null;
  }

  listCronJobs(opts?: {
    createdByKind?: ActorKind;
    createdById?: string;
    status?: CronStatus | CronStatus[];
  }): CronJob[] {
    const clauses: string[] = [];
    const params: Array<string | number> = [];
    if (opts?.createdByKind) {
      clauses.push("created_by_kind = ?");
      params.push(opts.createdByKind);
    }
    if (opts?.createdById) {
      clauses.push("created_by_id = ?");
      params.push(opts.createdById);
    }
    if (opts?.status) {
      const statuses = Array.isArray(opts.status) ? opts.status : [opts.status];
      clauses.push(`status IN (${statuses.map(() => "?").join(", ")})`);
      params.push(...statuses);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.db
      .query(`SELECT * FROM cron_jobs ${where} ORDER BY next_run_at ASC, id ASC`)
      .all(...params) as Array<Parameters<Database["mapCronRow"]>[0]>;
    return rows.map((r) => this.mapCronRow(r));
  }

  countActiveSimpleCrons(createdByKind: ActorKind, createdById: string): number {
    const row = this.db
      .query(
        `SELECT COUNT(*) AS c FROM cron_jobs
         WHERE created_by_kind = ? AND created_by_id = ?
           AND status = 'active' AND complexity = 'simple'`,
      )
      .get(createdByKind, createdById) as { c: number };
    return row.c;
  }

  listDueCronJobs(now: number, limit = 20): CronJob[] {
    const rows = this.db
      .query(
        `SELECT * FROM cron_jobs
         WHERE status = 'active' AND next_run_at <= ?
         ORDER BY next_run_at ASC
         LIMIT ?`,
      )
      .all(now, limit) as Array<Parameters<Database["mapCronRow"]>[0]>;
    return rows.map((r) => this.mapCronRow(r));
  }

  claimDueCronJob(id: number, now: number): CronJob | null {
    // Push next_run far ahead briefly so concurrent pollers don't double-fire.
    const claimUntil = now + 60_000;
    const result = this.db
      .query(
        `UPDATE cron_jobs SET next_run_at = ?
         WHERE id = ? AND status = 'active' AND next_run_at <= ?
         RETURNING *`,
      )
      .get(claimUntil, id, now) as Parameters<Database["mapCronRow"]>[0] | null;
    return result ? this.mapCronRow(result) : null;
  }

  completeCronRun(opts: {
    id: number;
    tokens: number | null;
    nextRunAt: number | null;
    status: CronStatus;
  }): CronJob | null {
    this.db
      .query(
        `UPDATE cron_jobs
         SET last_run_at = ?, last_tokens = ?, next_run_at = COALESCE(?, next_run_at), status = ?
         WHERE id = ?`,
      )
      .run(Date.now(), opts.tokens, opts.nextRunAt, opts.status, opts.id);
    return this.getCronJob(opts.id);
  }

  setCronStatus(id: number, status: CronStatus): CronJob | null {
    this.db.query("UPDATE cron_jobs SET status = ? WHERE id = ?").run(status, id);
    return this.getCronJob(id);
  }

  cancelCronJob(id: number, createdByKind?: ActorKind, createdById?: string): CronJob | null {
    if (createdByKind && createdById) {
      this.db
        .query(
          `UPDATE cron_jobs SET status = 'cancelled'
           WHERE id = ? AND created_by_kind = ? AND created_by_id = ? AND status = 'active'`,
        )
        .run(id, createdByKind, createdById);
    } else {
      this.db
        .query(`UPDATE cron_jobs SET status = 'cancelled' WHERE id = ? AND status IN ('active', 'paused')`)
        .run(id);
    }
    return this.getCronJob(id);
  }
}

export type Db = Database;
