import type { Message } from "@ag-ui/core";
import type { ChannelPostedMessage } from "@/lib/channels/queries";

/**
 * What a transcript shows while a brand-new channel is still joining.
 *
 * Channel join replaces the agent's local messages with restored thread history. The first message
 * is held here as a seed until restored messages arrive, then ignored to avoid duplicate rendering.
 */
export function transcriptMessages(
  messages: readonly Message[],
  seed: Message | null,
  posted: readonly ChannelPostedMessage[] = [],
): readonly Message[] {
  const base = messages.length > 0 || seed === null ? [...messages] : [seed];
  const seen = new Set(base.map((message) => message.id));
  const extra: Message[] = [];
  for (const message of posted) {
    if (seen.has(message.id)) continue;
    extra.push({
      id: message.id,
      role: "assistant",
      content: message.body,
      ...(message.senderName ? { name: message.senderName } : {}),
    });
  }
  return extra.length === 0 ? base : [...base, ...extra];
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
