import type { JobTriggerKind, JobTriggerRecord } from "./queries";

const RELATIVE_UNITS = [
  { limit: 60_000, divisor: 1_000, unit: "second" },
  { limit: 3_600_000, divisor: 60_000, unit: "minute" },
  { limit: 86_400_000, divisor: 3_600_000, unit: "hour" },
  { limit: 604_800_000, divisor: 86_400_000, unit: "day" },
  { limit: Number.POSITIVE_INFINITY, divisor: 604_800_000, unit: "week" },
] as const;

const relativeFormat = new Intl.RelativeTimeFormat(undefined, {
  numeric: "auto",
});

export function wakeKindLabel(kind: JobTriggerKind): string {
  if (kind === "cron") return "Schedule";
  if (kind === "webhook") return "Webhook";
  return "Mailbox";
}

/** Owner-facing interval. Seconds stay seconds when they are not a round minute. */
export function intervalLabel(everySeconds: number | null): string | null {
  if (!everySeconds || everySeconds < 1) return null;
  if (everySeconds % 86_400 === 0) {
    const days = everySeconds / 86_400;
    return days === 1 ? "every day" : `every ${days} days`;
  }
  if (everySeconds % 3_600 === 0) {
    const hours = everySeconds / 3_600;
    return hours === 1 ? "every hour" : `every ${hours} hours`;
  }
  if (everySeconds % 60 === 0) {
    const minutes = everySeconds / 60;
    return minutes === 1 ? "every minute" : `every ${minutes} minutes`;
  }
  return `every ${everySeconds} seconds`;
}

export function relativeWakeTime(iso: string, now = Date.now()): string {
  const elapsed = now - new Date(iso).getTime();
  const scale =
    RELATIVE_UNITS.find(({ limit }) => Math.abs(elapsed) < limit) ??
    RELATIVE_UNITS[RELATIVE_UNITS.length - 1];
  return relativeFormat.format(
    -Math.round(elapsed / scale.divisor),
    scale.unit,
  );
}

export function inboundWebhookUrl(origin: string, triggerId: string): string {
  return `${origin.replace(/\/$/, "")}/api/inbound/webhook/${triggerId}`;
}

export function inboundEmailUrl(origin: string): string {
  return `${origin.replace(/\/$/, "")}/api/inbound/email`;
}

/** One line under the wake title: interval, last fire, next run, last error. */
export function wakeSummary(
  trigger: JobTriggerRecord,
  now = Date.now(),
): string {
  const parts: string[] = [];
  const interval = intervalLabel(trigger.everySeconds);
  if (interval) parts.push(interval);
  if (trigger.mailbox) parts.push(trigger.mailbox);
  if (trigger.lastEnqueuedAt) {
    parts.push(`last started ${relativeWakeTime(trigger.lastEnqueuedAt, now)}`);
  }
  if (trigger.kind === "cron" && trigger.nextRunAt && trigger.enabled) {
    parts.push(`next ${relativeWakeTime(trigger.nextRunAt, now)}`);
  }
  if (trigger.lastError) parts.push(trigger.lastError);
  if (!trigger.enabled) parts.push("off");
  return parts.join(" · ");
}
