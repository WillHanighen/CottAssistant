import { test, expect } from "bun:test";
import {
  buildMultimodalUserContent,
  historyNoteForImages,
  isImageMime,
  toDataUrl,
} from "./images";

test("isImageMime accepts common types", () => {
  expect(isImageMime("image/png")).toBe(true);
  expect(isImageMime("image/jpeg; charset=binary")).toBe(true);
  expect(isImageMime("application/pdf")).toBe(false);
});

test("buildMultimodalUserContent adds image parts", () => {
  const content = buildMultimodalUserContent("what is this?", [
    { mimeType: "image/png", base64: "abc", name: "a.png" },
  ]);
  expect(Array.isArray(content)).toBe(true);
  if (!Array.isArray(content)) return;
  expect(content[0]?.type).toBe("text");
  expect(content[1]?.type).toBe("image_url");
  expect(content[1]?.image_url?.url).toBe(toDataUrl({ mimeType: "image/png", base64: "abc" }));
});

test("historyNoteForImages annotates attachments", () => {
  expect(historyNoteForImages("hi", [{ mimeType: "image/png", base64: "x", name: "shot.png" }])).toContain(
    "shot.png",
  );
  expect(historyNoteForImages("", [{ mimeType: "image/png", base64: "x" }])).toContain("attached image");
});
