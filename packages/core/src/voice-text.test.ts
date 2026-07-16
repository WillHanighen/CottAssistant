import { test, expect } from "bun:test";
import { stripMarkdownForSpeech, looksLikeVoiceFollowupQuestion } from "./voice-text";

test("stripMarkdownForSpeech removes common markdown", () => {
  expect(stripMarkdownForSpeech("**Hello** _world_")).toBe("Hello world");
  expect(stripMarkdownForSpeech("See [docs](https://x.test)")).toBe("See docs");
  expect(stripMarkdownForSpeech("# Title\n- one\n- two")).toBe("Title one two");
});

test("looksLikeVoiceFollowupQuestion detects questions", () => {
  expect(looksLikeVoiceFollowupQuestion("Which folder should I use?")).toBe(true);
  expect(looksLikeVoiceFollowupQuestion("Done.")).toBe(false);
  expect(looksLikeVoiceFollowupQuestion("Could you clarify the name")).toBe(true);
});
