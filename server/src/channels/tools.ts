import { z } from "zod";
import type { AgentActor } from "../agents/profile-types";
import type { GrantedTool } from "../plugins/tools";
import {
  MESSAGE_AGENT_TOOL,
  MESSAGE_CHANNEL_TOOL,
  type MessagingGateway,
} from "./messaging";

const agentParameters = z.object({
  agent_id: z
    .string()
    .describe("The coworker to message, by their id."),
  text: z
    .string()
    .describe(
      "What to send. A question, a finding, or a request. Never an acknowledgement.",
    ),
});

const channelParameters = z.object({
  channel_id: z
    .string()
    .describe("The channel to post in. This Bot must already be a member."),
  text: z
    .string()
    .describe(
      "What to post. Visible to every member. Never an acknowledgement.",
    ),
});

/**
 * The two tools a Bot uses to talk to another Bot.
 *
 * Offered to every Bot the way web search is: no per-Bot grant, because membership is the
 * control. A Bot that is not in a channel cannot post there, and a Bot that cannot see a
 * coworker cannot open a DM with them. The gateway still decides and records every send.
 */
export function messagingTools(options: {
  messaging: MessagingGateway;
  botId: string;
  actor: AgentActor;
}): GrantedTool[] {
  const { messaging, botId, actor } = options;

  return [
    {
      name: MESSAGE_AGENT_TOOL,
      description:
        "Send a message to another coworker. They will see it and may reply later — do not wait. " +
        "Use this when you have a real question, a finding, or a decision they need to make. " +
        "Never send thanks, okay, got it, will do, or any message that only confirms receipt. " +
        "If you have nothing to add, do not call this tool.",
      parameters: agentParameters,
      execute: async (args: unknown) => {
        const parsed = agentParameters.safeParse(args);
        if (!parsed.success) {
          return "That send needs agent_id and text.";
        }
        return messaging.messageAgent({
          botId,
          actor,
          recipientAgentId: parsed.data.agent_id.trim(),
          text: parsed.data.text,
        });
      },
    },
    {
      name: MESSAGE_CHANNEL_TOOL,
      description:
        "Post a message in a channel this Bot already belongs to. Every member will see it. " +
        "They may reply later — do not wait. Use this for a finding or a question the room " +
        "should have. Never post an acknowledgement.",
      parameters: channelParameters,
      execute: async (args: unknown) => {
        const parsed = channelParameters.safeParse(args);
        if (!parsed.success) {
          return "That post needs channel_id and text.";
        }
        return messaging.messageChannel({
          botId,
          actor,
          channelId: parsed.data.channel_id.trim(),
          text: parsed.data.text,
        });
      },
    },
  ];
}
