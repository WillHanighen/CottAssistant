import type { ChatImage } from "@cottassistant/shared";

const IMAGE_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/webp",
]);

const EXT_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

export function isImageMime(mime: string | null | undefined): boolean {
  if (!mime) return false;
  const base = mime.split(";")[0]?.trim().toLowerCase() ?? "";
  return IMAGE_MIME.has(base);
}

export function mimeFromFilename(name: string): string | null {
  const ext = name.split(".").pop()?.toLowerCase();
  if (!ext) return null;
  return EXT_MIME[ext] ?? null;
}

export function toDataUrl(image: ChatImage): string {
  return `data:${image.mimeType};base64,${image.base64}`;
}

/** OpenAI / OpenRouter multimodal user content parts */
export function buildMultimodalUserContent(
  text: string,
  images: ChatImage[],
): string | Array<{ type: string; text?: string; image_url?: { url: string } }> {
  if (images.length === 0) return text;
  const parts: Array<{ type: string; text?: string; image_url?: { url: string } }> = [];
  if (text.trim()) {
    parts.push({ type: "text", text });
  } else {
    parts.push({ type: "text", text: "Please look at the attached image(s)." });
  }
  for (const img of images) {
    parts.push({
      type: "image_url",
      image_url: { url: toDataUrl(img) },
    });
  }
  return parts;
}

export function historyNoteForImages(text: string, images: ChatImage[]): string {
  if (images.length === 0) return text;
  const names = images.map((i) => i.name ?? "image").join(", ");
  const note = `[attached image${images.length > 1 ? "s" : ""}: ${names}]`;
  return text.trim() ? `${text}\n${note}` : note;
}

export async function fetchImageAsChatImage(
  url: string,
  name?: string,
  opts?: { maxBytes?: number; headers?: Record<string, string> },
): Promise<ChatImage> {
  const maxBytes = opts?.maxBytes ?? 8 * 1024 * 1024;
  const res = await fetch(url, {
    headers: opts?.headers,
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    throw new Error(`Failed to download image (${res.status}): ${url}`);
  }
  const mimeHeader = res.headers.get("content-type");
  let mime = mimeHeader?.split(";")[0]?.trim().toLowerCase() ?? "";
  if (!isImageMime(mime)) {
    mime = mimeFromFilename(name ?? url) ?? "";
  }
  if (!isImageMime(mime)) {
    throw new Error(`Unsupported or unknown image type: ${mime || "unknown"}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength > maxBytes) {
    throw new Error(`Image too large (${buf.byteLength} bytes, max ${maxBytes})`);
  }
  return {
    mimeType: mime === "image/jpg" ? "image/jpeg" : mime,
    base64: buf.toString("base64"),
    name: name ?? undefined,
  };
}
