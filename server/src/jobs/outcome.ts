/**
 * Skinny durable measure on the job / goal row.
 *
 * The owner-facing unit is a goal. In this tree that goal is the existing channel plus its
 * Intelligence thread — not a second transcript. Phase 1 statuses are Active | Needs you |
 * Done, plus one-sentence last_action. This is not Phase 5: no approval card, no expected
 * impact, no keep / revise / revert.
 */

export type JobResultStatus = "succeeded" | "failed" | "cancelled";
/** @deprecated Use JobResultStatus. Kept so older call sites type-check during the rename. */
export type JobOutcomeStatus = JobResultStatus;

export const GOAL_STATUSES = ["Active", "Needs you", "Done"] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];

export type JobOutcome = {
  /** Owner-facing Phase 1 status. Not the worker's queued/running/succeeded enum. */
  status: GoalStatus;
  last_action: string;
  last_action_at: string;
  jobStatus?: JobResultStatus;
  finishedAt?: string;
  goalId: string;
  channelId: string;
  agentId: string;
  orgId: string;
  actingUserId: string;
  /** Same sentence as last_action; kept for the earlier measure shape. */
  summary: string;
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

export function ownerStatusFor(
  jobStatus: JobResultStatus | "queued" | "running",
  needsYou = false,
): GoalStatus {
  if (needsYou) return "Needs you";
  if (jobStatus === "succeeded") return "Done";
  if (jobStatus === "failed" || jobStatus === "cancelled") return "Needs you";
  return "Active";
}

export function summarizeJobResult(input: {
  status: JobResultStatus | "queued" | "running";
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
  status: JobResultStatus | "queued" | "running";
  at: Date;
  goalId: string;
  channelId: string;
  agentId: string;
  orgId: string;
  actingUserId: string;
  needsYou?: boolean;
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
  const last_action = summarizeJobResult(input);
  const last_action_at = input.at.toISOString();
  const jobStatus: JobResultStatus | undefined =
    input.status === "succeeded" ||
    input.status === "failed" ||
    input.status === "cancelled"
      ? input.status
      : undefined;
  return {
    status: ownerStatusFor(input.status, input.needsYou === true),
    last_action,
    last_action_at,
    ...(jobStatus ? { jobStatus, finishedAt: last_action_at } : {}),
    goalId: input.goalId,
    channelId: input.channelId,
    agentId: input.agentId,
    orgId: input.orgId,
    actingUserId: input.actingUserId,
    summary: last_action,
    ...(crmRecordIds.length > 0 ? { crmRecordIds } : {}),
  };
}

export function asJobOutcome(value: unknown): JobOutcome | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    record.status !== "Active" &&
    record.status !== "Needs you" &&
    record.status !== "Done"
  ) {
    return null;
  }
  const last_action =
    typeof record.last_action === "string"
      ? record.last_action
      : typeof record.summary === "string"
        ? record.summary
        : "";
  const last_action_at =
    typeof record.last_action_at === "string"
      ? record.last_action_at
      : typeof record.finishedAt === "string"
        ? record.finishedAt
        : "";
  if (
    !last_action ||
    !last_action_at ||
    typeof record.channelId !== "string" ||
    typeof record.agentId !== "string" ||
    typeof record.orgId !== "string" ||
    typeof record.actingUserId !== "string"
  ) {
    return null;
  }
  const goalId =
    typeof record.goalId === "string" ? record.goalId : record.channelId;
  const jobStatus =
    record.jobStatus === "succeeded" ||
    record.jobStatus === "failed" ||
    record.jobStatus === "cancelled"
      ? record.jobStatus
      : undefined;
  const crmRecordIds = Array.isArray(record.crmRecordIds)
    ? record.crmRecordIds.filter((id): id is string => typeof id === "string")
    : [];
  return {
    status: record.status,
    last_action,
    last_action_at,
    ...(jobStatus ? { jobStatus } : {}),
    ...(typeof record.finishedAt === "string"
      ? { finishedAt: record.finishedAt }
      : {}),
    goalId,
    channelId: record.channelId,
    agentId: record.agentId,
    orgId: record.orgId,
    actingUserId: record.actingUserId,
    summary: typeof record.summary === "string" ? record.summary : last_action,
    ...(crmRecordIds.length > 0 ? { crmRecordIds } : {}),
  };
}
