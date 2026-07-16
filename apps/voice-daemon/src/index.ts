import {
  listAudioDevices,
  playWav,
  recordUntilSilence,
  writePcmToWav,
  transcribeWhisper,
  playCueTone,
  audioLog,
  cleanupVoiceTempFiles,
} from "@cottassistant/core";
import type { DaemonToServer, ServerToDaemon } from "@cottassistant/shared";
import { ServerToDaemonSchema } from "@cottassistant/shared";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const SERVER_URL = process.env.COTT_SERVER_URL ?? "ws://127.0.0.1:8787/ws/voice";
const TOKEN = process.env.VOICE_DAEMON_TOKEN ?? "";
const POINT_ID = process.env.VOICE_POINT_ID ?? `point-${crypto.randomUUID().slice(0, 8)}`;
const POINT_NAME = process.env.VOICE_POINT_NAME ?? `Voice ${POINT_ID}`;
const DATA_DIR = resolve(process.env.DATA_DIR ?? "./data/daemon");
const MODELS_DIR = resolve(process.env.MODELS_DIR ?? "./data/models");
const WHISPER_BIN = process.env.WHISPER_BINARY ?? "whisper-cli";
const WHISPER_MODEL = process.env.WHISPER_MODEL ?? "ggml-medium.en";

mkdirSync(DATA_DIR, { recursive: true });

if (!TOKEN) {
  console.error("Set VOICE_DAEMON_TOKEN (from WebUI → Voice points)");
  process.exit(1);
}

let inputDeviceId: string | null = null;
let outputDeviceId: string | null = null;
let ws: WebSocket | null = null;
/** When true, skip the idle duty-cycle until a follow-up capture finishes. */
let capturingFollowup = false;

function daemonLog(stage: string, detail?: string): void {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`[daemon ${ts}] ${stage}${detail ? ` — ${detail}` : ""}`);
}

function send(msg: DaemonToServer): void {
  ws?.send(JSON.stringify(msg));
}

async function connect(): Promise<void> {
  daemonLog("connect", SERVER_URL);
  ws = new WebSocket(SERVER_URL);

  ws.addEventListener("open", async () => {
    const devices = await listAudioDevices();
    send({
      type: "hello",
      pointId: POINT_ID,
      name: POINT_NAME,
      token: TOKEN,
      devices,
    });
    daemonLog("hello_sent", `${devices.length} devices`);
  });

  ws.addEventListener("message", async (ev) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(String(ev.data));
    } catch {
      return;
    }
    const result = ServerToDaemonSchema.safeParse(parsed);
    if (!result.success) return;
    const msg = result.data;
    if (msg.type === "welcome") {
      daemonLog("welcome");
      void listenLoop();
    } else if (msg.type === "set_devices") {
      inputDeviceId = msg.inputDeviceId;
      outputDeviceId = msg.outputDeviceId;
      daemonLog("devices_set", `in=${inputDeviceId} out=${outputDeviceId}`);
    } else if (msg.type === "request_devices") {
      send({ type: "device_list", pointId: POINT_ID, devices: await listAudioDevices() });
    } else if (msg.type === "tts_audio") {
      const path = join(DATA_DIR, `tts-${Date.now()}.wav`);
      const buf = Buffer.from(msg.audioBase64, "base64");
      if (msg.format === "wav") {
        writeFileSync(path, buf);
      } else {
        writePcmToWav(buf, path);
      }
      daemonLog("tts_play", `bytes=${buf.byteLength}`);
      try {
        await playWav(path, outputDeviceId);
      } catch (err) {
        console.error("Play failed:", err);
      }
    } else if (msg.type === "listen_again") {
      daemonLog("listen_again", `vad max=${msg.seconds ?? 45}s`);
      void captureUtterance("followup", msg.seconds ?? 45);
    } else if (msg.type === "error") {
      console.error("Server error:", msg.message);
    }
  });

  ws.addEventListener("close", () => {
    daemonLog("disconnected", "reconnect in 3s");
    setTimeout(() => void connect(), 3000);
  });

  ws.addEventListener("error", (err) => {
    console.error("WebSocket error", err);
  });
}

async function captureUtterance(reason: string, maxSeconds = 45): Promise<void> {
  if (capturingFollowup && reason !== "followup") return;
  if (reason === "followup") capturingFollowup = true;
  try {
    daemonLog("listen_open", `${reason} vad`);
    await playCueTone("listen_start", DATA_DIR, outputDeviceId);
    const utt = join(DATA_DIR, `utt-${Date.now()}.wav`);
    send({ type: "wake", pointId: POINT_ID, at: Date.now() });
    const captured = await recordUntilSilence(utt, inputDeviceId, {
      maxSeconds,
      silenceMs: 900,
    });
    daemonLog(
      "listen_close",
      `${reason} end=${captured.endedReason} ${captured.durationMs}ms`,
    );
    await playCueTone("listen_stop", DATA_DIR, outputDeviceId);

    if (captured.endedReason === "no_speech" || captured.bytes < 1000) {
      daemonLog("stt_skip", captured.endedReason);
      cleanupVoiceTempFiles(DATA_DIR, [utt]);
      return;
    }

    const modelPath = resolve(MODELS_DIR, WHISPER_MODEL);
    try {
      const text = await transcribeWhisper(utt, WHISPER_BIN, modelPath);
      cleanupVoiceTempFiles(DATA_DIR, [utt]);
      if (text.trim()) {
        send({ type: "transcript", pointId: POINT_ID, text: text.trim() });
        daemonLog("transcript_sent", text.trim().slice(0, 120));
      } else {
        daemonLog("stt_empty", reason);
      }
    } catch (err) {
      audioLog("daemon_stt_fallback", String(err).slice(0, 120));
      const file = Bun.file(utt);
      const buf = Buffer.from(await file.arrayBuffer());
      const pcm = buf.subarray(44);
      send({ type: "audio_chunk", pointId: POINT_ID, pcmBase64: pcm.toString("base64") });
      daemonLog("pcm_sent", `${pcm.byteLength} bytes`);
      cleanupVoiceTempFiles(DATA_DIR, [utt]);
    }
  } catch (err) {
    console.error("Capture error:", err);
  } finally {
    if (reason === "followup") capturingFollowup = false;
  }
}

let listening = false;
async function listenLoop(): Promise<void> {
  if (listening) return;
  listening = true;
  while (ws && ws.readyState === WebSocket.OPEN) {
    try {
      await sleep(3000);
      if (capturingFollowup) continue;
      await captureUtterance("duty_cycle");
    } catch (err) {
      console.error("Listen loop error:", err);
      await sleep(2000);
    }
  }
  listening = false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

await connect();
