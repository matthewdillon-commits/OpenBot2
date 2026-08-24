import { describe, expect, test } from "bun:test";
import type { Message } from "@ag-ui/core";
import {
  toVisibleChatItems,
  type VisibleChatItem,
  waitingForAnswer,
} from "./chat-messages";

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

describe("waitingForAnswer", () => {
  const user: VisibleChatItem = {
    kind: "text",
    id: "u1",
    role: "user",
    text: "find a broker",
  };
  const search: VisibleChatItem = {
    kind: "tool",
    id: "t1",
    toolCall: {
      id: "t1",
      type: "function",
      function: { name: "search_web", arguments: '{"query":"broker"}' },
    },
  };
  const reply: VisibleChatItem = {
    kind: "text",
    id: "a1",
    role: "assistant",
    text: "Here is one.",
  };

  test("is false when the turn is not in flight", () => {
    expect(waitingForAnswer([user], false)).toBe(false);
  });

  test("is true after send, before anything else lands", () => {
    expect(waitingForAnswer([user], true)).toBe(true);
  });

  test("stays true while a tool is running and the Bot has not written", () => {
    expect(waitingForAnswer([user, search], true)).toBe(true);
  });

  test("is false once the Bot has started writing", () => {
    expect(waitingForAnswer([user, search, reply], true)).toBe(false);
  });

  test("ignores an earlier reply when a new user turn is waiting", () => {
    expect(waitingForAnswer([user, reply, user, search], true)).toBe(true);
  });
});
