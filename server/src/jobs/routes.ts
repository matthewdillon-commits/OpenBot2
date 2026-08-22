import { Hono } from "hono";
import type { AppVariables } from "../auth/guards";
import { requireAdmin } from "../auth/guards";
import type { MiddlewareHandler } from "hono";
import type { ScheduleGateway } from "./gateway";
import type { ScheduledJobKind } from "./store";

export function createScheduleRoutes(
  gateway: ScheduleGateway,
  requireUser: MiddlewareHandler<{ Variables: AppVariables }>,
) {
  const app = new Hono<{ Variables: AppVariables }>();

  app.get("/", requireUser, async (context) => {
    const denied = requireAdmin(context);
    if (denied) return denied;
    return context.json({ schedules: await gateway.list() });
  });

  app.post("/", requireUser, async (context) => {
    const denied = requireAdmin(context);
    if (denied) return denied;
    const parsed = parseCreate(await context.req.json().catch(() => null));
    if (!parsed.ok) return context.json({ error: parsed.error }, 400);

    const result = await gateway.create(
      { id: context.var.actor.id, role: context.var.actor.role },
      parsed.value,
    );
    if (!result.ok) return context.json({ error: result.error }, result.status);
    return context.json(
      {
        schedule: {
          ...publicJob(result.job),
          ...(result.webhookSecret
            ? { webhookSecret: result.webhookSecret }
            : {}),
        },
      },
      201,
    );
  });

  app.get("/:id", requireUser, async (context) => {
    const denied = requireAdmin(context);
    if (denied) return denied;
    const job = await gateway.get(context.req.param("id"));
    if (!job)
      return context.json({ error: "That schedule was not found." }, 404);
    return context.json({
      schedule: publicJob(job),
      runs: await gateway.listRuns(job.id),
    });
  });

  app.post("/:id/pause", requireUser, async (context) => {
    const denied = requireAdmin(context);
    if (denied) return denied;
    const job = await gateway.setPaused(
      { id: context.var.actor.id, role: context.var.actor.role },
      context.req.param("id"),
      true,
    );
    if (!job)
      return context.json({ error: "That schedule was not found." }, 404);
    return context.json({ schedule: publicJob(job) });
  });

  app.post("/:id/resume", requireUser, async (context) => {
    const denied = requireAdmin(context);
    if (denied) return denied;
    const job = await gateway.setPaused(
      { id: context.var.actor.id, role: context.var.actor.role },
      context.req.param("id"),
      false,
    );
    if (!job)
      return context.json({ error: "That schedule was not found." }, 404);
    return context.json({ schedule: publicJob(job) });
  });

  app.delete("/:id", requireUser, async (context) => {
    const denied = requireAdmin(context);
    if (denied) return denied;
    const removed = await gateway.remove(
      { id: context.var.actor.id, role: context.var.actor.role },
      context.req.param("id"),
    );
    if (!removed)
      return context.json({ error: "That schedule was not found." }, 404);
    return context.json({ ok: true });
  });

  return app;
}

/**
 * Generic inbound event. Authenticated by the job secret, not a session.
 * The in-process IMAP poller fires email-kind jobs through the same gateway
 * with `trusted: true`; this HTTP route never does. The request returns as
 * soon as the run is recorded; the coworker is woken afterwards.
 */
export function createTriggerRoutes(gateway: ScheduleGateway) {
  const app = new Hono();

  app.post("/:id", async (context) => {
    const secret = triggerSecret(context.req.raw.headers);
    const body = (await context.req.json().catch(() => null)) as {
      trigger?: unknown;
    } | null;
    const trigger = body?.trigger === "email" ? "email" : "webhook";

    const result = await gateway.fireInbound({
      jobId: context.req.param("id"),
      trigger,
      secret,
    });
    if (!result.ok) return context.json({ error: result.error }, result.status);
    return context.json({ run: result.run }, 202);
  });

  return app;
}

function triggerSecret(headers: Headers): string | undefined {
  const named = headers.get("x-openbot-trigger-secret")?.trim();
  if (named) return named;
  const authorization = headers.get("authorization")?.trim() ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  return match?.[1]?.trim();
}

function publicJob(job: Awaited<ReturnType<ScheduleGateway["list"]>>[number]) {
  return {
    id: job.id,
    name: job.name,
    agentId: job.agentId,
    kind: job.kind,
    cronExpr: job.cronExpr,
    weekdayBounded: job.weekdayBounded,
    timezone: job.timezone,
    brief: job.brief,
    status: job.status,
    lastRunAt: job.lastRunAt?.toISOString() ?? null,
    nextRunAt: job.nextRunAt?.toISOString() ?? null,
    hasWebhookSecret: job.hasWebhookSecret,
    matchFrom: job.matchFrom,
    matchTo: job.matchTo,
    matchSubject: job.matchSubject,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
  };
}

function parseCreate(value: unknown):
  | {
      ok: true;
      value: {
        name: string;
        agentId: string;
        kind: ScheduledJobKind;
        cronExpr?: string | null;
        weekdayBounded?: boolean;
        timezone?: string;
        brief: string;
        matchFrom?: string | null;
        matchTo?: string | null;
        matchSubject?: string | null;
      };
    }
  | { ok: false; error: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "Schedule input must be a JSON object." };
  }
  const body = value as Record<string, unknown>;
  if (
    typeof body.name !== "string" ||
    typeof body.agentId !== "string" ||
    typeof body.brief !== "string"
  ) {
    return {
      ok: false,
      error: "A schedule needs a name, a coworker, and a brief.",
    };
  }
  if (
    body.kind !== "cron" &&
    body.kind !== "webhook" &&
    body.kind !== "email"
  ) {
    return { ok: false, error: "Kind must be cron, webhook, or email." };
  }
  return {
    ok: true,
    value: {
      name: body.name,
      agentId: body.agentId,
      kind: body.kind,
      brief: body.brief,
      ...(typeof body.cronExpr === "string" ? { cronExpr: body.cronExpr } : {}),
      ...(typeof body.weekdayBounded === "boolean"
        ? { weekdayBounded: body.weekdayBounded }
        : {}),
      ...(typeof body.timezone === "string" ? { timezone: body.timezone } : {}),
      ...(typeof body.matchFrom === "string"
        ? { matchFrom: body.matchFrom }
        : {}),
      ...(typeof body.matchTo === "string" ? { matchTo: body.matchTo } : {}),
      ...(typeof body.matchSubject === "string"
        ? { matchSubject: body.matchSubject }
        : {}),
    },
  };
}
