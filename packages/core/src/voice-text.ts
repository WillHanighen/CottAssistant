/** Strip markdown / formatting so Piper can speak cleanly. */
export function stripMarkdownForSpeech(text: string): string {
  let s = text.trim();
  // code fences
  s = s.replace(/```[\s\S]*?```/g, " ");
  s = s.replace(/`([^`]+)`/g, "$1");
  // links / images
  s = s.replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1");
  s = s.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  // headings / emphasis / strike
  s = s.replace(/^#{1,6}\s+/gm, "");
  s = s.replace(/(\*\*|__)(.*?)\1/g, "$2");
  s = s.replace(/(\*|_)(.*?)\1/g, "$2");
  s = s.replace(/~~(.*?)~~/g, "$1");
  // list markers
  s = s.replace(/^\s*[-*+]\s+/gm, "");
  s = s.replace(/^\s*\d+\.\s+/gm, "");
  // leftover markup noise
  s = s.replace(/[*_#>`]+/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

/**
 * Heuristic: spoken reply is waiting on the user (clarifying question).
 * Used as a safety net when the model forgets request_voice_followup.
 */
export function looksLikeVoiceFollowupQuestion(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/\?\s*$/.test(t)) return true;
  if (/\?\s/.test(t) && t.length < 280) return true;
  return /\b(could you|can you|would you|which one|which|what about|did you mean|tell me|please (say|confirm|clarify|repeat)|how many|what is|what's)\b/i.test(
    t,
  );
}
