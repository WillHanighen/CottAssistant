import type { ServerWebSocket } from "bun";
import {
  Database,
  Agent,
  MemoryStore,
  SkillLoader,
  loadConfig,
  listAudioDevices,
  hashPassword,
  verifyPassword,
  createSession,
  destroySession,
  getSessionUser,
  parseCookies,
  sessionCookie,
  clearSessionCookie,
  COOKIE_NAME,
  synthesizePiper,
  playWav,
  writePcmToWav,
  transcribeWhisper,
  ensureVoiceModels,
  ensureWhisperModel,
  getModelInstallStatus,
  modelCatalogPayload,
  piperModelPath,
  whisperModelPath,
  cleanupVoiceTempFiles,
  stripMarkdownForSpeech,
  computeSchedule,
  deliverFlags,
  resolveCronTargets,
} from "@cottassistant/core";
import type { Actor, Settings, ServerToDaemon, DaemonToServer } from "@cottassistant/shared";
import { DaemonToServerSchema } from "@cottassistant/shared";
import { mkdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { startDiscordBot, type DiscordHandle } from "./discord";
import { LocalVoiceHub } from "./voice-local";
import { CronScheduler } from "./cron-scheduler";

const config = loadConfig();
mkdirSync(config.dataDir, { recursive: true });
mkdirSync(config.memoryDir, { recursive: true });
mkdirSync(config.skillsDir, { recursive: true });
mkdirSync(config.modelsDir, { recursive: true });

// Sample skill
const sampleSkill = join(config.skillsDir, "about");
if (!existsSync(join(sampleSkill, "SKILL.md"))) {
  mkdirSync(sampleSkill, { recursive: true });
  await Bun.write(
    join(sampleSkill, "SKILL.md"),
    `# About CottAssistant\n\n> Describe how this assistant is set up.\n\nCottAssistant runs locally with Discord, WebUI, and voice.\n`,
  );
}

const db = new Database(config.dbPath);
const memory = new MemoryStore(config.memoryDir);
const skills = new SkillLoader(config.skillsDir);
const workspaceRoot = config.workspaceRoot;

// Seed settings from env if empty
{
  const s = db.getSettings();
  if (!s.openrouterApiKey && config.openrouterApiKey) {
    db.setSetting("openrouterApiKey", config.openrouterApiKey);
  }
  if (!s.discordToken && config.discordToken) {
    db.setSetting("discordToken", config.discordToken);
  }
  if (!s.voiceDaemonToken && config.voiceDaemonToken) {
    db.setSetting("voiceDaemonToken", config.voiceDaemonToken);
  }
  if (!s.voiceDaemonToken) {
    db.setSetting("voiceDaemonToken", crypto.randomUUID());
  }
}

const agent = new Agent({
  db,
  memory,
  skills,
  workspaceRoot,
  systemPromptPath: config.systemPromptPath,
  getApiKey: () => db.getSettings().openrouterApiKey ?? config.openrouterApiKey,
  getModel: () => db.getSettings().openrouterModel,
});

type VoiceSocketData = { pointId: string; authed: boolean };

const voiceSockets = new Map<string, ServerWebSocket<VoiceSocketData>>();

function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function requireUser(req: Request) {
  const cookies = parseCookies(req.headers.get("cookie"));
  return getSessionUser(db, cookies[COOKIE_NAME]);
}

function sessionIdFrom(req: Request): string | undefined {
  return parseCookies(req.headers.get("cookie"))[COOKIE_NAME];
}

function requireAdmin(user: NonNullable<ReturnType<typeof requireUser>>) {
  return user.role === "admin";
}

async function handleApi(req: Request, url: URL): Promise<Response | null> {
  const path = url.pathname;

  if (path === "/api/health") {
    return json({ ok: true, users: db.userCount() });
  }

  if (path === "/api/bootstrap" && req.method === "GET") {
    return json({ needsSetup: db.userCount() === 0 });
  }

  if (path === "/api/setup" && req.method === "POST") {
    if (db.userCount() > 0) return json({ error: "Already set up" }, 400);
    const body = (await req.json()) as { username?: string; password?: string };
    if (!body.username || !body.password || body.password.length < 8) {
      return json({ error: "Username and password (min 8 chars) required" }, 400);
    }
    const hash = await hashPassword(body.password);
    const user = db.createUser(body.username, hash, "admin");
    const sid = createSession(db, user.id);
    return json({ user }, 201, { "Set-Cookie": sessionCookie(sid) });
  }

  if (path === "/api/login" && req.method === "POST") {
    const body = (await req.json()) as { username?: string; password?: string };
    const row = body.username ? db.getUserByUsername(body.username) : null;
    if (!row || !(await verifyPassword(body.password ?? "", row.password_hash))) {
      return json({ error: "Invalid credentials" }, 401);
    }
    const sid = createSession(db, row.id);
    return json(
      { user: { id: row.id, username: row.username, role: row.role } },
      200,
      { "Set-Cookie": sessionCookie(sid) },
    );
  }

  if (path === "/api/logout" && req.method === "POST") {
    const cookies = parseCookies(req.headers.get("cookie"));
    const sid = cookies[COOKIE_NAME];
    if (sid) destroySession(db, sid);
    return json({ ok: true }, 200, { "Set-Cookie": clearSessionCookie() });
  }

  if (path === "/api/me" && req.method === "GET") {
    const user = requireUser(req);
    if (!user) return json({ user: null });
    return json({ user });
  }

  // Authenticated routes
  const user = requireUser(req);
  const needsAuth =
    path.startsWith("/api/") &&
    !["/api/health", "/api/bootstrap", "/api/setup", "/api/login", "/api/me"].includes(path);

  if (needsAuth && !user) {
    return json({ error: "Unauthorized" }, 401);
  }

  if (path === "/api/me/password" && req.method === "POST" && user) {
    const body = (await req.json()) as { currentPassword?: string; newPassword?: string };
    if (!body.currentPassword || !body.newPassword || body.newPassword.length < 8) {
      return json({ error: "Current password and new password (min 8 chars) required" }, 400);
    }
    const row = db.getUserAuthById(user.id);
    if (!row || !(await verifyPassword(body.currentPassword, row.password_hash))) {
      return json({ error: "Current password is incorrect" }, 401);
    }
    const hash = await hashPassword(body.newPassword);
    db.updatePassword(user.id, hash);
    const sid = sessionIdFrom(req);
    db.deleteSessionsForUser(user.id, sid);
    return json({ ok: true });
  }

  if (path === "/api/users" && req.method === "GET" && user) {
    if (!requireAdmin(user)) return json({ error: "Admin required" }, 403);
    return json({ users: db.listUsers() });
  }

  if (path === "/api/users" && req.method === "POST" && user) {
    if (!requireAdmin(user)) return json({ error: "Admin required" }, 403);
    const body = (await req.json()) as {
      username?: string;
      password?: string;
      role?: "admin" | "user";
    };
    const username = body.username?.trim() ?? "";
    const role = body.role === "admin" ? "admin" : "user";
    if (!username || !body.password || body.password.length < 8) {
      return json({ error: "Username and password (min 8 chars) required" }, 400);
    }
    if (db.getUserByUsername(username)) {
      return json({ error: "Username already taken" }, 409);
    }
    const hash = await hashPassword(body.password);
    try {
      const created = db.createUser(username, hash, role);
      return json({ user: created, users: db.listUsers() }, 201);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("UNIQUE")) return json({ error: "Username already taken" }, 409);
      return json({ error: msg }, 500);
    }
  }

  if (path.startsWith("/api/users/") && req.method === "PATCH" && user) {
    if (!requireAdmin(user)) return json({ error: "Admin required" }, 403);
    const idStr = decodeURIComponent(path.slice("/api/users/".length));
    const targetId = Number(idStr);
    if (!Number.isInteger(targetId) || targetId <= 0) {
      return json({ error: "Invalid user id" }, 400);
    }
    const target = db.getUserById(targetId);
    if (!target) return json({ error: "User not found" }, 404);

    const body = (await req.json()) as {
      role?: "admin" | "user";
      password?: string;
    };

    if (body.role !== undefined && body.role !== "admin" && body.role !== "user") {
      return json({ error: "Role must be admin or user" }, 400);
    }

    if (body.role !== undefined && body.role !== target.role) {
      if (target.role === "admin" && body.role === "user" && db.adminCount() <= 1) {
        return json({ error: "Cannot demote the last admin" }, 400);
      }
      db.updateUserRole(targetId, body.role);
    }

    if (typeof body.password === "string") {
      if (body.password.length < 8) {
        return json({ error: "Password must be at least 8 characters" }, 400);
      }
      const hash = await hashPassword(body.password);
      db.updatePassword(targetId, hash);
      const sid = sessionIdFrom(req);
      // Invalidate other sessions for the target; keep admin's own if resetting self
      db.deleteSessionsForUser(targetId, targetId === user.id ? sid : undefined);
    }

    const updated = db.getUserById(targetId);
    return json({ user: updated, users: db.listUsers() });
  }

  if (path === "/api/chat" && req.method === "POST" && user) {
    const body = (await req.json()) as { message?: string };
    if (!body.message?.trim()) return json({ error: "message required" }, 400);
    const actor: Actor = { kind: "web", id: String(user.id), allowSensitive: true };
    const channel = `web:${user.id}` as const;
    try {
      const result = await agent.chat(channel, actor, body.message.trim());
      return json({ reply: result.text });
    } catch (err) {
      return json({ error: err instanceof Error ? err.message : String(err) }, 500);
    }
  }

  if (path === "/api/chat/history" && req.method === "GET" && user) {
    const channel = `web:${user.id}`;
    return json({ messages: db.getMessages(channel, 100) });
  }

  if (path === "/api/settings" && req.method === "GET" && user) {
    const s = db.getSettings();
    return json({
      settings: {
        ...s,
        openrouterApiKey: s.openrouterApiKey ? mask(s.openrouterApiKey) : "",
        discordToken: s.discordToken ? mask(s.discordToken) : "",
        voiceDaemonToken: s.voiceDaemonToken ?? "",
        hasOpenrouterKey: Boolean(s.openrouterApiKey),
        hasDiscordToken: Boolean(s.discordToken),
      },
      catalog: modelCatalogPayload(config.modelsDir),
      modelStatus: getModelInstallStatus(config.modelsDir, {
        wakeWord: s.wakeWordModel,
        whisper: s.whisperModel,
        piper: s.piperModel,
      }),
    });
  }

  if (path === "/api/models/catalog" && req.method === "GET" && user) {
    const s = db.getSettings();
    return json({
      catalog: modelCatalogPayload(config.modelsDir),
      modelStatus: getModelInstallStatus(config.modelsDir, {
        wakeWord: s.wakeWordModel,
        whisper: s.whisperModel,
        piper: s.piperModel,
      }),
    });
  }

  if (path === "/api/models/ensure" && req.method === "POST" && user) {
    const s = db.getSettings();
    const body = (await req.json().catch(() => ({}))) as {
      wakeWord?: string;
      whisper?: string;
      piper?: string;
    };
    const ids = {
      wakeWord: body.wakeWord ?? s.wakeWordModel,
      whisper: body.whisper ?? s.whisperModel,
      piper: body.piper ?? s.piperModel,
    };
    try {
      const result = await ensureVoiceModels(config.modelsDir, ids);
      return json({
        ok: true,
        modelStatus: result.status,
        catalog: modelCatalogPayload(config.modelsDir),
      });
    } catch (err) {
      return json(
        { error: err instanceof Error ? err.message : String(err) },
        500,
      );
    }
  }

  if (path === "/api/settings" && req.method === "PUT" && user) {
    const body = (await req.json()) as Partial<Settings>;
    const current = db.getSettings();
    const next: Partial<Settings> = { ...body };
    // Don't overwrite secrets with masked values
    if (typeof body.openrouterApiKey === "string") {
      if (!body.openrouterApiKey || body.openrouterApiKey.includes("…")) {
        delete next.openrouterApiKey;
      }
    }
    if (typeof body.discordToken === "string") {
      if (!body.discordToken || body.discordToken.includes("…")) {
        delete next.discordToken;
      }
    }
    const settings = db.updateSettings(next);

    let modelStatus = getModelInstallStatus(config.modelsDir, {
      wakeWord: settings.wakeWordModel,
      whisper: settings.whisperModel,
      piper: settings.piperModel,
    });
    let installError: string | undefined;
    const modelsChanged =
      (next.wakeWordModel !== undefined && next.wakeWordModel !== current.wakeWordModel) ||
      (next.whisperModel !== undefined && next.whisperModel !== current.whisperModel) ||
      (next.piperModel !== undefined && next.piperModel !== current.piperModel) ||
      next.voiceEnabled === true ||
      !modelStatus.wakeWord.ready ||
      !modelStatus.whisper.ready ||
      !modelStatus.piper.ready;

    if (modelsChanged) {
      try {
        const result = await ensureVoiceModels(config.modelsDir, {
          wakeWord: settings.wakeWordModel,
          whisper: settings.whisperModel,
          piper: settings.piperModel,
        });
        modelStatus = result.status;
      } catch (err) {
        installError = err instanceof Error ? err.message : String(err);
        console.error("Model install failed:", err);
      }
    }

    // Restart discord if token changed
    if (next.discordToken && next.discordToken !== current.discordToken) {
      await restartDiscord();
    }
    if (
      next.voiceEnabled !== undefined ||
      next.localInputDeviceId !== undefined ||
      next.wakeWordModel !== undefined ||
      next.whisperModel !== undefined ||
      next.piperModel !== undefined
    ) {
      await voiceHub.reload();
    }
    return json({
      settings: {
        ...settings,
        openrouterApiKey: settings.openrouterApiKey ? mask(settings.openrouterApiKey) : "",
        discordToken: settings.discordToken ? mask(settings.discordToken) : "",
        hasOpenrouterKey: Boolean(settings.openrouterApiKey),
        hasDiscordToken: Boolean(settings.discordToken),
      },
      catalog: modelCatalogPayload(config.modelsDir),
      modelStatus,
      installError,
    });
  }

  if (path === "/api/discord/users" && req.method === "GET" && user) {
    return json({ users: db.listDiscordUsers() });
  }

  if (path === "/api/discord/users" && req.method === "POST" && user) {
    const body = (await req.json()) as { discordId?: string; label?: string };
    if (!body.discordId || !/^\d{5,30}$/.test(body.discordId)) {
      return json({ error: "Valid Discord snowflake ID required" }, 400);
    }
    db.addDiscordUser(body.discordId, body.label);
    return json({ users: db.listDiscordUsers() }, 201);
  }

  if (path.startsWith("/api/discord/users/") && req.method === "DELETE" && user) {
    const id = decodeURIComponent(path.slice("/api/discord/users/".length));
    db.removeDiscordUser(id);
    return json({ users: db.listDiscordUsers() });
  }

  if (path === "/api/audio/devices" && req.method === "GET" && user) {
    const devices = await listAudioDevices();
    return json({ devices });
  }

  if (path === "/api/voice/points" && req.method === "GET" && user) {
    const points = db.listVoicePoints().map((p) => ({
      ...p,
      connected: voiceSockets.has(p.id),
    }));
    // include local hub as a synthetic point
    const settings = db.getSettings();
    return json({
      local: {
        id: "local",
        name: "Local hub",
        inputDeviceId: settings.localInputDeviceId ?? null,
        outputDeviceId: settings.localOutputDeviceId ?? null,
        connected: voiceHub.running,
        lastSeenAt: null,
      },
      points,
      daemonToken: settings.voiceDaemonToken,
    });
  }

  if (path === "/api/voice/points/local" && req.method === "PUT" && user) {
    const body = (await req.json()) as {
      inputDeviceId?: string | null;
      outputDeviceId?: string | null;
      voiceEnabled?: boolean;
    };
    if (body.inputDeviceId !== undefined) db.setSetting("localInputDeviceId", body.inputDeviceId);
    if (body.outputDeviceId !== undefined) db.setSetting("localOutputDeviceId", body.outputDeviceId);
    if (body.voiceEnabled !== undefined) db.setSetting("voiceEnabled", body.voiceEnabled);
    await voiceHub.reload();
    return json({ ok: true });
  }

  if (path.startsWith("/api/voice/points/") && req.method === "PUT" && user) {
    const id = decodeURIComponent(path.slice("/api/voice/points/".length));
    if (id === "local") return json({ error: "use /api/voice/points/local" }, 400);
    const body = (await req.json()) as {
      inputDeviceId?: string | null;
      outputDeviceId?: string | null;
      name?: string;
    };
    const points = db.listVoicePoints();
    const existing = points.find((p) => p.id === id);
    if (!existing) return json({ error: "Unknown voice point" }, 404);
    db.updateVoicePointDevices(
      id,
      body.inputDeviceId !== undefined ? body.inputDeviceId : existing.inputDeviceId,
      body.outputDeviceId !== undefined ? body.outputDeviceId : existing.outputDeviceId,
    );
    const ws = voiceSockets.get(id);
    if (ws) {
      const msg: ServerToDaemon = {
        type: "set_devices",
        inputDeviceId: body.inputDeviceId !== undefined ? body.inputDeviceId : existing.inputDeviceId,
        outputDeviceId: body.outputDeviceId !== undefined ? body.outputDeviceId : existing.outputDeviceId,
      };
      ws.send(JSON.stringify(msg));
    }
    return json({ ok: true });
  }

  if (path === "/api/tools" && req.method === "GET" && user) {
    return json({ tools: agent.listTools() });
  }

  if (path === "/api/skills" && req.method === "GET" && user) {
    return json({
      skills: skills.list().map((s) => ({ id: s.id, name: s.name, description: s.description })),
    });
  }

  if (path === "/api/memory" && req.method === "GET" && user) {
    return json({ files: memory.list() });
  }

  if (path === "/api/crons" && req.method === "GET" && user) {
    const mine = url.searchParams.get("mine") === "1";
    const jobs = mine
      ? db.listCronJobs({
          createdByKind: "web",
          createdById: String(user.id),
        })
      : db.listCronJobs();
    return json({ jobs });
  }

  if (path === "/api/crons" && req.method === "POST" && user) {
    const body = (await req.json()) as {
      title?: string;
      prompt?: string;
      runInSeconds?: number;
      everySeconds?: number;
      deliver?: "discord_dm" | "voice" | "both";
      complexity?: "simple" | "complex";
      discordUserId?: string;
      voicePointId?: string;
    };
    if (!body.title?.trim() || !body.prompt?.trim() || !body.deliver) {
      return json({ error: "title, prompt, and deliver are required" }, 400);
    }
    const actor: Actor = { kind: "web", id: String(user.id), allowSensitive: true };
    const schedule = computeSchedule({
      runInSeconds: body.runInSeconds,
      everySeconds: body.everySeconds,
    });
    if (schedule.error) return json({ error: schedule.error }, 400);
    const targets = resolveCronTargets({
      actor,
      deliver: body.deliver,
      discordUserId: body.discordUserId,
      voicePointId: body.voicePointId,
    });
    if (targets.error) return json({ error: targets.error }, 400);
    const flags = deliverFlags(body.deliver);
    const job = db.createCronJob({
      title: body.title.trim(),
      prompt: body.prompt.trim(),
      complexity: body.complexity === "complex" ? "complex" : "simple",
      deliverDiscord: flags.deliverDiscord,
      deliverVoice: flags.deliverVoice,
      discordUserId: targets.discordUserId,
      voicePointId: targets.voicePointId,
      nextRunAt: schedule.nextRunAt,
      intervalMs: schedule.intervalMs,
      createdByKind: "web",
      createdById: String(user.id),
    });
    return json({ job }, 201);
  }

  if (path.startsWith("/api/crons/") && req.method === "DELETE" && user) {
    const idStr = decodeURIComponent(path.slice("/api/crons/".length));
    const id = Number(idStr);
    if (!Number.isInteger(id) || id <= 0) return json({ error: "Invalid cron id" }, 400);
    const existing = db.getCronJob(id);
    if (!existing) return json({ error: "Not found" }, 404);
    const updated = db.cancelCronJob(id);
    return json({ job: updated, jobs: db.listCronJobs() });
  }

  return null;
}

function mask(secret: string): string {
  if (secret.length <= 8) return "…";
  return `${secret.slice(0, 4)}…${secret.slice(-4)}`;
}

async function speakReply(text: string, pointId: string | "local"): Promise<void> {
  const spoken = stripMarkdownForSpeech(text);
  if (!spoken) return;
  const settings = db.getSettings();
  let modelPath = piperModelPath(config.modelsDir, settings.piperModel);
  const outWav = join(config.dataDir, `tts-${crypto.randomUUID()}.wav`);
  console.log(
    `[voice ${new Date().toISOString().slice(11, 23)}] tts_speak — point=${pointId} chars=${spoken.length}`,
  );
  try {
    if (!existsSync(modelPath)) {
      try {
        await ensureVoiceModels(config.modelsDir, {
          wakeWord: settings.wakeWordModel,
          whisper: settings.whisperModel,
          piper: settings.piperModel,
        });
        modelPath = piperModelPath(config.modelsDir, settings.piperModel);
      } catch (err) {
        console.warn("Piper model missing and install failed:", err);
        return;
      }
    }
    if (!existsSync(modelPath)) {
      console.warn("Piper model missing; skip TTS:", modelPath);
      return;
    }
    await synthesizePiper(spoken, settings.piperBinary, modelPath, outWav);
    if (pointId === "local") {
      await playWav(outWav, settings.localOutputDeviceId);
    } else {
      const ws = voiceSockets.get(pointId);
      if (ws) {
        const buf = Buffer.from(await Bun.file(outWav).arrayBuffer());
        const msg: ServerToDaemon = {
          type: "tts_audio",
          audioBase64: buf.toString("base64"),
          format: "wav",
        };
        ws.send(JSON.stringify(msg));
      }
    }
  } catch (err) {
    console.error("TTS error:", err);
  } finally {
    cleanupVoiceTempFiles(config.dataDir, [outWav]);
  }
}

export async function handleVoiceTranscript(
  pointId: string,
  text: string,
): Promise<{ listenAgain: boolean }> {
  const trimmed = text.trim();
  if (!trimmed) return { listenAgain: false };
  const actor: Actor = { kind: "voice", id: pointId, allowSensitive: true };
  const channel = `voice:${pointId}` as const;
  console.log(
    `[voice ${new Date().toISOString().slice(11, 23)}] agent_turn — point=${pointId} chars=${trimmed.length} text="${trimmed.slice(0, 120)}${trimmed.length > 120 ? "…" : ""}"`,
  );
  try {
    const result = await agent.chat(channel, actor, trimmed);
    console.log(
      `[voice ${new Date().toISOString().slice(11, 23)}] agent_reply — chars=${result.text.length} listenAgain=${result.listenAgain}`,
    );
    await speakReply(result.text, pointId === "local" ? "local" : pointId);
    if (result.listenAgain && pointId !== "local") {
      const ws = voiceSockets.get(pointId);
      if (ws) {
        const msg: ServerToDaemon = { type: "listen_again", seconds: 45 };
        ws.send(JSON.stringify(msg));
        console.log(
          `[voice ${new Date().toISOString().slice(11, 23)}] listen_again_sent — point=${pointId}`,
        );
      }
    }
    return { listenAgain: result.listenAgain };
  } catch (err) {
    console.error("Voice agent error:", err);
    return { listenAgain: false };
  }
}

const voiceHub = new LocalVoiceHub({
  db,
  modelsDir: config.modelsDir,
  dataDir: config.dataDir,
  onTranscript: (text) => handleVoiceTranscript("local", text),
});

let discordHandle: DiscordHandle | null = null;

const cronScheduler = new CronScheduler({
  db,
  agent,
  sendDiscordDm: async (discordUserId, text) => {
    if (!discordHandle) return false;
    return discordHandle.sendDm(discordUserId, text);
  },
  speakVoice: async (pointId, text) => {
    await speakReply(text, pointId === "local" ? "local" : pointId);
  },
});

async function restartDiscord(): Promise<void> {
  if (discordHandle) {
    await discordHandle.stop();
    discordHandle = null;
  }
  const token = db.getSettings().discordToken ?? config.discordToken;
  if (!token) return;
  discordHandle = await startDiscordBot({
    token,
    db,
    agent,
  });
}

const webDist = resolve(import.meta.dir, "../../web/build");

const server = Bun.serve<VoiceSocketData>({
  hostname: config.host,
  port: config.port,
  async fetch(req, server) {
    const url = new URL(req.url);

    if (url.pathname === "/ws/voice") {
      const upgraded = server.upgrade(req, { data: { pointId: "", authed: false } });
      if (!upgraded) return new Response("WebSocket upgrade failed", { status: 400 });
      return undefined as unknown as Response;
    }

    const api = await handleApi(req, url);
    if (api) return api;

    // Static web UI
    if (existsSync(webDist)) {
      const filePath = join(webDist, url.pathname === "/" ? "index.html" : url.pathname);
      const file = Bun.file(existsSync(filePath) ? filePath : join(webDist, "200.html"));
      if (await file.exists()) return new Response(file);
      const fallback = Bun.file(join(webDist, "index.html"));
      if (await fallback.exists()) return new Response(fallback);
    }

    return json({
      name: "CottAssistant",
      hint: "Web UI not built yet. Run: bun run --filter @cottassistant/web build (or bun run dev:web)",
      health: "/api/health",
    });
  },
  websocket: {
    open() {
      /* wait for hello */
    },
    async message(ws, message) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(message));
      } catch {
        ws.send(JSON.stringify({ type: "error", message: "Invalid JSON" } satisfies ServerToDaemon));
        return;
      }
      const result = DaemonToServerSchema.safeParse(parsed);
      if (!result.success) {
        ws.send(JSON.stringify({ type: "error", message: "Invalid message" } satisfies ServerToDaemon));
        return;
      }
      const msg = result.data as DaemonToServer;
      const expected = db.getSettings().voiceDaemonToken;
      if (msg.type === "hello") {
        if (!expected || msg.token !== expected) {
          ws.send(JSON.stringify({ type: "error", message: "Invalid daemon token" } satisfies ServerToDaemon));
          ws.close();
          return;
        }
        ws.data.pointId = msg.pointId;
        ws.data.authed = true;
        voiceSockets.set(msg.pointId, ws);
        db.upsertVoicePoint(msg.pointId, msg.name, msg.devices);
        const points = db.listVoicePoints();
        const existing = points.find((p) => p.id === msg.pointId);
        ws.send(JSON.stringify({ type: "welcome", pointId: msg.pointId } satisfies ServerToDaemon));
        if (existing) {
          ws.send(
            JSON.stringify({
              type: "set_devices",
              inputDeviceId: existing.inputDeviceId,
              outputDeviceId: existing.outputDeviceId,
            } satisfies ServerToDaemon),
          );
        }
        return;
      }
      if (!ws.data.authed) {
        ws.send(JSON.stringify({ type: "error", message: "Not authenticated" } satisfies ServerToDaemon));
        return;
      }
      db.touchVoicePoint(ws.data.pointId);
      if (msg.type === "ping") {
        ws.send(JSON.stringify({ type: "pong" } satisfies ServerToDaemon));
      } else if (msg.type === "transcript") {
        await handleVoiceTranscript(msg.pointId, msg.text);
      } else if (msg.type === "audio_chunk") {
        // Buffer utterance end handled by daemon sending transcript; optional STT on server
        const pcm = Buffer.from(msg.pcmBase64, "base64");
        const wavPath = join(config.dataDir, `utt-${crypto.randomUUID()}.wav`);
        writePcmToWav(pcm, wavPath);
        const settings = db.getSettings();
        const modelPath = whisperModelPath(config.modelsDir, settings.whisperModel);
        try {
          if (!existsSync(modelPath)) {
            await ensureWhisperModel(config.modelsDir, settings.whisperModel);
          }
          const text = await transcribeWhisper(
            wavPath,
            settings.whisperBinary,
            whisperModelPath(config.modelsDir, settings.whisperModel),
          );
          if (text) await handleVoiceTranscript(msg.pointId, text);
        } catch (err) {
          console.error("Server STT failed:", err);
        }
      } else if (msg.type === "device_list") {
        db.upsertVoicePoint(msg.pointId, msg.pointId, msg.devices);
      } else if (msg.type === "wake") {
        console.log(`Wake on ${msg.pointId} at ${msg.at}`);
      }
    },
    close(ws) {
      if (ws.data.pointId) voiceSockets.delete(ws.data.pointId);
    },
  },
});

console.log(`CottAssistant listening on http://${config.host}:${config.port}`);
await restartDiscord();
await voiceHub.reload();
cronScheduler.start();

export { agent, db, server, cronScheduler };
