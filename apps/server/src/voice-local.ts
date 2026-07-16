import type { Database } from "@cottassistant/core";
import {
  recordWav,
  recordUntilSilence,
  transcribeWhisper,
  ensureVoiceModels,
  whisperModelPath,
  wakeWordModelPath,
  playCueTone,
  audioLog,
  cleanupVoiceTempFiles,
} from "@cottassistant/core";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/** Safety cap for a single utterance (VAD usually ends earlier on silence). */
const MAX_UTTERANCE_SECONDS = 45;
/** Safety cap only — model may chain follow-ups freely within a turn. */
const MAX_FOLLOWUPS = 16;

export type TranscriptHandlerResult = { listenAgain?: boolean } | void;

/**
 * Local voice hub: OWW wake → cue → record → cue → Whisper → onTranscript.
 * If the agent requests follow-up, mic reopens (with start tone) without another wake.
 */
export class LocalVoiceHub {
  running = false;
  private abort: AbortController | null = null;
  private loopPromise: Promise<void> | null = null;
  private consecutiveErrors = 0;

  constructor(
    private readonly opts: {
      db: Database;
      modelsDir: string;
      dataDir: string;
      onTranscript: (text: string) => Promise<TranscriptHandlerResult>;
    },
  ) {}

  async reload(): Promise<void> {
    await this.stop();
    const settings = this.opts.db.getSettings();
    if (!settings.voiceEnabled) {
      voiceLog("hub_disabled");
      return;
    }

    try {
      voiceLog("models_ensure_start");
      await ensureVoiceModels(this.opts.modelsDir, {
        wakeWord: settings.wakeWordModel,
        whisper: settings.whisperModel,
        piper: settings.piperModel,
      });
      voiceLog("models_ensure_done");
    } catch (err) {
      console.error("Failed to install voice models:", err);
      return;
    }

    this.running = true;
    this.consecutiveErrors = 0;
    this.abort = new AbortController();
    this.loopPromise = this.loop(this.abort.signal);
    voiceLog("hub_started", `input=${settings.localInputDeviceId ?? "default"} output=${settings.localOutputDeviceId ?? "default"}`);
  }

  async stop(): Promise<void> {
    this.abort?.abort();
    this.abort = null;
    this.running = false;
    if (this.loopPromise) {
      await this.loopPromise.catch(() => undefined);
      this.loopPromise = null;
    }
    voiceLog("hub_stopped");
  }

  private async loop(signal: AbortSignal): Promise<void> {
    const oww = await this.tryLoadOWW();
    if (!oww) {
      voiceLog(
        "wake_engine_unavailable",
        "falling back to fixed-interval listen (no OWW)",
      );
    } else {
      voiceLog("wake_engine_ready");
    }
    mkdirSync(this.opts.dataDir, { recursive: true });

    while (!signal.aborted) {
      try {
        const settings = this.opts.db.getSettings();
        if (!settings.voiceEnabled) break;

        if (oww) {
          const chunkPath = join(this.opts.dataDir, "wake-chunk.wav");
          await recordWav(chunkPath, 1, settings.localInputDeviceId, { quiet: true });
          if (signal.aborted) break;
          const woke = await oww.predictFile(chunkPath);
          if (!woke) {
            this.consecutiveErrors = 0;
            await sleep(50);
            continue;
          }
          voiceLog("wake_detected");
        } else {
          await sleep(5000);
          if (signal.aborted) break;
          voiceLog("interval_listen", "OWW unavailable — capturing utterance");
        }

        await this.runConversationTurn(signal);
        cleanupVoiceTempFiles(this.opts.dataDir);
        this.consecutiveErrors = 0;
      } catch (err) {
        if (signal.aborted) break;
        this.consecutiveErrors += 1;
        if (this.consecutiveErrors <= 3 || this.consecutiveErrors % 20 === 0) {
          console.error("Voice hub loop error:", briefError(err));
        }
        await sleep(Math.min(10_000, 500 * this.consecutiveErrors));
      }
    }
    this.running = false;
  }

  /** Capture → STT → agent; optionally follow-up listens without wake. */
  private async runConversationTurn(signal: AbortSignal): Promise<void> {
    let text = await this.captureAndTranscribe(signal, "wake");
    if (!text || signal.aborted) return;

    let result = await this.opts.onTranscript(text);
    let followups = 0;
    while (result?.listenAgain && followups < MAX_FOLLOWUPS && !signal.aborted) {
      followups += 1;
      voiceLog("followup_listen", `round ${followups}/${MAX_FOLLOWUPS}`);
      text = await this.captureAndTranscribe(signal, `followup-${followups}`);
      if (!text) {
        voiceLog("followup_empty", "no speech transcribed; ending follow-up");
        break;
      }
      result = await this.opts.onTranscript(text);
    }
    if (result?.listenAgain && followups >= MAX_FOLLOWUPS) {
      voiceLog("followup_capped", `max ${MAX_FOLLOWUPS} reached`);
    }
  }

  private async captureAndTranscribe(
    signal: AbortSignal,
    reason: string,
  ): Promise<string | null> {
    const settings = this.opts.db.getSettings();
    const isFollowup = reason.startsWith("followup");
    voiceLog("listen_open", `${reason} vad (max ${MAX_UTTERANCE_SECONDS}s)`);
    await playCueTone("listen_start", this.opts.dataDir, settings.localOutputDeviceId);
    if (signal.aborted) return null;

    const uttPath = join(this.opts.dataDir, `utt-local-${Date.now()}.wav`);
    const captured = await recordUntilSilence(uttPath, settings.localInputDeviceId, {
      signal,
      maxSeconds: MAX_UTTERANCE_SECONDS,
      silenceMs: 900,
    });
    if (signal.aborted) return null;

    voiceLog(
      "listen_close",
      `${reason} end=${captured.endedReason} ${captured.durationMs}ms`,
    );
    await playCueTone("listen_stop", this.opts.dataDir, settings.localOutputDeviceId);
    if (isFollowup) {
      voiceLog("followup_stop_tone", reason);
    }

    if (captured.endedReason === "no_speech" || captured.bytes < 1000) {
      voiceLog("stt_skip", `no usable audio (${captured.endedReason})`);
      return null;
    }

    const modelPath = whisperModelPath(this.opts.modelsDir, settings.whisperModel);
    try {
      const text = await transcribeWhisper(uttPath, settings.whisperBinary, modelPath);
      const trimmed = text.trim();
      cleanupVoiceTempFiles(this.opts.dataDir, [uttPath]);
      if (!trimmed) {
        voiceLog("stt_empty", reason);
        return null;
      }
      voiceLog("transcript", `"${trimmed.slice(0, 160)}${trimmed.length > 160 ? "…" : ""}"`);
      return trimmed;
    } catch (err) {
      cleanupVoiceTempFiles(this.opts.dataDir, [uttPath]);
      console.warn("Whisper unavailable or failed:", briefError(err));
      return null;
    }
  }

  private async tryLoadOWW(): Promise<{ predictFile: (path: string) => Promise<boolean> } | null> {
    const settings = this.opts.db.getSettings();
    const modelFile = wakeWordModelPath(this.opts.modelsDir, settings.wakeWordModel);
    const mel = join(this.opts.modelsDir, "melspectrogram.onnx");
    const emb = join(this.opts.modelsDir, "embedding_model.onnx");
    if (!existsSync(modelFile) || !existsSync(mel) || !existsSync(emb)) {
      voiceLog("oww_models_missing");
      return null;
    }

    try {
      const wasmPaths = await configureOrtWasm();

      const mod = await import("openwakeword-js").catch((err) => {
        console.warn("openwakeword-js import failed:", briefError(err));
        return null;
      });
      if (!mod) return null;

      const Model = (
        mod as {
          Model?: new (opts: Record<string, unknown>) => {
            init: () => Promise<void>;
            predict: (d: Float32Array | Int16Array) => Promise<Record<string, number>>;
          };
        }
      ).Model;
      if (!Model) return null;

      const vad = join(this.opts.modelsDir, "silero_vad.onnx");
      // onnxruntime-web loads models via fetch() — Bun needs file:// URLs
      const toUrl = (p: string) => pathToFileURL(p).href;
      const model = new Model({
        wakewordModels: [toUrl(modelFile)],
        melspectrogramModelPath: toUrl(mel),
        embeddingModelPath: toUrl(emb),
        ...(existsSync(vad)
          ? { vadModelPath: toUrl(vad), vadThreshold: 0.5 }
          : {}),
        inferenceFramework: "onnx",
        ...(wasmPaths ? { wasmPaths } : {}),
      });

      // Must call init() — `await model.init` (without ()) never loads sessions
      await model.init();
      voiceLog("oww_init_ok", settings.wakeWordModel);

      return {
        predictFile: async (path: string) => {
          const buf = Buffer.from(await Bun.file(path).arrayBuffer());
          if (buf.byteLength <= 44) return false;
          const pcm = buf.subarray(44);
          const samples = new Int16Array(
            pcm.buffer,
            pcm.byteOffset,
            Math.floor(pcm.byteLength / 2),
          );
          const scores = await model.predict(samples);
          const score = Object.values(scores)[0] ?? 0;
          const woke = score > 0.5;
          if (woke) {
            voiceLog("oww_score", `score=${score.toFixed(3)} (threshold 0.5)`);
          }
          return woke;
        },
      };
    } catch (err) {
      console.warn("Failed to load openwakeword-js:", briefError(err));
      return null;
    }
  }
}

function voiceLog(stage: string, detail?: string): void {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`[voice ${ts}] ${stage}${detail ? ` — ${detail}` : ""}`);
  // Keep audioLog namespace consistent for grepping the full pipeline
  if (stage === "wake_detected" || stage.startsWith("listen_") || stage.startsWith("followup")) {
    audioLog(`voice_${stage}`, detail);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function briefError(err: unknown): string {
  if (err instanceof Error) {
    const msg = err.message || err.name;
    return msg.length > 400 ? `${msg.slice(0, 400)}…` : msg;
  }
  const s = String(err);
  return s.length > 400 ? `${s.slice(0, 400)}…` : s;
}

async function configureOrtWasm(): Promise<string | null> {
  try {
    const ort = await import("onnxruntime-web");
    const wasmDir = findOrtWasmDir();
    if (wasmDir) {
      ort.env.wasm.wasmPaths = wasmDir;
      voiceLog("ort_wasm", wasmDir);
    }
    ort.env.wasm.numThreads = 1;
    return wasmDir;
  } catch (err) {
    console.warn("Could not configure onnxruntime-web:", briefError(err));
    return findOrtWasmDir();
  }
}

function findOrtWasmDir(): string | null {
  // Walk Bun's package store for onnxruntime-web dist with wasm files
  const roots = [
    join(process.cwd(), "node_modules/onnxruntime-web/dist"),
    join(process.cwd(), "node_modules/.bun"),
  ];

  for (const root of roots) {
    if (!existsSync(root)) continue;
    if (root.endsWith("/dist") && existsSync(join(root, "ort-wasm-simd-threaded.wasm"))) {
      return root.endsWith("/") ? root : `${root}/`;
    }
    try {
      for (const entry of readdirSync(root)) {
        if (!entry.startsWith("onnxruntime-web@")) continue;
        const dist = join(root, entry, "node_modules/onnxruntime-web/dist");
        if (existsSync(join(dist, "ort-wasm-simd-threaded.wasm"))) {
          return `${dist}/`;
        }
      }
    } catch {
      /* ignore */
    }
  }
  return null;
}
