import { mutationOptions, type QueryClient } from "@tanstack/react-query";
import { client, tryClient } from "@/lib/client";
import { type AgentChannel, channelKeys } from "./queries";

export type CreateChannelInput = {
  agentIds: string[];
  /** Owner-facing goal name. Plain language, not a coworker name. */
  name?: string;
};

/**
 * Start a new goal (channel + Intelligence thread) with the orchestrator as lead.
 *
 * Deliberately not idempotent: every call creates a channel with its own thread.
 */
export function createChannelMutationOptions(queryClient: QueryClient) {
  return mutationOptions({
    mutationFn: async (input: CreateChannelInput): Promise<AgentChannel> => {
      const response = await client("/api/channels", {
        method: "POST",
        body: {
          agentIds: input.agentIds,
          ...(input.name ? { name: input.name } : {}),
        },
        fallback: "Could not start a goal",
      });
      return ((await response.json()) as { channel: AgentChannel }).channel;
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: channelKeys.all }),
  });
}

/**
 * Report the last thing said in a channel.
 *
 * The client that ran the agent already has the message before platform replay can return it; the
 * runtime exposes no run-completion hook and its run endpoint returns before the reply exists.
 *
 * Fire-and-forget on purpose: a failed preview update is a stale roster line, not a lost message.
 */
export function recordChannelActivityMutationOptions() {
  return mutationOptions({
    mutationFn: async (variables: {
      channelId: string;
      text: string;
      agentId: string | null;
      at: string;
    }) => {
      /* Still fire-and-forget: `tryClient` does not throw, and the result is not read. */
      await tryClient(`/api/channels/${variables.channelId}/activity`, {
        method: "POST",
        body: {
          agentId: variables.agentId,
          at: variables.at,
          text: variables.text,
        },
      });
    },
  });
}
