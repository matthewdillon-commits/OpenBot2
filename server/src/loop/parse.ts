import {
  type ApprovalCard,
  type ApprovalPendingAction,
  emptyGoalLoop,
  type GoalLoop,
  type LoopDecision,
  type LoopDecisionRecord,
  LOOP_DECISIONS,
  LOOP_OUTCOMES,
  type LoopOutcome,
} from "./types";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asOutcome(value: unknown): LoopOutcome | null {
  return typeof value === "string" &&
    (LOOP_OUTCOMES as readonly string[]).includes(value)
    ? (value as LoopOutcome)
    : null;
}

function asDecision(value: unknown): LoopDecision | null {
  return typeof value === "string" &&
    (LOOP_DECISIONS as readonly string[]).includes(value)
    ? (value as LoopDecision)
    : null;
}

function asPending(value: unknown): ApprovalPendingAction | null {
  const record = asRecord(value);
  if (!record || typeof record.toolName !== "string" || !record.toolName) {
    return null;
  }
  const args = asRecord(record.args) ?? {};
  const botId = typeof record.botId === "string" ? record.botId : "";
  return { toolName: record.toolName, args, botId };
}

function asCard(value: unknown): ApprovalCard | null {
  const record = asRecord(value);
  if (!record) return null;
  if (
    typeof record.rationale !== "string" ||
    typeof record.expectedImpact !== "string" ||
    typeof record.before !== "string" ||
    typeof record.after !== "string" ||
    typeof record.rollback !== "string" ||
    typeof record.createdAt !== "string"
  ) {
    return null;
  }
  if (record.status !== "waiting" && record.status !== "decided") return null;
  return {
    rationale: record.rationale,
    expectedImpact: record.expectedImpact,
    before: record.before,
    after: record.after,
    rollback: record.rollback,
    status: record.status,
    jobId: typeof record.jobId === "string" ? record.jobId : null,
    createdAt: record.createdAt,
    pending: asPending(record.pending),
  };
}

function asDecisionRecord(value: unknown): LoopDecisionRecord | null {
  const record = asRecord(value);
  if (!record) return null;
  const decision = asDecision(record.decision);
  if (
    !decision ||
    typeof record.at !== "string" ||
    typeof record.by !== "string"
  ) {
    return null;
  }
  return {
    decision,
    at: record.at,
    by: record.by,
    jobId: typeof record.jobId === "string" ? record.jobId : null,
    note: typeof record.note === "string" ? record.note : null,
    toolName: typeof record.toolName === "string" ? record.toolName : null,
  };
}

/** Read a stored loop without inventing fields the row never had. */
export function asGoalLoop(value: unknown): GoalLoop {
  const record = asRecord(value);
  if (!record) return emptyGoalLoop();
  const lastDecision = asDecisionRecord(record.lastDecision);
  const decisions = Array.isArray(record.decisions)
    ? record.decisions
        .map(asDecisionRecord)
        .filter((item): item is LoopDecisionRecord => item !== null)
    : lastDecision
      ? [lastDecision]
      : [];
  return {
    expectedImpact:
      typeof record.expectedImpact === "string" ? record.expectedImpact : null,
    outcome: asOutcome(record.outcome),
    outcomeAt: typeof record.outcomeAt === "string" ? record.outcomeAt : null,
    outcomeJobId:
      typeof record.outcomeJobId === "string" ? record.outcomeJobId : null,
    approval: asCard(record.approval),
    lastDecision,
    decisions,
  };
}
