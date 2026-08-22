import { describe, expect, test } from "bun:test";
import type { Message } from "@ag-ui/core";
import { toVisibleChatItems } from "./chat-messages";

describe("toVisibleChatItems", () => {
  test("keeps an assistant name", () => {
    const message = {
      id: "a1",
      role: "assistant",
      content: "The policy is thirty days.",
      name: "Risk Analyst",
    } as Message;

    expect(toVisibleChatItems([message])).toEqual([
      {
        kind: "text",
        id: "a1",
        role: "assistant",
        text: "The policy is thirty days.",
        name: "Risk Analyst",
      },
    ]);
  });

  test("omits a missing assistant name", () => {
    const message = {
      id: "a2",
      role: "assistant",
      content: "Hello.",
    } as Message;

    expect(toVisibleChatItems([message])).toEqual([
      {
        kind: "text",
        id: "a2",
        role: "assistant",
        text: "Hello.",
      },
    ]);
  });
});
