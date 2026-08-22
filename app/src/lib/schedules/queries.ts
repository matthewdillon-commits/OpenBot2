import { queryOptions } from "@tanstack/react-query";
import { client } from "@/lib/client";

export type ScheduleKind = "cron" | "webhook" | "email";
export type ScheduleStatus = "active" | "paused";

/**
 * A standing job as the browser sees it.
 *
 * `hasWebhookSecret` is a boolean; the secret is write-only and returned once
 * on create. `canManage` is implied by the admin-only route.
 */
export type ScheduleRecord = {
  id: string;
  name: string;
  agentId: string;
  kind: ScheduleKind;
  cronExpr: string | null;
  weekdayBounded: boolean;
  timezone: string;
  brief: string;
  status: ScheduleStatus;
  lastRunAt: string | null;
  nextRunAt: string | null;
  hasWebhookSecret: boolean;
  matchFrom: string | null;
  matchTo: string | null;
  matchSubject: string | null;
  createdAt: string;
  updatedAt: string;
};

export type JobRunRecord = {
  id: string;
  jobId: string;
  status: "queued" | "running" | "succeeded" | "failed";
  trigger: "cron" | "webhook" | "email";
  result: string | null;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
};

export const scheduleKeys = {
  all: ["schedules"] as const,
  list: () => [...scheduleKeys.all, "list"] as const,
  detail: (id: string) => [...scheduleKeys.all, "detail", id] as const,
};

export function scheduleListQueryOptions() {
  return queryOptions({
    queryKey: scheduleKeys.list(),
    queryFn: (): Promise<ScheduleRecord[]> =>
      client("/api/admin/schedules", "schedules", {
        fallback: "Could not load schedules",
      }),
  });
}
