import { describe, expect, test } from "bun:test";
import {
  addRecipient,
  canSend,
  MAX_RECIPIENTS,
  removeRecipient,
} from "../src/components/channels/compose-state";

const KNOWLEDGE = { id: "knowledge", name: "Knowledge" };
const RISK = { id: "risk-analyst", name: "Risk Analyst" };
const GENERAL = { id: "general-assistant", name: "General Assistant" };

describe("addRecipient", () => {
  test("adds to an empty list", () => {
    expect(addRecipient([], KNOWLEDGE)).toEqual([KNOWLEDGE]);
  });

  test("appends a second coworker", () => {
    expect(addRecipient([KNOWLEDGE], RISK)).toEqual([KNOWLEDGE, RISK]);
  });

  test("adding the coworker already chosen is a no-op", () => {
    expect(addRecipient([KNOWLEDGE], KNOWLEDGE)).toEqual([KNOWLEDGE]);
  });

  test("drops the oldest once the cap is reached", () => {
    const filled = Array.from({ length: MAX_RECIPIENTS }, (_, index) => ({
      id: `agent-${index}`,
      name: `Agent ${index}`,
    }));
    const next = { id: "agent-new", name: "New" };
    const result = addRecipient(filled, next);
    expect(result).toHaveLength(MAX_RECIPIENTS);
    expect(result[0]?.id).toBe("agent-1");
    expect(result.at(-1)).toEqual(next);
  });
});

describe("removeRecipient", () => {
  test("removes by id", () => {
    expect(removeRecipient([KNOWLEDGE], "knowledge")).toEqual([]);
  });

  test("ignores an id that is not present", () => {
    expect(removeRecipient([KNOWLEDGE], "nobody")).toEqual([KNOWLEDGE]);
  });
});

describe("canSend", () => {
  test("needs at least one recipient and some text", () => {
    expect(canSend([KNOWLEDGE], "hello")).toBe(true);
  });

  test("allows more than one recipient", () => {
    expect(canSend([KNOWLEDGE, RISK, GENERAL], "hello")).toBe(true);
  });

  test("refuses with no recipient", () => {
    expect(canSend([], "hello")).toBe(false);
  });

  test("refuses whitespace-only text", () => {
    expect(canSend([KNOWLEDGE], "   ")).toBe(false);
  });

  test("cap is eight", () => {
    expect(MAX_RECIPIENTS).toBe(8);
  });
});
