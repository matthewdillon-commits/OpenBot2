import type { AgentActor } from "../agents/profile-types";
import { type AuditStore, recordAuditEvent } from "../audit";
import {
  type ActionPolicy,
  evaluateActionPolicy,
  type PolicyContext,
  type PolicyDecision,
} from "../computer/policy";
import { REFUSAL_MARKER } from "../plugins/tools";
import { isEmptyOrAck, MAX_MESSAGE_HOP } from "./ack";
import type { ChannelMessageStore, ChannelPostedMessage } from "./messages";
import type { AgentChannel, ChannelStore } from "./routes";
import type { WakeQueue } from "./wake";

export const MESSAGE_AGENT_TOOL = "message_agent";
export const MESSAGE_CHANNEL_TOOL = "message_channel";

export type MessagingGateway = {
  messageAgent(input: {
    botId: string;
    actor: AgentActor;
    recipientAgentId: string;
    text: string;
  }): Promise<string>;
  messageChannel(input: {
    botId: string;
    actor: AgentActor;
    channelId: string;
    text: string;
  }): Promise<string>;
  postWakeReply(input: {
    botId: string;
    actor: AgentActor;
    channelId: string;
    text: string;
    hop: number;
  }): Promise<ChannelPostedMessage | null>;
};

export function createMessagingGateway(options: {
  channels: ChannelStore;
  messages: ChannelMessageStore;
  auditStore: AuditStore;
  policy: () => ActionPolicy | undefined;
  wake: WakeQueue;
}): MessagingGateway {
  const { channels, messages, auditStore, policy, wake } = options;

  const decide = async (input: {
    botId: string;
    actor: AgentActor;
    tool: typeof MESSAGE_AGENT_TOOL | typeof MESSAGE_CHANNEL_TOOL;
    text: string;
    hop: number;
    channelId: string;
    recipientAgentId: string | null;
  }): Promise<
    | { ok: false; refused: string }
    | { ok: true; text: string; verdict: PolicyDecision }
  > => {
    const trimmed = input.text.trim();
    if (isEmptyOrAck(trimmed)) {
      return {
        ok: false,
        refused: `${REFUSAL_MARKER} Empty acknowledgements are not delivered. Send a question, a finding, or nothing.`,
      };
    }
    if (input.hop > MAX_MESSAGE_HOP) {
      return {
        ok: false,
        refused: `${REFUSAL_MARKER} That conversation has gone far enough without a person.`,
      };
    }

    const verdict = evaluateActionPolicy(
      policy(),
      policyContext({
        tool: input.tool,
        botId: input.botId,
        actorId: input.actor.id,
        channelId: input.channelId,
        recipientAgentId: input.recipientAgentId,
      }),
    );

    await writeAudit(auditStore, {
      actor: input.actor,
      botId: input.botId,
      channelId: input.channelId,
      recipientAgentId: input.recipientAgentId,
      tool: input.tool,
      hop: input.hop,
      text: trimmed,
      verdict,
    });

    if (!verdict.forward) {
      return { ok: false, refused: `${REFUSAL_MARKER} ${verdict.reason}` };
    }
    return { ok: true, text: trimmed, verdict };
  };

  const deliver = async (input: {
    botId: string;
    actor: AgentActor;
    tool: typeof MESSAGE_AGENT_TOOL | typeof MESSAGE_CHANNEL_TOOL;
    text: string;
    hop: number;
    channel: AgentChannel;
    recipientAgentId: string | null;
    wakeAgentIds: string[];
  }): Promise<ChannelPostedMessage> => {
    const posted = await messages.post({
      channelId: input.channel.id,
      senderAgentId: input.botId,
      body: input.text,
      hop: input.hop,
    });

    await channels.recordActivity(input.actor, input.channel.id, {
      text: input.text,
      agentId: input.botId,
      at: posted.createdAt,
    });

    if (input.hop < MAX_MESSAGE_HOP) {
      for (const agentId of input.wakeAgentIds) {
        wake.enqueue({
          channelId: input.channel.id,
          botId: agentId,
          actor: input.actor,
          inbound: posted,
        });
      }
    }

    return posted;
  };

  const sentCopy = (
    tool: typeof MESSAGE_AGENT_TOOL | typeof MESSAGE_CHANNEL_TOOL,
    name: string,
  ) =>
    tool === MESSAGE_AGENT_TOOL
      ? `Sent to the other coworker in ${name}. They will see it and may reply later; do not wait.`
      : `Posted in ${name}. Members will see it and may reply later; do not wait.`;

  return {
    async messageAgent(input) {
      if (input.botId === input.recipientAgentId) {
        return `${REFUSAL_MARKER} A Bot cannot message itself.`;
      }
      if (wake.isRunning(input.botId)) {
        return `${REFUSAL_MARKER} A Bot that is answering a message cannot start another send.`;
      }

      const existing = await channels.findDirect(
        input.actor,
        input.botId,
        input.recipientAgentId,
      );

      const decided = await decide({
        botId: input.botId,
        actor: input.actor,
        tool: MESSAGE_AGENT_TOOL,
        text: input.text,
        hop: 1,
        channelId: existing?.id ?? "",
        recipientAgentId: input.recipientAgentId,
      });
      if (!decided.ok) return decided.refused;

      let channel = existing;
      if (!channel) {
        try {
          channel = await channels.findOrCreateDirect(
            input.actor,
            input.botId,
            input.recipientAgentId,
          );
        } catch (error) {
          return `${REFUSAL_MARKER} ${error instanceof Error ? error.message : "That coworker could not be reached."}`;
        }
      }

      await deliver({
        botId: input.botId,
        actor: input.actor,
        tool: MESSAGE_AGENT_TOOL,
        text: decided.text,
        hop: 1,
        channel,
        recipientAgentId: input.recipientAgentId,
        wakeAgentIds: [input.recipientAgentId],
      });
      return sentCopy(MESSAGE_AGENT_TOOL, channel.name);
    },

    async messageChannel(input) {
      if (wake.isRunning(input.botId)) {
        return `${REFUSAL_MARKER} A Bot that is answering a message cannot start another send.`;
      }
      const channel = await channels.get(input.actor, input.channelId);
      if (!channel) {
        return `${REFUSAL_MARKER} Channel not found.`;
      }
      if (!channel.agentIds.includes(input.botId)) {
        return `${REFUSAL_MARKER} This Bot is not a member of that channel.`;
      }
      if (!channel.active) {
        return `${REFUSAL_MARKER} That channel can no longer accept messages.`;
      }

      const decided = await decide({
        botId: input.botId,
        actor: input.actor,
        tool: MESSAGE_CHANNEL_TOOL,
        text: input.text,
        hop: 1,
        channelId: channel.id,
        recipientAgentId: null,
      });
      if (!decided.ok) return decided.refused;

      await deliver({
        botId: input.botId,
        actor: input.actor,
        tool: MESSAGE_CHANNEL_TOOL,
        text: decided.text,
        hop: 1,
        channel,
        recipientAgentId: null,
        wakeAgentIds: channel.agentIds.filter((id) => id !== input.botId),
      });
      return sentCopy(MESSAGE_CHANNEL_TOOL, channel.name);
    },

    async postWakeReply(input) {
      const trimmed = input.text.trim();
      if (isEmptyOrAck(trimmed)) return null;

      const channel = await channels.get(input.actor, input.channelId);
      if (!channel?.agentIds.includes(input.botId)) return null;
      if (!channel.active) return null;

      const decided = await decide({
        botId: input.botId,
        actor: input.actor,
        tool: MESSAGE_CHANNEL_TOOL,
        text: trimmed,
        hop: input.hop,
        channelId: channel.id,
        recipientAgentId: null,
      });
      if (!decided.ok) return null;

      return deliver({
        botId: input.botId,
        actor: input.actor,
        tool: MESSAGE_CHANNEL_TOOL,
        text: decided.text,
        hop: input.hop,
        channel,
        recipientAgentId: null,
        wakeAgentIds: channel.agentIds.filter((id) => id !== input.botId),
      });
    },
  };
}

function policyContext(input: {
  tool: string;
  botId: string;
  actorId: string;
  channelId: string;
  recipientAgentId: string | null;
}): PolicyContext {
  return {
    tool: { name: input.tool },
    bot: { id: input.botId },
    actor: { id: input.actorId },
    page: { url: "", host: "" },
    element: { ref: "", role: "", name: "", type: "" },
    key: "",
    file: { path: "", name: "", extension: "" },
    command: "",
    intent: "message",
    channel: { id: input.channelId },
    recipient: { id: input.recipientAgentId ?? "" },
  };
}

async function writeAudit(
  auditStore: AuditStore,
  entry: {
    actor: AgentActor;
    botId: string;
    channelId: string;
    recipientAgentId: string | null;
    tool: string;
    hop: number;
    text: string;
    verdict: PolicyDecision;
  },
) {
  await recordAuditEvent(auditStore, {
    eventType: entry.verdict.forward
      ? "channel.message_sent"
      : "channel.message_refused",
    targetType: "channel",
    targetId: entry.channelId || entry.botId,
    actorUserId: entry.actor.id,
    payload: {
      bot: entry.botId,
      actor: entry.actor.id,
      tool: entry.tool,
      hop: entry.hop,
      recipient: entry.recipientAgentId,
      text: entry.text,
      decision: {
        allowed: entry.verdict.allowed,
        mode: entry.verdict.mode,
        source: entry.verdict.source,
        rule: entry.verdict.matched,
        carriedOut: entry.verdict.forward,
      },
    },
  });
}
