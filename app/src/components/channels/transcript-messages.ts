import type { Message } from "@ag-ui/core";
import type { ChannelPostedMessage } from "@/lib/channels/queries";

/**
 * What a transcript shows while a brand-new channel is still joining.
 *
 * Channel join replaces the agent's local messages with restored thread history. The first message
 * is held here as a seed until restored messages arrive, then ignored to avoid duplicate rendering.
 *
 * Bot-posted channel messages are merged by time, not appended. A coworker that speaks in the
 * middle of a conversation has to appear there, not after later human turns. Intelligence
 * messages may carry `createdAt` or `timestamp`; posted rows always have `createdAt`. A thread
 * message with no clock keeps its place among other thread messages and sorts before a posted
 * message only when that posted message also has no readable time.
 */
export function transcriptMessages(
  messages: readonly Message[],
  seed: Message | null,
  posted: readonly ChannelPostedMessage[] = [],
): readonly Message[] {
  const base = messages.length > 0 || seed === null ? [...messages] : [seed];
  const seen = new Set(base.map((message) => message.id));

  const extras = posted
    .filter((row) => !seen.has(row.id))
    .map((row) => ({
      at: Date.parse(row.createdAt),
      message: postedToMessage(row),
    }))
    .sort((left, right) =>
      left.at !== right.at
        ? left.at - right.at
        : left.message.id.localeCompare(right.message.id),
    );

  if (extras.length === 0) return base;

  const merged = [...base];
  for (const extra of extras) {
    let insertAt = merged.length;
    if (Number.isFinite(extra.at)) {
      const later = merged.findIndex((message) => {
        const at = timeOf(message);
        return at != null && at > extra.at;
      });
      if (later !== -1) insertAt = later;
    }
    merged.splice(insertAt, 0, extra.message);
  }
  return merged;
}

function postedToMessage(row: ChannelPostedMessage): Message {
  return {
    id: row.id,
    role: "assistant",
    content: row.body,
    ...(row.senderName ? { name: row.senderName } : {}),
    createdAt: row.createdAt,
  } as Message;
}

/**
 * When this message was said, if the runtime or the channel store recorded it.
 *
 * AG-UI's `Message` type does not name a clock. CopilotKit and this app still put one on
 * some rows (`createdAt` as ISO-8601, or `timestamp` as epoch milliseconds). A missing clock
 * is null, not "now": inventing a time would shove restored history after every Bot post.
 */
function timeOf(message: Message): number | null {
  const record = message as Message & {
    createdAt?: unknown;
    timestamp?: unknown;
  };
  return parseTime(record.createdAt) ?? parseTime(record.timestamp);
}

function parseTime(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 1e12 ? value * 1000 : value;
  }
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isNaN(ms) ? null : ms;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? null : ms;
  }
  return null;
}

/** The person's message, in the shape the transcript and the agent both take. */
export function seedMessage(text: string, id: string): Message {
  return { id, role: "user", content: text };
}

/**
 * The message a channel was created by, waiting for the screen that will send it.
 *
 * A module-level map rather than router state because `HistoryState` is an empty interface and
 * typing a value into it means augmenting `@tanstack/history`, which is not a dependency of this
 * app. It also earns something router state would not give: taking is destructive, so a component
 * that mounts twice cannot send the same message twice.
 *
 * Deliberately not persisted. A reload finds nothing here, which is correct, by then the message
 * is in the thread and arrives through the normal replay.
 */
export type StashedFirstMessage = {
  text: string;
  /** Who should answer, when the first message named a member. */
  agentId: string | null;
};

const firstMessages = new Map<string, StashedFirstMessage>();

export function stashFirstMessage(
  channelId: string,
  text: string,
  agentId: string | null = null,
): void {
  firstMessages.set(channelId, { text, agentId });
}

/** Read the pending first message and forget it. Null for a channel opened any other way. */
export function takeFirstMessage(
  channelId: string,
): StashedFirstMessage | null {
  const pending = firstMessages.get(channelId) ?? null;
  firstMessages.delete(channelId);
  return pending;
}
