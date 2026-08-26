import { describe, expect, test } from "bun:test";
import type { Message } from "@ag-ui/core";
import {
  toVisibleChatItems,
  type VisibleChatItem,
  waitingForAnswer,
} from "./chat-messages";

function traceMessages(): Message[] {
  return [
    {
      id: "a1",
      role: "assistant",
      content: "I looked that up.",
      toolCalls: [
        {
          id: "t-search",
          type: "function",
          function: {
            name: "crm_search",
            arguments: '{"query":"Casey"}',
          },
        },
        {
          id: "t-create",
          type: "function",
          function: {
            name: "crm_create",
            arguments: '{"kind":"person","name":"Casey"}',
          },
        },
        {
          id: "t-skill",
          type: "function",
          function: {
            name: "start_specialist",
            arguments: '{"skill":"missing"}',
          },
        },
      ],
    } as Message,
    {
      id: "r-search",
      role: "tool",
      toolCallId: "t-search",
      content: "Casey",
    } as Message,
    {
      id: "r-create",
      role: "tool",
      toolCallId: "t-create",
      content: "Added Casey",
    } as Message,
    {
      id: "r-skill",
      role: "tool",
      toolCallId: "t-skill",
      content: "Refused. There is no such skill in this organization.",
    } as Message,
  ];
}

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

  test("the owner thread omits raw tool traces and Blocked-skill dumps", () => {
    const items = toVisibleChatItems(traceMessages());
    expect(items.every((item) => item.kind !== "tool")).toBe(true);
    expect(JSON.stringify(items)).not.toContain("Search CRM");
    expect(JSON.stringify(items)).not.toContain("Add to CRM");
    expect(JSON.stringify(items)).not.toContain("Blocked");
    expect(JSON.stringify(items)).not.toContain(
      "There is no such skill in this organization",
    );
    expect(items).toEqual([
      {
        kind: "text",
        id: "a1",
        role: "assistant",
        text: "I looked that up.",
      },
    ]);
  });

  test("See the work still projects tool traces including a Blocked skill", () => {
    const items = toVisibleChatItems(traceMessages(), { toolTraces: true });
    const tools = items.filter((item) => item.kind === "tool");
    expect(tools).toHaveLength(3);
    expect(tools[0]?.kind === "tool" && tools[0].toolCall.function.name).toBe(
      "crm_search",
    );
    expect(tools[1]?.kind === "tool" && tools[1].toolCall.function.name).toBe(
      "crm_create",
    );
    expect(tools[2]?.kind === "tool" && tools[2].result).toContain(
      "There is no such skill in this organization",
    );
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
