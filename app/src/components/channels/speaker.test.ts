import { describe, expect, test } from "bun:test";
import { resolveSpeaker } from "./speaker";

const MEMBERS = ["knowledge", "risk-analyst", "general-assistant"] as const;

describe("resolveSpeaker", () => {
  test("a member mention wins", () => {
    expect(resolveSpeaker(MEMBERS, "risk-analyst", "knowledge")).toBe(
      "risk-analyst",
    );
  });

  test("a non-member mention is ignored", () => {
    expect(resolveSpeaker(MEMBERS, "stranger", "knowledge")).toBe("knowledge");
  });

  test("falls back to the last speaker when nobody is mentioned", () => {
    expect(resolveSpeaker(MEMBERS, null, "general-assistant")).toBe(
      "general-assistant",
    );
  });

  test("falls back to the lead when there is no last speaker", () => {
    expect(resolveSpeaker(MEMBERS, null, null)).toBe("knowledge");
  });

  test("ignores a last speaker who is no longer a member", () => {
    expect(resolveSpeaker(MEMBERS, null, "deleted")).toBe("knowledge");
  });
});
