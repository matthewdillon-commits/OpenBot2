import { mutationOptions, type QueryClient } from "@tanstack/react-query";
import { client } from "@/lib/client";
import {
  type JobTriggerKind,
  type JobTriggerRecord,
  triggerKeys,
} from "./queries";

export type JobTriggerInput = {
  kind: JobTriggerKind;
  channelId: string;
  goalId?: string;
  prompt?: string;
  everySeconds?: number;
  mailbox?: string;
};

export type CreatedJobTrigger = {
  trigger: JobTriggerRecord;
  secret?: string;
};

const FALLBACK = "Could not save that standing start";

function invalidateTriggers(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: triggerKeys.all });
}

export function createTriggerMutationOptions(queryClient: QueryClient) {
  return mutationOptions({
    mutationFn: async (input: JobTriggerInput): Promise<CreatedJobTrigger> => {
      const response = await client("/api/job-triggers", {
        method: "POST",
        body: {
          kind: input.kind,
          channelId: input.channelId,
          goalId: input.goalId ?? input.channelId,
          ...(input.prompt ? { prompt: input.prompt } : {}),
          ...(input.everySeconds ? { everySeconds: input.everySeconds } : {}),
          ...(input.mailbox ? { mailbox: input.mailbox } : {}),
        },
        fallback: FALLBACK,
      });
      return (await response.json()) as CreatedJobTrigger;
    },
    onSuccess: () => invalidateTriggers(queryClient),
  });
}

export function setTriggerEnabledMutationOptions(queryClient: QueryClient) {
  return mutationOptions({
    mutationFn: (variables: {
      triggerId: string;
      enabled: boolean;
    }): Promise<JobTriggerRecord> =>
      client(`/api/job-triggers/${variables.triggerId}`, "trigger", {
        method: "PATCH",
        body: { enabled: variables.enabled },
        fallback: FALLBACK,
      }),
    onSuccess: () => invalidateTriggers(queryClient),
  });
}

export function deleteTriggerMutationOptions(queryClient: QueryClient) {
  return mutationOptions({
    mutationFn: (triggerId: string): Promise<void> =>
      client(`/api/job-triggers/${triggerId}`, {
        method: "DELETE",
        fallback: FALLBACK,
      }).then(() => undefined),
    onSuccess: () => invalidateTriggers(queryClient),
  });
}
