/**
 * Skinny durable measure written onto a job when it finishes.
 *
 * Status alone is not enough: a later read needs to know who ran, on which channel, and what
 * happened, without replaying the transcript. This is not Phase 5 — no approval card, no
 * expected impact, no keep / revise / revert, no experiment assignment.
 */

export type JobOutcomeStatus = "succeeded" | "failed" | "cancelled";

export type JobOutcome = {
  status: JobOutcomeStatus;
  finishedAt: string;
  channelId: string;
  agentId: string;
  orgId: string;
  actingUserId: string;
  /** One sentence: last assistant text, else a tool-success count, else the error. */
  summary: string;
  /** CRM write ids already present in tool results or assistant text. */
  crmRecordIds?: string[];
};

const CRM_WRITE_ID =
  /(?:Created|Updated) (?:person|company|opportunity|campaign|conversation|send) ([^\s:]+):/g;

const SUMMARY_MAX = 240;

export function firstSentence(text: string, max = SUMMARY_MAX): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (!trimmed) return "";
  const match = trimmed.match(/^.*?[.!?](?:\s|$)/);
  const sentence = (match?.[0] ?? trimmed).trim();
  if (sentence.length <= max) return sentence;
  return `${sentence.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}

export function summarizeJobResult(input: {
  status: JobOutcomeStatus;
  assistantText?: string | null;
  error?: string | null;
  toolSuccessCount?: number;
}): string {
  const fromAssistant = firstSentence(input.assistantText ?? "");
  if (fromAssistant) return fromAssistant;
  if (input.error?.trim()) return firstSentence(input.error);
  if (typeof input.toolSuccessCount === "number") {
    return input.toolSuccessCount === 1
      ? "1 tool succeeded."
      : `${input.toolSuccessCount} tools succeeded.`;
  }
  if (input.status === "succeeded") return "The job finished.";
  if (input.status === "cancelled") return "The job was cancelled.";
  return "The job failed.";
}

export function extractCrmRecordIds(
  ...texts: Array<string | undefined | null>
): string[] {
  const ids = new Set<string>();
  for (const text of texts) {
    if (!text) continue;
    for (const match of text.matchAll(CRM_WRITE_ID)) {
      const id = match[1]?.trim();
      if (id) ids.add(id);
    }
  }
  return [...ids];
}

export function buildJobOutcome(input: {
  status: JobOutcomeStatus;
  finishedAt: Date;
  channelId: string;
  agentId: string;
  orgId: string;
  actingUserId: string;
  assistantText?: string | null;
  error?: string | null;
  toolSuccessCount?: number;
  crmRecordIds?: string[];
  sourceTexts?: Array<string | undefined | null>;
}): JobOutcome {
  const crmRecordIds = [
    ...new Set([
      ...(input.crmRecordIds ?? []),
      ...extractCrmRecordIds(
        input.assistantText,
        input.error,
        ...(input.sourceTexts ?? []),
      ),
    ]),
  ];
  return {
    status: input.status,
    finishedAt: input.finishedAt.toISOString(),
    channelId: input.channelId,
    agentId: input.agentId,
    orgId: input.orgId,
    actingUserId: input.actingUserId,
    summary: summarizeJobResult(input),
    ...(crmRecordIds.length > 0 ? { crmRecordIds } : {}),
  };
}

export function asJobOutcome(value: unknown): JobOutcome | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    record.status !== "succeeded" &&
    record.status !== "failed" &&
    record.status !== "cancelled"
  ) {
    return null;
  }
  if (
    typeof record.finishedAt !== "string" ||
    typeof record.channelId !== "string" ||
    typeof record.agentId !== "string" ||
    typeof record.orgId !== "string" ||
    typeof record.actingUserId !== "string" ||
    typeof record.summary !== "string"
  ) {
    return null;
  }
  const crmRecordIds = Array.isArray(record.crmRecordIds)
    ? record.crmRecordIds.filter((id): id is string => typeof id === "string")
    : [];
  return {
    status: record.status,
    finishedAt: record.finishedAt,
    channelId: record.channelId,
    agentId: record.agentId,
    orgId: record.orgId,
    actingUserId: record.actingUserId,
    summary: record.summary,
    ...(crmRecordIds.length > 0 ? { crmRecordIds } : {}),
  };
}
