import { mutationOptions, type QueryClient } from "@tanstack/react-query";
import { client } from "@/lib/client";
import { channelKeys } from "@/lib/channels/queries";
import { jobKeys, type UnattendedJobRecord } from "./queries";

export type EnqueueJobInput = {
  channelId: string;
  prompt: string;
  agentId?: string;
  skillInstructions?: string[];
};

const FALLBACK = "Could not continue this channel after you leave";

function invalidateJobs(queryClient: QueryClient) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: jobKeys.all }),
    queryClient.invalidateQueries({ queryKey: channelKeys.all }),
  ]);
}

export function enqueueJobMutationOptions(queryClient: QueryClient) {
  return mutationOptions({
    mutationFn: (input: EnqueueJobInput): Promise<UnattendedJobRecord> =>
      client("/api/jobs", "job", {
        method: "POST",
        body: input,
        fallback: FALLBACK,
      }),
    onSuccess: () => invalidateJobs(queryClient),
  });
}
