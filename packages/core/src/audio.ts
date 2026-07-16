import type { AudioDevice } from "@cottassistant/shared";
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

export type CueTone = "listen_start" | "listen_stop";

/** Timestamped audio-pipeline logs (STT/TTS/record/play/cues). */
export function audioLog(stage: string, detail?: string): void {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`[audio ${ts}] ${stage}${detail ? ` — ${detail}` : ""}`);
}

/** Enumerate PipeWire/PulseAudio devices on Linux; falls back to placeholders. */
export async function listAudioDevices(): Promise<AudioDevice[]> {
  const devices: AudioDevice[] = [];

  try {
    const sinks = await Bun.$`pactl list short sinks`.text();
    for (const line of sinks.trim().split("\n")) {
      if (!line.trim()) continue;
      const parts = line.split("\t");
      const id = parts[1] ?? parts[0] ?? "unknown";
      const name = parts[1] ?? id;
      devices.push({ id, name: `Output: ${name}`, direction: "output" });
    }
  } catch {
    /* ignore */
  }

  try {
    const sources = await Bun.$`pactl list short sources`.text();
    for (const line of sources.trim().split("\n")) {
      if (!line.trim() || line.includes(".monitor")) continue;
      const parts = line.split("\t");
      const id = parts[1] ?? parts[0] ?? "unknown";
      const name = parts[1] ?? id;
      devices.push({ id, name: `Input: ${name}`, direction: "input" });
    }
  } catch {
    /* ignore */
  }

  if (devices.length === 0) {
    devices.push(
      { id: "default", name: "Default input", direction: "input" },
      { id: "default", name: "Default output", direction: "output" },
    );
  }

  return devices;
}

export async function recordWav(
  outputPath: string,
  seconds: number,
  deviceId?: string | null,
  opts?: { quiet?: boolean },
): Promise<void> {
  mkdirSync(join(outputPath, ".."), { recursive: true });
  const t0 = Date.now();
  const quiet = opts?.quiet === true;
  const log = (stage: string, detail?: string) => {
    if (!quiet) audioLog(stage, detail);
  };
  log("record_start", `${seconds}s device=${deviceId ?? "default"} → ${outputPath}`);

  const usePipeWireFirst = isPipeWireDeviceId(deviceId);

  if (!usePipeWireFirst) {
    try {
      if (deviceId && deviceId !== "default") {
        await Bun.$`arecord -D ${deviceId} -f S16_LE -r 16000 -c 1 -d ${seconds} ${outputPath}`.quiet();
      } else {
        await Bun.$`arecord -f S16_LE -r 16000 -c 1 -d ${seconds} ${outputPath}`.quiet();
      }
      const size = existsSync(outputPath) ? statSync(outputPath).size : 0;
      log("record_done", `backend=arecord ${Date.now() - t0}ms bytes=${size}`);
      return;
    } catch (err) {
      // Expected when UI stores Pulse/PipeWire names; only log if we thought ALSA might work
      audioLog("record_arecord_fallback", briefErr(err));
    }
  }

  const targetArgs =
    deviceId && deviceId !== "default" ? ["--target", deviceId] : [];
  const proc = Bun.spawn(
    [
      "timeout",
      String(seconds),
      "pw-record",
      ...targetArgs,
      "--rate",
      "16000",
      "--channels",
      "1",
      "--format",
      "s16",
      outputPath,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const code = await proc.exited;
  // timeout exits 124 when duration elapses — that is success for recording
  if (code !== 0 && code !== 124) {
    const err = await new Response(proc.stderr).text();
    audioLog("record_fail", `exit ${code}: ${err.slice(0, 200)}`);
    throw new Error(`Failed to record audio (exit ${code}): ${err}`);
  }
  const size = existsSync(outputPath) ? statSync(outputPath).size : 0;
  log("record_done", `backend=pw-record exit=${code} ${Date.now() - t0}ms bytes=${size}`);
}

export type RecordUntilSilenceResult = {
  durationMs: number;
  endedReason: "silence" | "max" | "no_speech" | "aborted";
  bytes: number;
};

export type RecordUntilSilenceOpts = {
  quiet?: boolean;
  /** Hard cap on recording length (default 45s). */
  maxSeconds?: number;
  /** End after this much continuous relative-silence once speech was heard (default 900ms). */
  silenceMs?: number;
  /** Minimum speech before silence can end the utterance (default 350ms). */
  minSpeechMs?: number;
  /** Give up if no speech is detected within this window (default 12s). */
  maxInitialSilenceMs?: number;
  /** Fixed RMS threshold 0–1; if omitted, adapts from the noise floor. */
  speechThreshold?: number;
  /** Skip leading audio for VAD (avoids cue-tone bleed; still recorded). */
  ignoreLeadingMs?: number;
  signal?: AbortSignal;
};

/**
 * Stream-capture until the user stops speaking (energy VAD), then write a WAV.
 * Falls back to a fixed-length recording if streaming capture cannot start.
 */
export async function recordUntilSilence(
  outputPath: string,
  deviceId?: string | null,
  opts?: RecordUntilSilenceOpts,
): Promise<RecordUntilSilenceResult> {
  mkdirSync(join(outputPath, ".."), { recursive: true });
  const quiet = opts?.quiet === true;
  const log = (stage: string, detail?: string) => {
    if (!quiet) audioLog(stage, detail);
  };

  const sampleRate = 16000;
  const frameSamples = 320; // 20ms
  const frameBytes = frameSamples * 2;
  const maxSeconds = opts?.maxSeconds ?? 45;
  const silenceMs = opts?.silenceMs ?? 900;
  const minSpeechMs = opts?.minSpeechMs ?? 350;
  const maxInitialSilenceMs = opts?.maxInitialSilenceMs ?? 12_000;
  const ignoreLeadingMs = opts?.ignoreLeadingMs ?? 280;
  const fixedThreshold = opts?.speechThreshold;

  log(
    "vad_start",
    `device=${deviceId ?? "default"} max=${maxSeconds}s silence=${silenceMs}ms → ${outputPath}`,
  );

  const capture = spawnRawCapture(deviceId);
  if (!capture.proc.stdout) {
    capture.proc.kill();
    await capture.proc.exited.catch(() => undefined);
    log("vad_fallback", "no stdout — fixed-length record");
    await recordWav(outputPath, Math.min(maxSeconds, 7.5), deviceId, { quiet });
    const bytes = existsSync(outputPath) ? statSync(outputPath).size : 0;
    return { durationMs: Math.min(maxSeconds, 7.5) * 1000, endedReason: "max", bytes };
  }

  const t0 = Date.now();
  const pcmChunks: Buffer[] = [];
  let pending = Buffer.alloc(0);
  let totalSamples = 0;
  let speechSamples = 0;
  let silenceSamples = 0;
  let heardSpeech = false;
  let endedReason: RecordUntilSilenceResult["endedReason"] = "max";
  let noiseFloor = fixedThreshold ?? 0.01;
  let noisePrimed = fixedThreshold != null;
  let speechPeak = 0;
  /** Dynamic end-of-speech threshold: relative drop from peak + noise floor. */
  let endThreshold = fixedThreshold ?? 0.02;

  const reader = capture.proc.stdout.getReader();
  const onAbort = () => {
    try {
      capture.proc.kill();
    } catch {
      /* ignore */
    }
  };
  opts?.signal?.addEventListener("abort", onAbort, { once: true });

  let stop = false;
  try {
    while (!stop) {
      if (opts?.signal?.aborted) {
        endedReason = "aborted";
        break;
      }

      const { done, value } = await reader.read();
      if (done) {
        if (endedReason === "max" && !heardSpeech) endedReason = "no_speech";
        break;
      }
      pending = Buffer.concat([pending, Buffer.from(value)]);

      while (!stop && pending.length >= frameBytes) {
        const frame = Buffer.from(pending.subarray(0, frameBytes));
        pending = pending.subarray(frameBytes);
        pcmChunks.push(frame);
        totalSamples += frameSamples;

        const totalMs = (totalSamples / sampleRate) * 1000;
        const rms = frameRms(frame);
        const vadActive = totalMs >= ignoreLeadingMs;

        if (vadActive && !noisePrimed) {
          // Prime noise floor from early ambient frames
          noiseFloor = noiseFloor * 0.85 + rms * 0.15;
          if (totalMs >= ignoreLeadingMs + 350) {
            noisePrimed = true;
            noiseFloor = Math.max(0.004, Math.min(0.06, noiseFloor));
          }
        } else if (vadActive && !heardSpeech) {
          // Keep tracking ambient before first speech
          noiseFloor = Math.min(noiseFloor, noiseFloor * 0.95 + rms * 0.05);
        } else if (vadActive && heardSpeech && rms < endThreshold) {
          // Slow-adapt floor during quiet stretches
          noiseFloor = noiseFloor * 0.98 + rms * 0.02;
        }

        // Enter speech on clearly elevated energy vs noise
        const speechEnter = Math.max(noiseFloor * 2.8 + 0.006, 0.014);
        const isSpeech = vadActive && rms >= speechEnter;

        if (isSpeech) {
          if (!heardSpeech) {
            heardSpeech = true;
            speechPeak = rms;
            endThreshold = Math.max(noiseFloor * 1.6, speechPeak * 0.28);
            log(
              "vad_speech",
              `rms=${rms.toFixed(4)} enter=${speechEnter.toFixed(4)} floor=${noiseFloor.toFixed(4)}`,
            );
          }
          speechPeak = Math.max(speechPeak * 0.992, rms);
          // End when energy falls near noise or well below recent peak (handles room hiss)
          endThreshold = Math.max(
            noiseFloor * 1.75 + 0.003,
            Math.min(speechPeak * 0.32, speechPeak * 0.45),
          );
          speechSamples += frameSamples;
          silenceSamples = 0;
        } else if (vadActive && heardSpeech) {
          // Relative silence: below endThreshold counts even if not "pure" quiet
          if (rms < endThreshold) {
            silenceSamples += frameSamples;
          } else {
            // Soft energy — treat as trailing speech / breath, don't fully reset
            silenceSamples = Math.max(0, silenceSamples - frameSamples / 2);
            speechPeak = Math.max(speechPeak * 0.995, rms);
          }
        }

        const silenceDurMs = (silenceSamples / sampleRate) * 1000;
        const speechDurMs = (speechSamples / sampleRate) * 1000;

        if (totalMs >= maxSeconds * 1000) {
          endedReason = "max";
          stop = true;
        } else if (!heardSpeech && totalMs >= maxInitialSilenceMs) {
          endedReason = "no_speech";
          stop = true;
        } else if (heardSpeech && speechDurMs >= minSpeechMs && silenceDurMs >= silenceMs) {
          endedReason = "silence";
          stop = true;
        }
      }
    }
  } finally {
    opts?.signal?.removeEventListener("abort", onAbort);
    try {
      await reader.cancel();
    } catch {
      /* ignore */
    }
    try {
      capture.proc.kill();
    } catch {
      /* ignore */
    }
    await capture.proc.exited.catch(() => undefined);
  }

  if (opts?.signal?.aborted) endedReason = "aborted";

  const pcm = Buffer.concat(pcmChunks);
  writePcmToWav(pcm, outputPath, sampleRate);
  const durationMs = Math.round((pcm.byteLength / 2 / sampleRate) * 1000);
  log(
    "vad_done",
    `backend=${capture.backend} reason=${endedReason} ${durationMs}ms peak=${speechPeak.toFixed(4)} endThr=${endThreshold.toFixed(4)} floor=${noiseFloor.toFixed(4)} bytes=${pcm.byteLength} wall=${Date.now() - t0}ms`,
  );
  return { durationMs, endedReason, bytes: pcm.byteLength };
}

function frameRms(pcm: Buffer): number {
  const n = Math.floor(pcm.byteLength / 2);
  if (n <= 0) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const s = pcm.readInt16LE(i * 2) / 32768;
    sum += s * s;
  }
  return Math.sqrt(sum / n);
}

function spawnRawCapture(deviceId?: string | null): {
  proc: ReturnType<typeof Bun.spawn>;
  backend: string;
} {
  if (!isPipeWireDeviceId(deviceId) && deviceId && deviceId !== "default") {
    const proc = Bun.spawn(
      [
        "arecord",
        "-D",
        deviceId,
        "-f",
        "S16_LE",
        "-r",
        "16000",
        "-c",
        "1",
        "-t",
        "raw",
        "-",
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    return { proc, backend: "arecord" };
  }

  const targetArgs =
    deviceId && deviceId !== "default" ? ["--target", deviceId] : [];
  const proc = Bun.spawn(
    [
      "pw-record",
      ...targetArgs,
      "--rate",
      "16000",
      "--channels",
      "1",
      "--format",
      "s16",
      "-",
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  return { proc, backend: "pw-record" };
}

/** pactl / PipeWire node names are not ALSA `-D` device strings. */
function isPipeWireDeviceId(deviceId?: string | null): boolean {
  if (!deviceId || deviceId === "default") return false;
  if (/^(hw:|plughw:|sysdefault|front:|rear:|surround|iec958)/i.test(deviceId)) {
    return false;
  }
  return (
    deviceId.startsWith("alsa_") ||
    deviceId.startsWith("bluez_") ||
    deviceId.startsWith("pipewire") ||
    deviceId.includes(".")
  );
}

export async function playWav(path: string, deviceId?: string | null): Promise<void> {
  if (!existsSync(path)) throw new Error(`Audio file not found: ${path}`);
  const t0 = Date.now();
  const size = statSync(path).size;
  audioLog("play_start", `device=${deviceId ?? "default"} ${path} bytes=${size}`);
  if (deviceId && deviceId !== "default") {
    try {
      await Bun.$`pw-play --target ${deviceId} ${path}`.quiet();
      audioLog("play_done", `backend=pw-play-target ${Date.now() - t0}ms`);
      return;
    } catch (err) {
      audioLog("play_fallback", briefErr(err));
    }
  }
  try {
    await Bun.$`pw-play ${path}`.quiet();
    audioLog("play_done", `backend=pw-play ${Date.now() - t0}ms`);
  } catch {
    try {
      await Bun.$`aplay ${path}`.quiet();
      audioLog("play_done", `backend=aplay ${Date.now() - t0}ms`);
    } catch (err) {
      audioLog("play_fail", briefErr(err));
      throw new Error(`Failed to play audio: ${String(err)}`);
    }
  }
}

/** Write a short rising (start) or falling (stop) cue tone as WAV. */
export function writeToneWav(outPath: string, kind: CueTone, sampleRate = 16000): void {
  const durationMs = kind === "listen_start" ? 280 : 220;
  const samples = Math.floor((sampleRate * durationMs) / 1000);
  const pcm = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    const t = i / sampleRate;
    const fadeIn = Math.min(1, i / 180);
    const fadeOut = Math.min(1, (samples - i) / 320);
    const env = fadeIn * fadeOut;
    const freq =
      kind === "listen_start"
        ? 720 + (920 - 720) * (i / samples)
        : 520 - (520 - 340) * (i / samples);
    const sample = Math.sin(2 * Math.PI * freq * t) * 0.38 * env;
    pcm.writeInt16LE(Math.max(-32767, Math.min(32767, Math.floor(sample * 32767))), i * 2);
  }
  writePcmToWav(pcm, outPath, sampleRate);
}

/** Play listen_start / listen_stop cue on the configured output device. */
export async function playCueTone(
  kind: CueTone,
  dataDir: string,
  deviceId?: string | null,
): Promise<void> {
  mkdirSync(dataDir, { recursive: true });
  const path = join(dataDir, `cue-${kind}.wav`);
  writeToneWav(path, kind);
  audioLog("cue", kind);
  try {
    await playWav(path, deviceId);
  } catch (err) {
    audioLog("cue_fail", `${kind}: ${briefErr(err)}`);
  }
}

function briefErr(err: unknown): string {
  const s = err instanceof Error ? err.message : String(err);
  return s.length > 240 ? `${s.slice(0, 240)}…` : s;
}

export async function resolvePiperBinary(preferred?: string): Promise<string> {
  const candidates = [preferred, "piper-tts", "piper"].filter(
    (c): c is string => Boolean(c && c.trim()),
  );
  for (const name of candidates) {
    try {
      const which = await Bun.$`which ${name}`.text();
      const path = which.trim();
      if (path) return path;
    } catch {
      /* try next */
    }
  }
  return preferred?.trim() || "piper-tts";
}

export async function synthesizePiper(
  text: string,
  piperBinary: string,
  modelPath: string,
  outWav: string,
): Promise<void> {
  const bin = await resolvePiperBinary(piperBinary);
  const t0 = Date.now();
  audioLog(
    "tts_start",
    `bin=${bin} model=${modelPath} chars=${text.length} preview="${text.slice(0, 80)}${text.length > 80 ? "…" : ""}"`,
  );
  const proc = Bun.spawn([bin, "--model", modelPath, "--output_file", outWav], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  proc.stdin.write(text);
  proc.stdin.end();
  const code = await proc.exited;
  if (code !== 0) {
    const err = await new Response(proc.stderr).text();
    audioLog("tts_fail", `exit ${code}: ${err.slice(0, 200)}`);
    throw new Error(`Piper failed (${code}): ${err}`);
  }
  const size = existsSync(outWav) ? statSync(outWav).size : 0;
  audioLog("tts_done", `${Date.now() - t0}ms bytes=${size} resolved_bin=${bin}`);
}

export async function transcribeWhisper(
  wavPath: string,
  whisperBinary: string,
  modelPath: string,
): Promise<string> {
  const outBase = join(tmpdir(), `cott-whisper-${crypto.randomUUID()}`);
  const t0 = Date.now();
  const inSize = existsSync(wavPath) ? statSync(wavPath).size : 0;
  audioLog("stt_start", `bin=${whisperBinary} model=${modelPath} wav=${wavPath} bytes=${inSize}`);
  try {
    await Bun.$`${whisperBinary} -m ${modelPath} -f ${wavPath} -otxt -of ${outBase}`.quiet();
  } catch {
    // alternate CLI flags (whisper.cpp whisper-cli)
    try {
      await Bun.$`${whisperBinary} -m ${modelPath} ${wavPath} -otxt -of ${outBase}`.quiet();
    } catch (err) {
      audioLog("stt_fail", briefErr(err));
      throw new Error(`Whisper failed: ${String(err)}`);
    }
  }
  const txtPath = `${outBase}.txt`;
  if (!existsSync(txtPath)) {
    audioLog("stt_done", `${Date.now() - t0}ms empty (no txt)`);
    return "";
  }
  const text = readFileSync(txtPath, "utf8").trim();
  audioLog(
    "stt_done",
    `${Date.now() - t0}ms chars=${text.length} text="${text.slice(0, 120)}${text.length > 120 ? "…" : ""}"`,
  );
  return text;
}

export function writePcmToWav(pcm: Buffer, outPath: string, sampleRate = 16000): void {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  writeFileSync(outPath, Buffer.concat([header, pcm]));
}

/** Delete ephemeral voice wavs (utterances, TTS, wake chunks). Keeps cue tones + models. */
export function cleanupVoiceTempFiles(dataDir: string, extraPaths: string[] = []): void {
  const patterns = [/^utt-/i, /^tts-/i, /^wake-chunk/i];
  try {
    for (const name of readdirSync(dataDir)) {
      if (!name.endsWith(".wav") && !name.endsWith(".wav.partial")) continue;
      if (name.startsWith("cue-")) continue;
      if (patterns.some((re) => re.test(name))) {
        try {
          unlinkSync(join(dataDir, name));
        } catch {
          /* ignore */
        }
      }
    }
  } catch {
    /* ignore */
  }
  for (const p of extraPaths) {
    try {
      if (existsSync(p)) unlinkSync(p);
    } catch {
      /* ignore */
    }
  }
}
