import { test, expect } from "bun:test";
import { canUseTool, refusalMessage } from "../src/index";

test("public tools always allowed", () => {
  expect(
    canUseTool({ kind: "discord", id: "1", allowSensitive: false }, "public"),
  ).toBe(true);
});

test("sensitive tools require allowSensitive", () => {
  expect(
    canUseTool({ kind: "discord", id: "1", allowSensitive: false }, "sensitive"),
  ).toBe(false);
  expect(
    canUseTool({ kind: "discord", id: "1", allowSensitive: true }, "sensitive"),
  ).toBe(true);
  expect(
    canUseTool({ kind: "web", id: "1", allowSensitive: true }, "sensitive"),
  ).toBe(true);
  expect(
    canUseTool({ kind: "voice", id: "local", allowSensitive: true }, "sensitive"),
  ).toBe(true);
});

test("refusal message mentions Discord allowlist", () => {
  expect(refusalMessage("shell")).toContain("shell");
  expect(refusalMessage("shell")).toContain("Discord");
});
