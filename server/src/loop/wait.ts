/**
 * After the gateway permits a high-risk action, wait instead of silently acting.
 *
 * The audit trail already stores permit / refuse. This writes the approval card
 * on the same goal so the company keeps the wheel.
 */
import type { AuditStore } from "../audit";
import { recordAuditEvent } from "../audit";
import type { PolicyContext } from "../computer/policy";
import type { JobStore } from "../jobs/store";
import { firstSentence } from "../jobs/outcome";
import { actionRisk } from "./risk";
import { currentGoalActionScope } from "./scope";
import type { GoalLoopStore } from "./store";
import {
  APPROVAL_WAIT_MARKER,
  type ApprovalCard,
  type GoalLoop,
} from "./types";

export type HighRiskWaitInput = {
  context: PolicyContext;
  args?: Record<string, unknown>;
  before?: string;
  after?: string;
  rationale?: string;
  expectedImpact?: string;
  rollback?: string;
};

/**
 * Null means carry the action out. A string is the tool result: the action
 * was not carried out and the owner has an approval card on this goal.
 */
export type HighRiskWait = (input: HighRiskWaitInput) => Promise<string | null>;

const DECISIONS_KEPT = 8;

function compactArgs(args: Record<string, unknown>): string {
  try {
    const text = JSON.stringify(args);
    return firstSentence(text, 280) || text.slice(0, 280);
  } catch {
    return "the proposed write";
  }
}

function defaultRationale(toolName: string, args: Record<string, unknown>) {
  if (toolName === "crm_send") {
    const to =
      typeof args.to_address === "string" ? args.to_address : "a contact";
    return `Send a CRM message to ${to}.`;
  }
  if (toolName === "crm_create") {
    const kind = typeof args.kind === "string" ? args.kind : "record";
    const name = typeof args.name === "string" ? args.name : "a new record";
    return `Create CRM ${kind} ${name}.`;
  }
  if (toolName === "crm_update") {
    const kind = typeof args.kind === "string" ? args.kind : "record";
    return `Update CRM ${kind}.`;
  }
  if (toolName === "computer_write_file") {
    const path = typeof args.path === "string" ? args.path : "a workspace file";
    return `Write ${path} on the computer.`;
  }
  if (toolName === "computer_run_command") {
    const command =
      typeof args.command === "string" ? args.command : "a shell command";
    return `Run \`${firstSentence(command, 120)}\` on the computer.`;
  }
  if (toolName.startsWith("mcp__") || args.mcp) {
    return `Call ${toolName}, which would change an external system.`;
  }
  return `Carry out ${toolName}.`;
}

function defaultRollback(toolName: string) {
  if (toolName === "crm_create") {
    return "Do not create the record. If keep already created it, delete that CRM row.";
  }
  if (toolName === "crm_update") {
    return "Do not apply the update. Restore the previous field values.";
  }
  if (toolName === "crm_send") {
    return "Do not send. If it already went out, follow up to retract.";
  }
  if (toolName === "computer_write_file") {
    return "Do not write the file. Restore the previous contents if keep already wrote.";
  }
  if (toolName === "computer_run_command") {
    return "Do not run the command.";
  }
  return "Do not carry this action out. Revert any side effect keep already applied.";
}

export function buildApprovalCard(input: {
  toolName: string;
  args: Record<string, unknown>;
  botId: string;
  jobId: string | null;
  loop: GoalLoop;
  at: Date;
  before?: string;
  after?: string;
  rationale?: string;
  expectedImpact?: string;
  rollback?: string;
}): ApprovalCard {
  const rationale =
    input.rationale?.trim() || defaultRationale(input.toolName, input.args);
  const expectedImpact =
    input.expectedImpact?.trim() ||
    input.loop.expectedImpact ||
    `This ${input.toolName} write is expected to move the goal forward.`;
  const after = input.after?.trim() || compactArgs(input.args);
  const before =
    input.before?.trim() || "Current records are unchanged until this is kept.";
  return {
    rationale,
    expectedImpact,
    before,
    after,
    rollback: input.rollback?.trim() || defaultRollback(input.toolName),
    status: "waiting",
    jobId: input.jobId,
    createdAt: input.at.toISOString(),
    pending: {
      toolName: input.toolName,
      args: input.args,
      botId: input.botId,
    },
  };
}

export function createHighRiskWait(deps: {
  loopStore: GoalLoopStore;
  jobStore?: Pick<JobStore, "markNeedsYou">;
  auditStore?: AuditStore;
}): HighRiskWait {
  return async (input) => {
    if (actionRisk(input.context) !== "high") return null;
    const scope = currentGoalActionScope();
    if (!scope) return null;
    if (scope.carryOutHighRisk) return null;

    const loop = await deps.loopStore.get(scope.orgId, scope.goalId);
    if (loop.approval?.status === "waiting") {
      return (
        `${APPROVAL_WAIT_MARKER} This goal already has an approval card. ` +
        "It was not carried out. Keep, revise, or revert that card first."
      );
    }

    const args = input.args ?? scope.args;
    const at = new Date();
    const card = buildApprovalCard({
      toolName: input.context.tool.name,
      args,
      botId: scope.botId,
      jobId: scope.jobId ?? null,
      loop,
      at,
      before: input.before,
      after: input.after,
      rationale: input.rationale,
      expectedImpact: input.expectedImpact,
      rollback: input.rollback,
    });
    const next: GoalLoop = {
      ...loop,
      expectedImpact: loop.expectedImpact ?? card.expectedImpact,
      approval: card,
    };
    await deps.loopStore.save(scope.orgId, scope.goalId, next);

    if (deps.jobStore) {
      try {
        await deps.jobStore.markNeedsYou({
          orgId: scope.orgId,
          coworkerId: scope.botId,
          actingUserId: scope.actorId,
          lastAction: "Needs you: keep, revise, or revert this goal.",
        });
      } catch {
        // The card is on the channel. Losing the job pause must not hide it.
      }
    }

    if (deps.auditStore) {
      await recordAuditEvent(deps.auditStore, {
        eventType: "goal.approval_opened",
        targetType: "goal",
        targetId: scope.goalId,
        actorUserId: scope.actorId,
        orgId: scope.orgId,
        payload: {
          tool: input.context.tool.name,
          jobId: scope.jobId ?? null,
          channelId: scope.channelId,
        },
      }).catch(() => undefined);
    }

    return [
      APPROVAL_WAIT_MARKER,
      card.rationale,
      `Expected impact: ${card.expectedImpact}.`,
      `Before: ${card.before}`,
      `After: ${card.after}`,
      `Rollback: ${card.rollback}`,
      "The owner must keep, revise, or revert. Do not retry this write until they do.",
    ].join(" ");
  };
}

export { DECISIONS_KEPT };
