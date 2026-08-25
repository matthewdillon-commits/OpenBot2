/**
 * Keep / revise / revert and outcome on the same goal object.
 *
 * Not a Measure or Approvals nav. The owner answers the card on the goal.
 */
import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import type { AuditStore } from "../audit";
import { recordAuditEvent } from "../audit";
import type { AppVariables } from "../auth/guards";
import type { ChannelStore } from "../channels/routes";
import { orgIdOf } from "../orgs/constants";
import { asGoalLoop } from "./parse";
import { runInGoalActionScope } from "./scope";
import type { GoalLoopStore } from "./store";
import {
  LOOP_DECISIONS,
  LOOP_OUTCOMES,
  type GoalLoop,
  type LoopDecision,
  type LoopDecisionRecord,
  type LoopOutcome,
  type PublicGoalLoop,
  emptyGoalLoop,
  publicGoalLoop,
} from "./types";
import { DECISIONS_KEPT } from "./wait";

export type ExecutePendingAction = (input: {
  orgId: string;
  channelId: string;
  goalId: string;
  actorId: string;
  botId: string;
  toolName: string;
  args: Record<string, unknown>;
  threadId?: string;
}) => Promise<string>;

export type GoalLoopRoutesOptions = {
  requireUser: MiddlewareHandler<{ Variables: AppVariables }>;
  channelStore: ChannelStore;
  loopStore: GoalLoopStore;
  executePending?: ExecutePendingAction;
  auditStore?: AuditStore;
};

function asDecision(value: unknown): LoopDecision | null {
  return typeof value === "string" &&
    (LOOP_DECISIONS as readonly string[]).includes(value)
    ? (value as LoopDecision)
    : null;
}

function asOutcome(value: unknown): LoopOutcome | null {
  return typeof value === "string" &&
    (LOOP_OUTCOMES as readonly string[]).includes(value)
    ? (value as LoopOutcome)
    : null;
}

export function createGoalLoopRoutes(options: GoalLoopRoutesOptions) {
  const { requireUser, channelStore, loopStore, executePending, auditStore } =
    options;
  const routes = new Hono<{ Variables: AppVariables }>();

  routes.get("/:channelId/loop", requireUser, async (context) => {
    const actor = context.var.actor;
    const orgId = orgIdOf(actor);
    const channel = await channelStore.get(
      actor,
      context.req.param("channelId"),
    );
    if (!channel) {
      return context.json({ error: "There is no such goal." }, 404);
    }
    const loop = await loopStore.get(orgId, channel.id);
    return context.json({ loop: publicGoalLoop(loop) });
  });

  routes.post("/:channelId/loop/decision", requireUser, async (context) => {
    const actor = context.var.actor;
    const orgId = orgIdOf(actor);
    const channel = await channelStore.get(
      actor,
      context.req.param("channelId"),
    );
    if (!channel) {
      return context.json({ error: "There is no such goal." }, 404);
    }
    let body: { decision?: unknown; note?: unknown };
    try {
      body = await context.req.json();
    } catch {
      return context.json({ error: "Send a JSON body." }, 400);
    }
    const decision = asDecision(body.decision);
    if (!decision) {
      return context.json(
        { error: "Decision must be keep, revise, or revert." },
        400,
      );
    }
    const note =
      typeof body.note === "string" && body.note.trim()
        ? body.note.trim()
        : null;

    const loop = await loopStore.get(orgId, channel.id);
    const card = loop.approval;
    if (!card || card.status !== "waiting") {
      return context.json(
        { error: "This goal has no approval card waiting." },
        409,
      );
    }

    const at = new Date();
    const record: LoopDecisionRecord = {
      decision,
      at: at.toISOString(),
      by: actor.id,
      jobId: card.jobId,
      note,
      toolName: card.pending?.toolName ?? null,
    };
    let carriedOut: string | null = null;
    if (decision === "keep" && card.pending && executePending) {
      carriedOut = await executePendingWithTools(executePending, {
        orgId,
        channelId: channel.id,
        goalId: channel.id,
        actorId: actor.id,
        botId: card.pending.botId,
        toolName: card.pending.toolName,
        args: card.pending.args,
        threadId: channel.threadId,
      });
    }

    const next = {
      ...loop,
      approval: { ...card, status: "decided" as const, pending: null },
      lastDecision: record,
      decisions: [record, ...loop.decisions].slice(0, DECISIONS_KEPT),
      outcome: loop.outcome ?? ("unknown" as const),
      outcomeAt: loop.outcomeAt ?? at.toISOString(),
      outcomeJobId: loop.outcomeJobId ?? card.jobId,
    };
    await loopStore.save(orgId, channel.id, next);

    if (auditStore) {
      await recordAuditEvent(auditStore, {
        eventType: "goal.decision_recorded",
        targetType: "goal",
        targetId: channel.id,
        actorUserId: actor.id,
        orgId,
        payload: {
          decision,
          jobId: card.jobId,
          tool: record.toolName,
        },
      }).catch(() => undefined);
    }

    return context.json({
      loop: publicGoalLoop(next),
      carriedOut,
    });
  });

  routes.post("/:channelId/loop/outcome", requireUser, async (context) => {
    const actor = context.var.actor;
    const orgId = orgIdOf(actor);
    const channel = await channelStore.get(
      actor,
      context.req.param("channelId"),
    );
    if (!channel) {
      return context.json({ error: "There is no such goal." }, 404);
    }
    let body: { outcome?: unknown; jobId?: unknown };
    try {
      body = await context.req.json();
    } catch {
      return context.json({ error: "Send a JSON body." }, 400);
    }
    const outcome = asOutcome(body.outcome);
    if (!outcome) {
      return context.json(
        { error: "Outcome must be worked, didn't, or unknown." },
        400,
      );
    }
    const loop = await loopStore.get(orgId, channel.id);
    const at = new Date();
    const jobId =
      typeof body.jobId === "string" && body.jobId.trim()
        ? body.jobId.trim()
        : loop.outcomeJobId;
    const next = {
      ...loop,
      outcome,
      outcomeAt: at.toISOString(),
      outcomeJobId: jobId,
    };
    await loopStore.save(orgId, channel.id, next);
    if (auditStore) {
      await recordAuditEvent(auditStore, {
        eventType: "goal.outcome_recorded",
        targetType: "goal",
        targetId: channel.id,
        actorUserId: actor.id,
        orgId,
        payload: { outcome, jobId },
      }).catch(() => undefined);
    }
    return context.json({ loop: publicGoalLoop(next) });
  });

  return routes;
}

export function applyJobOutcomeToLoop(input: {
  loop: GoalLoop;
  jobId: string;
  at?: Date;
}): GoalLoop {
  if (input.loop.outcome) return input.loop;
  if (input.loop.approval?.status === "waiting") return input.loop;
  const at = (input.at ?? new Date()).toISOString();
  return {
    ...input.loop,
    outcome: "unknown",
    outcomeAt: at,
    outcomeJobId: input.jobId,
  };
}

export async function recordUnknownOutcomeIfAbsent(input: {
  loopStore: GoalLoopStore;
  orgId: string;
  goalId: string;
  jobId: string;
}): Promise<void> {
  const loop = await input.loopStore.get(input.orgId, input.goalId);
  const next = applyJobOutcomeToLoop({
    loop,
    jobId: input.jobId,
  });
  if (next === loop) return;
  await input.loopStore.save(input.orgId, input.goalId, next);
}

export async function executePendingWithTools(
  execute: ExecutePendingAction,
  input: Parameters<ExecutePendingAction>[0],
): Promise<string> {
  return runInGoalActionScope(
    {
      orgId: input.orgId,
      channelId: input.channelId,
      goalId: input.goalId,
      threadId: input.threadId,
      actorId: input.actorId,
      botId: input.botId,
      toolName: input.toolName,
      args: input.args,
      carryOutHighRisk: true,
    },
    () => execute(input),
  );
}

export function loopFromUnknown(value: unknown): PublicGoalLoop {
  return publicGoalLoop(asGoalLoop(value) ?? emptyGoalLoop());
}
