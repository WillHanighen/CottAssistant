/** Curated voice model options shown in the WebUI dropdowns (catalog ≠ installed). */

export interface ModelOption {
  id: string;
  label: string;
  description?: string;
  /** Present when catalog is built against a models directory. */
  ready?: boolean;
}

export const WAKE_WORD_OPTIONS: ModelOption[] = [
  { id: "hey_jarvis", label: "Hey Jarvis", description: "hey jarvis" },
  { id: "alexa", label: "Alexa", description: "alexa" },
  { id: "hey_mycroft", label: "Hey Mycroft", description: "hey mycroft" },
  { id: "hey_rhasspy", label: "Hey Rhasspy", description: "hey rhasspy" },
  { id: "timer", label: "Timer", description: "timer (utility wake)" },
  { id: "weather", label: "Weather", description: "weather (utility wake)" },
];

/** Defaults assume ~8GB+ VRAM-capable hosts; lighter options remain selectable. */
export const WHISPER_MODEL_OPTIONS: ModelOption[] = [
  {
    id: "medium.en",
    label: "Medium English (~1.5 GB) — default",
    description: "Strong accuracy; fits 8GB+ VRAM comfortably",
  },
  {
    id: "large-v3-turbo",
    label: "Large v3 Turbo (~1.6 GB)",
    description: "Near large-v3 quality, faster",
  },
  {
    id: "large-v3",
    label: "Large v3 (~3.1 GB)",
    description: "Best accuracy; needs more VRAM/RAM",
  },
  { id: "small.en", label: "Small English (~466 MB)", description: "Good on lighter GPUs" },
  { id: "base.en", label: "Base English (~142 MB)", description: "Fast, lower accuracy" },
  { id: "tiny.en", label: "Tiny English (~75 MB)", description: "Fastest, least accurate" },
  { id: "medium", label: "Medium multilingual (~1.5 GB)" },
  { id: "small", label: "Small multilingual (~466 MB)" },
  { id: "base", label: "Base multilingual (~142 MB)" },
  { id: "tiny", label: "Tiny multilingual (~75 MB)" },
];

export const PIPER_MODEL_OPTIONS: ModelOption[] = [
  {
    id: "en_US-lessac-high",
    label: "US English — Lessac (high) — default",
    description: "Clearest Lessac voice",
  },
  {
    id: "en_US-lessac-medium",
    label: "US English — Lessac (medium)",
  },
  {
    id: "en_US-ryan-high",
    label: "US English — Ryan (high)",
  },
  {
    id: "en_US-ryan-medium",
    label: "US English — Ryan (medium)",
  },
  {
    id: "en_US-amy-medium",
    label: "US English — Amy (medium)",
  },
  {
    id: "en_US-joe-medium",
    label: "US English — Joe (medium)",
  },
  {
    id: "en_US-hfc_female-medium",
    label: "US English — HFC Female (medium)",
  },
  {
    id: "en_US-hfc_male-medium",
    label: "US English — HFC Male (medium)",
  },
  {
    id: "en_US-libritts-high",
    label: "US English — LibriTTS (high)",
  },
  {
    id: "en_US-ljspeech-high",
    label: "US English — LJ Speech (high)",
  },
  {
    id: "en_GB-cori-high",
    label: "British English — Cori (high)",
  },
  {
    id: "en_GB-cori-medium",
    label: "British English — Cori (medium)",
  },
  {
    id: "en_GB-alan-medium",
    label: "British English — Alan (medium)",
  },
  {
    id: "en_GB-alba-medium",
    label: "British English — Alba (medium)",
  },
  {
    id: "en_GB-northern_english_male-medium",
    label: "British English — Northern male (medium)",
  },
  {
    id: "en_GB-semaine-medium",
    label: "British English — Semaine (medium)",
  },
];

export const DEFAULT_WHISPER_MODEL = "medium.en";
export const DEFAULT_PIPER_MODEL = "en_US-lessac-high";
export const DEFAULT_WAKE_WORD_MODEL = "hey_jarvis";

export function isKnownWakeWord(id: string): boolean {
  return WAKE_WORD_OPTIONS.some((o) => o.id === id);
}

export function isKnownWhisperModel(id: string): boolean {
  return WHISPER_MODEL_OPTIONS.some((o) => o.id === id);
}

export function isKnownPiperModel(id: string): boolean {
  return PIPER_MODEL_OPTIONS.some((o) => o.id === id);
}
