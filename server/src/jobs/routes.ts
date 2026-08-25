/**
 * Enqueue an unattended coworker job. The API writes a row; a worker claims it.
 *
 * The run must not live in an in-process Map on this replica. Consecutive requests reach
 * different processes, and the process that accepted Send-and-go is rarely the one that
 * should execute the coworker.
 */
import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import type { AuditStore } from "../audit";
import { recordAuditEvent } from "../audit";
import type { AppVariables } from "../auth/guards";
import type { ChannelStore } from "../channels/routes";
import { orgIdOf } from "../orgs/constants";
import type { JobOutcome, JobStore, UnattendedJob } from "./store";

export type JobRoutesOptions = {
  requireUser: MiddlewareHandler<{ Variables: AppVariables }>;
  jobStore: JobStore;
  channelStore: ChannelStore;
  auditStore?: AuditStore;
};

export type PublicJob = {
  id: string;
  channelId: string;
  goalId: string;
  coworkerId: string;
  threadId: string;
  status: UnattendedJob["status"];
  trigger: string;
  prompt: string;
  error: string | null;
  resultText: string | null;
  outcome: JobOutcome | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

export function publicJob(job: UnattendedJob): PublicJob {
  return {
    id: job.id,
    channelId: job.channelId,
    goalId: job.goalId,
    coworkerId: job.coworkerId,
    threadId: job.threadId,
    status: job.status,
    trigger: job.trigger,
    prompt: job.payload.prompt,
    error: job.error,
    resultText:
      job.payload.result?.text ??
      job.outcome?.last_action ??
      job.outcome?.summary ??
      null,
    outcome: job.outcome,
    createdAt: job.createdAt.toISOString(),
    startedAt: job.startedAt?.toISOString() ?? null,
    finishedAt:
      job.finishedAt?.toISOString() ?? job.outcome?.finishedAt ?? null,
  };
}

export function createJobRoutes(options: JobRoutesOptions) {
  const { requireUser, jobStore, channelStore, auditStore } = options;
  const routes = new Hono<{ Variables: AppVariables }>();

  routes.post("/", requireUser, async (context) => {
    const actor = context.var.actor;
    const orgId = orgIdOf(actor);
    let body: {
      channelId?: unknown;
      goalId?: unknown;
      prompt?: unknown;
      text?: unknown;
      agentId?: unknown;
      skillInstructions?: unknown;
    };
    try {
      body = await context.req.json();
    } catch {
      return context.json({ error: "Send a JSON body." }, 400);
    }
    const requestedChannel =
      typeof body.channelId === "string" ? body.channelId.trim() : "";
    const requestedGoal =
      typeof body.goalId === "string" ? body.goalId.trim() : "";
    const channelId = requestedChannel || requestedGoal;
    const goalId = requestedGoal || channelId;
    const prompt =
      typeof body.prompt === "string"
        ? body.prompt.trim()
        : typeof body.text === "string"
          ? body.text.trim()
          : "";
    if (!channelId) {
      return context.json({ error: "A channel is required." }, 400);
    }
    if (!prompt) {
      return context.json({ error: "A message is required." }, 400);
    }
    const channel = await channelStore.get(
      { id: actor.id, role: actor.role, orgId },
      channelId,
    );
    if (!channel) {
      return context.json({ error: "There is no such channel." }, 404);
    }
    if (!channel.threadId) {
      return context.json(
        {
          error:
            "This channel has no Intelligence thread. Unattended runs attach to the existing mapping and do not mint one.",
        },
        409,
      );
    }
    if (!channel.active) {
      return context.json(
        { error: "This channel can no longer start a run." },
        409,
      );
    }
    if (goalId !== channel.id) {
      return context.json(
        {
          error:
            "A goal maps to the existing channel and its Intelligence thread. This goal is not that channel.",
        },
        409,
      );
    }
    const requested =
      typeof body.agentId === "string" ? body.agentId.trim() : "";
    const coworkerId = requested || channel.agentIds[0] || "";
    if (!coworkerId || !channel.agentIds.includes(coworkerId)) {
      return context.json(
        { error: "That coworker is not in this channel." },
        400,
      );
    }
    const skillInstructions = Array.isArray(body.skillInstructions)
      ? body.skillInstructions.filter(
          (item): item is string =>
            typeof item === "string" && item.trim().length > 0,
        )
      : [];

    const job = await jobStore.enqueue({
      orgId,
      channelId: channel.id,
      goalId: channel.id,
      coworkerId,
      actingUserId: actor.id,
      threadId: channel.threadId,
      prompt,
      ...(skillInstructions.length > 0 ? { skillInstructions } : {}),
      trigger: "manual",
    });

    await channelStore
      .recordActivity({ id: actor.id, role: actor.role, orgId }, channel.id, {
        text: prompt,
        agentId: null,
        at: new Date(),
      })
      .catch(() => undefined);

    if (auditStore) {
      await recordAuditEvent(auditStore, {
        eventType: "job.enqueued",
        targetType: "job",
        targetId: job.id,
        actorUserId: actor.id,
        orgId,
        payload: {
          channelId: channel.id,
          coworkerId,
          threadId: channel.threadId,
          trigger: "manual",
        },
      });
    }

    return context.json({ job: publicJob(job) }, 201);
  });

  routes.get("/", requireUser, async (context) => {
    const actor = context.var.actor;
    const orgId = orgIdOf(actor);
    const channelId = context.req.query("channelId")?.trim();
    if (!channelId) {
      return context.json({ error: "A channel is required." }, 400);
    }
    const channel = await channelStore.get(
      { id: actor.id, role: actor.role, orgId },
      channelId,
    );
    if (!channel) {
      return context.json({ error: "There is no such channel." }, 404);
    }
    const listed = await jobStore.listForChannel(orgId, channelId);
    return context.json({ jobs: listed.map(publicJob) });
  });

  routes.get("/:jobId", requireUser, async (context) => {
    const actor = context.var.actor;
    const orgId = orgIdOf(actor);
    const job = await jobStore.get(orgId, context.req.param("jobId"));
    if (!job) {
      return context.json({ error: "There is no such job." }, 404);
    }
    return context.json({ job: publicJob(job) });
  });

  return routes;
}
