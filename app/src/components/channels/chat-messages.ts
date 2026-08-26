import type { Message, ToolCall } from "@ag-ui/core";

/**
 * Transcript projection that pairs assistant tool calls with later tool-result messages.
 */

export type VisibleChatItem =
  | {
      kind: "text";
      id: string;
      role: "user" | "assistant";
      text: string;
      /** Who said it, when the run stamped a coworker name on the assistant message. */
      name?: string;
    }
  | {
      kind: "tool";
      id: string;
      toolCall: ToolCall;
      /** The result, once there is one. Absent means the call is still in flight. */
      result?: string;
    };

/** A tool result, as it arrives, its own message, pointing back at the call it answers. */
type ToolResultMessage = { role: "tool"; toolCallId: string; content?: string };

function isToolResult(
  message: Readonly<Message>,
): message is Readonly<Message> & ToolResultMessage {
  return message.role === "tool" && "toolCallId" in message;
}

export function toVisibleChatItems(
  messages: ReadonlyArray<Readonly<Message>>,
  options?: { toolTraces?: boolean },
): VisibleChatItem[] {
  // Gather results first so calls render with their current completion state in the same pass.
  const results = new Map<string, string | undefined>();
  for (const message of messages) {
    if (isToolResult(message)) results.set(message.toolCallId, message.content);
  }
  const toolTraces = options?.toolTraces === true;

  return messages.flatMap((message): VisibleChatItem[] => {
    if (message.role === "assistant") {
      const items: VisibleChatItem[] = [];
      if (message.content) {
        const name = messageName(message);
        items.push({
          kind: "text",
          id: message.id,
          role: "assistant",
          text: message.content,
          ...(name ? { name } : {}),
        });
      }
      if (toolTraces) {
        for (const toolCall of message.toolCalls ?? []) {
          items.push({
            kind: "tool",
            // One assistant message can carry multiple tool calls.
            id: toolCall.id,
            toolCall,
            ...(results.has(toolCall.id)
              ? { result: results.get(toolCall.id) }
              : {}),
          });
        }
      }
      return items;
    }

    if (message.role !== "user") return [];

    const text =
      typeof message.content === "string"
        ? message.content
        : message.content
            .filter((part) => part.type === "text")
            .map((part) => part.text)
            .join("\n");

    return text ? [{ kind: "text", id: message.id, role: "user", text }] : [];
  });
}

/**
 * Whether the transcript should still say the Bot is working.
 *
 * A tool call is not an answer. The line used to hide as soon as `search_web` (or any other call)
 * landed, so a turn that spent its first seconds searching looked identical to one that had
 * silently failed — a Stop button and a tiny tool name, and nothing under the person's message.
 * Skip tools, and keep the line until the Bot has actually written something after the last thing
 * the person said.
 */
export function waitingForAnswer(
  items: readonly VisibleChatItem[],
  busy: boolean,
): boolean {
  if (!busy) return false;

  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (!item || item.kind === "tool") continue;
    if (item.role === "assistant") {
      return item.text.trim().length === 0;
    }
    return true;
  }

  return true;
}

function messageName(message: Readonly<Message>): string | undefined {
  if (!("name" in message)) return undefined;
  const name = message.name;
  return typeof name === "string" && name.trim().length > 0 ? name : undefined;
}
