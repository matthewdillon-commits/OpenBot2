import { HttpAgent } from "@ag-ui/client";
import type { AgentActor } from "../agents/profile-types";
import type { AgentProfileStore } from "../agents/profile-store";
import { standingRoleMessage } from "../copilot";
import type { ChannelMessageStore, ChannelPostedMessage } from "./messages";
import type { MessagingGateway } from "./messaging";

export type WakeJob = {
  channelId: string;
  botId: string;
  actor: AgentActor;
  inbound: ChannelPostedMessage;
};

export type WakeQueue = {
  enqueue(job: WakeJob): void;
  /** True while this Bot is answering a message it was just sent. */
  isRunning(botId: string): boolean;
};

export type WakeRunner = (job: WakeJob) => Promise<string | null>;

/**
 * Run a recipient later, without holding the sender's tool call open.
 *
 * The product is texting, not a conference call: the sender has already been told the message
 * landed. This queue is in-process on purpose. A second server instance will not see jobs this
 * one accepted; a deployment that needs that is a later change. What must not happen is the
 * sender waiting, or two overlapping wakes of the same Bot in the same channel.
 */
export function createWakeQueue(run: WakeRunner): WakeQueue {
  const inflight = new Set<string>();

  const keyFor = (job: WakeJob) => `${job.channelId}:${job.botId}`;

  return {
    enqueue(job) {
      const key = keyFor(job);
      if (inflight.has(key)) return;
      inflight.add(key);
      void Promise.resolve()
        .then(() => run(job))
        .catch((error) => {
          console.error(
            JSON.stringify({
              type: "channel-wake-failed",
              channelId: job.channelId,
              botId: job.botId,
              error: error instanceof Error ? error.message : String(error),
            }),
          );
        })
        .finally(() => {
          inflight.delete(key);
        });
    },
    isRunning(botId) {
      for (const key of inflight) {
        if (key.endsWith(`:${botId}`)) return true;
      }
      return false;
    },
  };
}

export function createAgentWakeRunner(options: {
  profiles: AgentProfileStore;
  messages: ChannelMessageStore;
  messaging: () => MessagingGateway;
}): WakeRunner {
  const { profiles, messages, messaging } = options;

  return async (job) => {
    const profile = await profiles.get(job.actor, job.botId);
    if (!profile || profile.deletedAt) return null;

    const recent = await messages.list(job.actor, job.channelId);
    const reply = await runRecipient({
      botId: job.botId,
      name: profile.name,
      title: profile.title,
      roleDescription: profile.roleDescription,
      endpoint: profile.endpoint,
      inbound: job.inbound,
      recent,
    });
    if (!reply) return null;

    await messaging().postWakeReply({
      botId: job.botId,
      actor: job.actor,
      channelId: job.channelId,
      text: reply,
      hop: job.inbound.hop + 1,
    });
    return reply;
  };
}

async function runRecipient(input: {
  botId: string;
  name: string;
  title: string;
  roleDescription: string;
  endpoint: string | null;
  inbound: ChannelPostedMessage;
  recent: ChannelPostedMessage[];
}): Promise<string | null> {
  if (!input.endpoint) return null;

  const standing = standingRoleMessage({
    id: input.botId,
    name: input.name,
    title: input.title,
    roleDescription: input.roleDescription,
  });

  const history = input.recent
    .filter((message) => message.id !== input.inbound.id)
    .slice(-12)
    .map((message) => ({
      id: message.id,
      role: "assistant" as const,
      name: message.senderName ?? undefined,
      content: message.body,
    }));

  const agent = new HttpAgent({
    url: input.endpoint,
    agentId: input.botId,
  });
  agent.setMessages([
    standing,
    {
      id: `wake-brief:${input.inbound.id}`,
      role: "system",
      content: [
        `You received a message in this channel from ${input.inbound.senderName ?? "a coworker"}:`,
        "",
        input.inbound.body,
        "",
        "Reply only if you have a finding, an answer, or a question they can act on.",
        "If you would only acknowledge — thanks, got it, okay, will do — say nothing at all.",
        "Do not call tools. Answer in words, or stay silent.",
      ].join("\n"),
    },
    ...history,
    {
      id: input.inbound.id,
      role: "user",
      content: input.inbound.body,
    },
  ]);

  try {
    await agent.runAgent();
  } catch (error) {
    console.error(
      JSON.stringify({
        type: "channel-wake-run-failed",
        botId: input.botId,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return null;
  }

  const last = [...agent.messages]
    .reverse()
    .find((message) => message.role === "assistant");
  const content = typeof last?.content === "string" ? last.content : "";
  return content.trim() ? content : null;
}
