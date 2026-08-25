import { queryOptions } from "@tanstack/react-query";
import { client } from "@/lib/client";

/**
 * An unattended coworker job as the browser sees it.
 *
 * Status is the server's verdict. The prompt is what the person sent; `resultText` is what the
 * worker wrote back onto the channel when the job finished.
 */
export type UnattendedJobRecord = {
  id: string;
  channelId: string;
  coworkerId: string;
  threadId: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  trigger: string;
  prompt: string;
  error: string | null;
  resultText: string | null;
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
