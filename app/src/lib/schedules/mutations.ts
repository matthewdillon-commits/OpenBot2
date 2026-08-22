import { mutationOptions, type QueryClient } from "@tanstack/react-query";
import { client } from "@/lib/client";
import {
  scheduleKeys,
  type ScheduleKind,
  type ScheduleRecord,
} from "./queries";

const FALLBACK = "The schedule could not be changed.";

export type ScheduleInput = {
  name: string;
  agentId: string;
  kind: ScheduleKind;
  brief: string;
  cronExpr?: string;
  weekdayBounded?: boolean;
  timezone?: string;
};

export type CreatedSchedule = ScheduleRecord & {
  webhookSecret?: string;
};

function invalidateSchedules(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: scheduleKeys.all });
}

export function createScheduleMutationOptions(queryClient: QueryClient) {
  return mutationOptions({
    mutationFn: (input: ScheduleInput): Promise<CreatedSchedule> =>
      client("/api/admin/schedules", "schedule", {
        method: "POST",
        body: input,
        fallback: FALLBACK,
      }),
    onSuccess: () => invalidateSchedules(queryClient),
  });
}

export function pauseScheduleMutationOptions(queryClient: QueryClient) {
  return mutationOptions({
    mutationFn: (variables: { scheduleId: string; paused: boolean }) =>
      client(
        `/api/admin/schedules/${variables.scheduleId}/${variables.paused ? "pause" : "resume"}`,
        {
          method: "POST",
          fallback: FALLBACK,
        },
      ),
    onSuccess: () => invalidateSchedules(queryClient),
  });
}

export function deleteScheduleMutationOptions(queryClient: QueryClient) {
  return mutationOptions({
    mutationFn: (scheduleId: string) =>
      client(`/api/admin/schedules/${scheduleId}`, {
        method: "DELETE",
        fallback: FALLBACK,
      }),
    onSuccess: () => invalidateSchedules(queryClient),
  });
}
