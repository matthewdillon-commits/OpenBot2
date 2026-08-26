import { z } from "zod";
import type { JobTriggerInput } from "./mutations";

export const INTERVAL_PRESETS = [
  { seconds: 900, label: "Every 15 minutes" },
  { seconds: 3600, label: "Every hour" },
  { seconds: 21_600, label: "Every 6 hours" },
  { seconds: 86_400, label: "Every day" },
] as const;

export const cronWakeFormSchema = z.object({
  prompt: z.string().trim().min(1, "A standing prompt is required."),
  everySeconds: z.coerce
    .number()
    .int()
    .min(1, "How often must be at least one second."),
});

export const webhookWakeFormSchema = z.object({
  prompt: z.string().trim().min(1, "A standing prompt is required."),
});

export const emailWakeFormSchema = z.object({
  mailbox: z
    .string()
    .trim()
    .min(1, "A mailbox address is required.")
    .refine((value) => value.includes("@"), "Enter an email address."),
  prompt: z.string(),
});

export type CronWakeFormValues = z.infer<typeof cronWakeFormSchema>;
export type WebhookWakeFormValues = z.infer<typeof webhookWakeFormSchema>;
export type EmailWakeFormValues = z.infer<typeof emailWakeFormSchema>;

export function cronWakeInputFrom(
  channelId: string,
  values: CronWakeFormValues,
): JobTriggerInput {
  return {
    kind: "cron",
    channelId,
    goalId: channelId,
    prompt: values.prompt,
    everySeconds: values.everySeconds,
  };
}

export function webhookWakeInputFrom(
  channelId: string,
  values: WebhookWakeFormValues,
): JobTriggerInput {
  return {
    kind: "webhook",
    channelId,
    goalId: channelId,
    prompt: values.prompt,
  };
}

export function emailWakeInputFrom(
  channelId: string,
  values: EmailWakeFormValues,
): JobTriggerInput {
  return {
    kind: "email",
    channelId,
    goalId: channelId,
    mailbox: values.mailbox,
    ...(values.prompt.trim() ? { prompt: values.prompt.trim() } : {}),
  };
}
