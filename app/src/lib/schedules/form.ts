import { z } from "zod";
import type { ScheduleInput } from "./mutations";

export const scheduleFormSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required."),
    agentId: z.string().trim().min(1, "A coworker is required."),
    kind: z.enum(["cron", "webhook", "email"]),
    brief: z.string().trim().min(1, "A brief is required."),
    cronExpr: z.string(),
    weekdayBounded: z.boolean(),
    matchFrom: z.string(),
    matchTo: z.string(),
    matchSubject: z.string(),
  })
  .superRefine((value, ctx) => {
    if (value.kind === "cron" && !value.cronExpr.trim()) {
      ctx.addIssue({
        code: "custom",
        path: ["cronExpr"],
        message: "A cron expression is required.",
      });
    }
  });

export type ScheduleFormValues = z.infer<typeof scheduleFormSchema>;

export function scheduleInputFrom(values: ScheduleFormValues): ScheduleInput {
  return {
    name: values.name,
    agentId: values.agentId,
    kind: values.kind,
    brief: values.brief,
    weekdayBounded: values.weekdayBounded,
    ...(values.kind === "cron" ? { cronExpr: values.cronExpr.trim() } : {}),
    ...(values.kind === "email"
      ? {
          matchFrom: values.matchFrom.trim(),
          matchTo: values.matchTo.trim(),
          matchSubject: values.matchSubject.trim(),
        }
      : {}),
  };
}
