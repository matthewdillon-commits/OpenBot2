import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { stashFirstMessage } from "@/components/channels/transcript-messages";
import { goalNameFromPrompt } from "../../../../shared/goal-name";
import { createChannelMutationOptions } from "./mutations";
import { channelKeys } from "./queries";

/**
 * Start a channel from a just-submitted first message, then navigate there.
 *
 * Ordering matters: create, seed the channel cache, stash the first message, then navigate. That
 * keeps the first message visible while the channel thread joins.
 */
export function useStartChannel() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const createChannel = useMutation(createChannelMutationOptions(queryClient));

  return {
    pending: createChannel.isPending,
    start: async (
      agentIds: string[],
      text: string,
      speakerId: string | null = null,
    ) => {
      const channel = await createChannel.mutateAsync({
        agentIds,
        name: goalNameFromPrompt(text),
      });
      queryClient.setQueryData(channelKeys.detail(channel.id), channel);
      stashFirstMessage(channel.id, text, speakerId);
      await navigate({
        params: { channelId: channel.id },
        replace: true,
        to: "/channel/$channelId",
      });
    },
  };
}
