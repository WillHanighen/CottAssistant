import { test, expect } from "bun:test";
import { whisperModelPath, wakeWordModelPath, piperModelPath } from "./model-installer";

test("whisperModelPath normalizes ids", () => {
  expect(whisperModelPath("/m", "base.en")).toBe("/m/ggml-base.en.bin");
  expect(whisperModelPath("/m", "ggml-base.en")).toBe("/m/ggml-base.en.bin");
  expect(whisperModelPath("/m", "ggml-base.en.bin")).toBe("/m/ggml-base.en.bin");
});

test("wake and piper paths", () => {
  expect(wakeWordModelPath("/m", "hey_jarvis")).toBe("/m/hey_jarvis.onnx");
  expect(piperModelPath("/m", "en_US-lessac-medium")).toBe("/m/en_US-lessac-medium.onnx");
});
