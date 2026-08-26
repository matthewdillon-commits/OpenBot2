import { queryOptions } from "@tanstack/react-query";
import { client } from "@/lib/client";

export type JobTriggerKind = "cron" | "webhook" | "email";

/**
 * A standing wake as the browser sees it.
 *
 * The secret is never here. Create returns it once; later reads only say
 * `hasSecret`. Cron times are ISO strings the card formats.
 */
export type JobTriggerRecord = {
  id: string;
  orgId: string;
  kind: JobTriggerKind;
  channelId: string;
  goalId: string;
  threadId: string;
  coworkerId: string;
  actingUserId: string;
  prompt: string;
  enabled: boolean;
  everySeconds: number | null;
  nextRunAt: string | null;
  mailbox: string | null;
  hasSecret: boolean;
  lastEnqueuedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

export const triggerKeys = {
  all: ["job-triggers"] as const,
  list: (channelId: string) => ["job-triggers", "list", { channelId }] as const,
};

export function triggerListQueryOptions(channelId: string) {
  return queryOptions({
    queryKey: triggerKeys.list(channelId),
    queryFn: (): Promise<JobTriggerRecord[]> =>
      client(
        `/api/job-triggers?channelId=${encodeURIComponent(channelId)}`,
        "triggers",
        { fallback: "Could not load standing starts" },
      ),
  });
}
