import { queryOptions } from "@tanstack/react-query";
import { client } from "@/lib/client";

/**
 * An unattended coworker job as the browser sees it.
 *
 * Status is the server's worker verdict. The owner-facing unit is a goal: in this tree that
 * is the existing channel plus its Intelligence thread. `outcome` is Active | Needs you |
 * Done plus last_action — not an approval card.
 */
export type UnattendedJobOutcome = {
  status: "Active" | "Needs you" | "Done";
  last_action: string;
  last_action_at: string;
  jobStatus?: "succeeded" | "failed" | "cancelled";
  finishedAt?: string;
  goalId: string;
  channelId: string;
  agentId: string;
  orgId: string;
  actingUserId: string;
  summary: string;
  crmRecordIds?: string[];
};

export type UnattendedJobRecord = {
  id: string;
  channelId: string;
  goalId: string;
  coworkerId: string;
  threadId: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  trigger: string;
  prompt: string;
  error: string | null;
  resultText: string | null;
  outcome: UnattendedJobOutcome | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

export const jobKeys = {
  all: ["jobs"] as const,
  detail: (jobId: string) => ["jobs", "detail", jobId] as const,
  channel: (channelId: string) => ["jobs", "channel", { channelId }] as const,
};

export function jobQueryOptions(jobId: string) {
  return queryOptions({
    queryKey: jobKeys.detail(jobId),
    queryFn: (): Promise<UnattendedJobRecord> =>
      client(`/api/jobs/${jobId}`, "job", {
        fallback: "Could not load that job",
      }),
  });
}
