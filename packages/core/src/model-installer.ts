import { existsSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  isKnownPiperModel,
  isKnownWakeWord,
  isKnownWhisperModel,
  PIPER_MODEL_OPTIONS,
  WAKE_WORD_OPTIONS,
  WHISPER_MODEL_OPTIONS,
  type ModelOption,
} from "./model-catalog";

const OWW_RELEASE =
  "https://github.com/dscripka/openWakeWord/releases/download/v0.5.1";
const WHISPER_HF = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main";
const PIPER_HF = "https://huggingface.co/rhasspy/piper-voices/resolve/main";

/** Map Piper voice id → HF path under rhasspy/piper-voices */
const PIPER_PATHS: Record<string, string> = {
  "en_US-lessac-high": "en/en_US/lessac/high/en_US-lessac-high",
  "en_US-lessac-medium": "en/en_US/lessac/medium/en_US-lessac-medium",
  "en_US-amy-medium": "en/en_US/amy/medium/en_US-amy-medium",
  "en_US-ryan-high": "en/en_US/ryan/high/en_US-ryan-high",
  "en_US-ryan-medium": "en/en_US/ryan/medium/en_US-ryan-medium",
  "en_US-joe-medium": "en/en_US/joe/medium/en_US-joe-medium",
  "en_US-hfc_female-medium": "en/en_US/hfc_female/medium/en_US-hfc_female-medium",
  "en_US-hfc_male-medium": "en/en_US/hfc_male/medium/en_US-hfc_male-medium",
  "en_US-libritts-high": "en/en_US/libritts/high/en_US-libritts-high",
  "en_US-ljspeech-high": "en/en_US/ljspeech/high/en_US-ljspeech-high",
  "en_GB-cori-high": "en/en_GB/cori/high/en_GB-cori-high",
  "en_GB-cori-medium": "en/en_GB/cori/medium/en_GB-cori-medium",
  "en_GB-alan-medium": "en/en_GB/alan/medium/en_GB-alan-medium",
  "en_GB-alba-medium": "en/en_GB/alba/medium/en_GB-alba-medium",
  "en_GB-northern_english_male-medium":
    "en/en_GB/northern_english_male/medium/en_GB-northern_english_male-medium",
  "en_GB-semaine-medium": "en/en_GB/semaine/medium/en_GB-semaine-medium",
};

const OWW_WAKE_ASSETS: Record<string, string> = {
  hey_jarvis: "hey_jarvis_v0.1.onnx",
  alexa: "alexa_v0.1.onnx",
  hey_mycroft: "hey_mycroft_v0.1.onnx",
  hey_rhasspy: "hey_rhasspy_v0.1.onnx",
  timer: "timer_v0.1.onnx",
  weather: "weather_v0.1.onnx",
};

export interface ModelInstallStatus {
  wakeWord: { id: string; ready: boolean; path: string };
  whisper: { id: string; ready: boolean; path: string };
  piper: { id: string; ready: boolean; path: string; jsonPath: string };
  owwShared: { ready: boolean; files: string[] };
}

export function whisperModelPath(modelsDir: string, id: string): string {
  // Accept either "base.en" or "ggml-base.en.bin"
  const file = id.endsWith(".bin") ? id : id.startsWith("ggml-") ? `${id}.bin` : `ggml-${id}.bin`;
  return join(modelsDir, file);
}

export function wakeWordModelPath(modelsDir: string, id: string): string {
  return join(modelsDir, `${id}.onnx`);
}

export function piperModelPath(modelsDir: string, id: string): string {
  return join(modelsDir, `${id}.onnx`);
}

export function piperConfigPath(modelsDir: string, id: string): string {
  return join(modelsDir, `${id}.onnx.json`);
}

export function getModelInstallStatus(
  modelsDir: string,
  ids: { wakeWord: string; whisper: string; piper: string },
): ModelInstallStatus {
  const shared = ["melspectrogram.onnx", "embedding_model.onnx"];
  const sharedReady = shared.every((f) => existsSync(join(modelsDir, f)));
  const wakePath = wakeWordModelPath(modelsDir, ids.wakeWord);
  const whisperPath = whisperModelPath(modelsDir, ids.whisper);
  const piperPath = piperModelPath(modelsDir, ids.piper);
  const piperJson = piperConfigPath(modelsDir, ids.piper);
  return {
    wakeWord: { id: ids.wakeWord, ready: existsSync(wakePath) && sharedReady, path: wakePath },
    whisper: { id: ids.whisper, ready: existsSync(whisperPath), path: whisperPath },
    piper: {
      id: ids.piper,
      ready: existsSync(piperPath) && existsSync(piperJson),
      path: piperPath,
      jsonPath: piperJson,
    },
    owwShared: {
      ready: sharedReady,
      files: shared.map((f) => join(modelsDir, f)),
    },
  };
}

async function downloadToFile(url: string, dest: string): Promise<void> {
  mkdirSync(join(dest, ".."), { recursive: true });
  const tmp = `${dest}.partial`;
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(10 * 60_000),
    });
    if (!res.ok) {
      throw new Error(`Download failed ${res.status} for ${url}`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    writeFileSync(tmp, buf);
    renameSync(tmp, dest);
  } catch (err) {
    try {
      unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    throw err;
  }
}

async function ensureFile(url: string, dest: string, label: string): Promise<"skipped" | "downloaded"> {
  if (existsSync(dest)) return "skipped";
  console.log(`Downloading ${label}…`);
  await downloadToFile(url, dest);
  console.log(`Saved ${dest}`);
  return "downloaded";
}

export async function ensureOwwShared(modelsDir: string): Promise<void> {
  mkdirSync(modelsDir, { recursive: true });
  await ensureFile(
    `${OWW_RELEASE}/melspectrogram.onnx`,
    join(modelsDir, "melspectrogram.onnx"),
    "OWW melspectrogram",
  );
  await ensureFile(
    `${OWW_RELEASE}/embedding_model.onnx`,
    join(modelsDir, "embedding_model.onnx"),
    "OWW embedding",
  );
  // Optional VAD — small, useful
  await ensureFile(
    `${OWW_RELEASE}/silero_vad.onnx`,
    join(modelsDir, "silero_vad.onnx"),
    "Silero VAD",
  );
}

export async function ensureWakeWordModel(modelsDir: string, id: string): Promise<string> {
  if (!isKnownWakeWord(id)) {
    throw new Error(`Unknown wake word model: ${id}`);
  }
  await ensureOwwShared(modelsDir);
  const asset = OWW_WAKE_ASSETS[id];
  if (!asset) throw new Error(`No download asset for wake word: ${id}`);
  const dest = wakeWordModelPath(modelsDir, id);
  await ensureFile(`${OWW_RELEASE}/${asset}`, dest, `OWW ${id}`);
  return dest;
}

export async function ensureWhisperModel(modelsDir: string, id: string): Promise<string> {
  // Normalize legacy "ggml-base.en" / "ggml-base.en.bin" → "base.en"
  let normalized = id;
  if (normalized.endsWith(".bin")) normalized = normalized.slice(0, -4);
  if (normalized.startsWith("ggml-")) normalized = normalized.slice(5);
  if (!isKnownWhisperModel(normalized)) {
    throw new Error(`Unknown Whisper model: ${id}`);
  }
  const dest = whisperModelPath(modelsDir, normalized);
  await ensureFile(`${WHISPER_HF}/ggml-${normalized}.bin`, dest, `Whisper ${normalized}`);
  return dest;
}

export async function ensurePiperModel(modelsDir: string, id: string): Promise<string> {
  if (!isKnownPiperModel(id)) {
    throw new Error(`Unknown Piper model: ${id}`);
  }
  const hfPath = PIPER_PATHS[id];
  if (!hfPath) throw new Error(`No download path for Piper model: ${id}`);
  const onnx = piperModelPath(modelsDir, id);
  const json = piperConfigPath(modelsDir, id);
  await ensureFile(`${PIPER_HF}/${hfPath}.onnx`, onnx, `Piper ${id}`);
  await ensureFile(`${PIPER_HF}/${hfPath}.onnx.json`, json, `Piper ${id} config`);
  return onnx;
}

export interface EnsureVoiceModelsResult {
  wakeWordPath: string;
  whisperPath: string;
  piperPath: string;
  status: ModelInstallStatus;
}

export async function ensureVoiceModels(
  modelsDir: string,
  ids: { wakeWord: string; whisper: string; piper: string },
): Promise<EnsureVoiceModelsResult> {
  mkdirSync(modelsDir, { recursive: true });
  const wakeWordPath = await ensureWakeWordModel(modelsDir, ids.wakeWord);
  const whisperPath = await ensureWhisperModel(modelsDir, ids.whisper);
  const piperPath = await ensurePiperModel(modelsDir, ids.piper);
  return {
    wakeWordPath,
    whisperPath,
    piperPath,
    status: getModelInstallStatus(modelsDir, ids),
  };
}

export function modelCatalogPayload(modelsDir?: string): {
  wakeWord: ModelOption[];
  whisper: ModelOption[];
  piper: ModelOption[];
} {
  const withReady = (
    options: ModelOption[],
    readyFn: (id: string) => boolean,
  ): ModelOption[] =>
    options.map((o) => ({
      ...o,
      ready: modelsDir ? readyFn(o.id) : undefined,
    }));

  return {
    wakeWord: withReady(WAKE_WORD_OPTIONS, (id) => {
      if (!modelsDir) return false;
      const shared = ["melspectrogram.onnx", "embedding_model.onnx"].every((f) =>
        existsSync(join(modelsDir, f)),
      );
      return shared && existsSync(wakeWordModelPath(modelsDir, id));
    }),
    whisper: withReady(WHISPER_MODEL_OPTIONS, (id) =>
      modelsDir ? existsSync(whisperModelPath(modelsDir, id)) : false,
    ),
    piper: withReady(PIPER_MODEL_OPTIONS, (id) =>
      modelsDir
        ? existsSync(piperModelPath(modelsDir, id)) &&
          existsSync(piperConfigPath(modelsDir, id))
        : false,
    ),
  };
}
