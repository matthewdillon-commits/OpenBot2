/**
 * Phase 5 fields on the existing goal (the channel + its Intelligence thread).
 *
 * Not a new table-as-product. Statuses stay Active | Needs you | Done; this is
 * measure / improve on the same object.
 */

export const LOOP_OUTCOMES = ["worked", "didn't", "unknown"] as const;
export type LoopOutcome = (typeof LOOP_OUTCOMES)[number];

export const LOOP_DECISIONS = ["keep", "revise", "revert"] as const;
export type LoopDecision = (typeof LOOP_DECISIONS)[number];

export const LOOP_STAGES = [
  "observe",
  "understand",
  "prioritize",
  "act",
  "measure",
  "improve",
] as const;
export type LoopStage = (typeof LOOP_STAGES)[number];

export const APPROVAL_WAIT_MARKER = "Waiting for you.";

export type ApprovalPendingAction = {
  toolName: string;
  args: Record<string, unknown>;
  botId: string;
};

export type ApprovalCard = {
  rationale: string;
  expectedImpact: string;
  before: string;
  after: string;
  rollback: string;
  status: "waiting" | "decided";
  jobId: string | null;
  createdAt: string;
  pending: ApprovalPendingAction | null;
};

export type LoopDecisionRecord = {
  decision: LoopDecision;
  at: string;
  by: string;
  jobId: string | null;
  note: string | null;
  toolName: string | null;
};

export type GoalLoop = {
  expectedImpact: string | null;
  outcome: LoopOutcome | null;
  outcomeAt: string | null;
  outcomeJobId: string | null;
  approval: ApprovalCard | null;
  lastDecision: LoopDecisionRecord | null;
  decisions: LoopDecisionRecord[];
};

export type PublicApprovalCard = {
  rationale: string;
  expectedImpact: string;
  before: string;
  after: string;
  rollback: string;
  status: "waiting" | "decided";
  jobId: string | null;
};

export type PublicLoopDecision = {
  decision: LoopDecision;
  at: string;
  note: string | null;
};

export type PublicGoalLoop = {
  expectedImpact: string | null;
  outcome: LoopOutcome | null;
  outcomeAt: string | null;
  stage: LoopStage | null;
  approval: PublicApprovalCard | null;
  lastDecision: PublicLoopDecision | null;
};

export function emptyGoalLoop(): GoalLoop {
  return {
    expectedImpact: null,
    outcome: null,
    outcomeAt: null,
    outcomeJobId: null,
    approval: null,
    lastDecision: null,
    decisions: [],
  };
}

export function loopStageOf(loop: GoalLoop): LoopStage | null {
  if (loop.approval?.status === "waiting") return "act";
  if (loop.lastDecision && loop.outcome) return "improve";
  if (loop.outcome) return "measure";
  if (loop.expectedImpact) return "prioritize";
  return null;
}

export function publicApproval(card: ApprovalCard): PublicApprovalCard {
  return {
    rationale: card.rationale,
    expectedImpact: card.expectedImpact,
    before: card.before,
    after: card.after,
    rollback: card.rollback,
    status: card.status,
    jobId: card.jobId,
  };
}

export function publicGoalLoop(loop: GoalLoop): PublicGoalLoop {
  return {
    expectedImpact: loop.expectedImpact,
    outcome: loop.outcome,
    outcomeAt: loop.outcomeAt,
    stage: loopStageOf(loop),
    approval: loop.approval ? publicApproval(loop.approval) : null,
    lastDecision: loop.lastDecision
      ? {
          decision: loop.lastDecision.decision,
          at: loop.lastDecision.at,
          note: loop.lastDecision.note,
        }
      : null,
  };
}
