/**
 * Cron is a clock. These two are the other starts: an authenticated inbound POST, and a
 * message arriving at a mapped mailbox. Both resolve the actor from the standing row and
 * enqueue the same `jobs` row. There is no cookie Request.
 */
import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import type { AuditStore } from "../audit";
import { recordAuditEvent } from "../audit";
import type { AppVariables } from "../auth/guards";
import type { ChannelStore } from "../channels/routes";
import { orgIdOf } from "../orgs/constants";
import type { SpendStore } from "../orgs/spend";
import { enqueueUnattendedJob } from "./enqueue";
import { publicJob } from "./routes";
import type { JobStore } from "./store";
import {
  type JobTrigger,
  type JobTriggerKind,
  type JobTriggerStore,
  JOB_TRIGGER_KINDS,
  normalizeMailbox,
  publicJobTrigger,
  sameTriggerSecret,
  sameTriggerSignature,
} from "./triggers";

export type InboundRoutesOptions = {
  requireUser: MiddlewareHandler<{ Variables: AppVariables }>;
  jobStore: JobStore;
  channelStore: ChannelStore;
  triggerStore: JobTriggerStore;
  auditStore?: AuditStore;
  spend?: SpendStore;
};

function presentedSecret(headers: Headers): string {
  const named = headers.get("x-openbot-trigger-secret")?.trim() ?? "";
  if (named) return named;
  const auth = headers.get("authorization") ?? "";
  const match = /^Bearer\s+(\S+)/i.exec(auth);
  return match?.[1] ?? "";
}

function presentedSignature(headers: Headers): string {
  return headers.get("x-openbot-signature")?.trim() ?? "";
}

function authenticateInbound(
  trigger: JobTrigger,
  secret: string,
  rawBody: string,
  signature: string,
): boolean {
  if (!secret || !trigger.secretHash) return false;
  if (!sameTriggerSecret(secret, trigger.secretHash)) return false;
  if (signature && !sameTriggerSignature(secret, rawBody, signature)) {
    return false;
  }
  return true;
}

async function parseJsonObject(
  raw: string,
): Promise<Record<string, unknown> | { error: string }> {
  if (!raw.trim()) return {};
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { error: "Send a JSON object." };
    }
    return value as Record<string, unknown>;
  } catch {
    return { error: "Send a JSON body." };
  }
}

function stringField(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  return typeof value === "string" ? value : "";
}

function promptFromEmail(
  standingPrompt: string,
  message: { from: string; subject: string; text: string },
): string {
  const parts = [
    standingPrompt.trim(),
    message.from ? `From: ${message.from}` : "",
    message.subject ? `Subject: ${message.subject}` : "",
    message.text.trim(),
  ].filter(Boolean);
  return parts.join("\n\n");
}

async function fireStanding(
  options: InboundRoutesOptions,
  trigger: JobTrigger,
  prompt: string,
) {
  if (!trigger.enabled) {
    return {
      ok: false as const,
      error: "This trigger is disabled.",
      status: 409 as const,
    };
  }
  const result = await enqueueUnattendedJob({
    trigger: trigger.kind,
    orgId: trigger.orgId,
    channelId: trigger.channelId,
    goalId: trigger.goalId,
    coworkerId: trigger.coworkerId,
    actingUserId: trigger.actingUserId,
    actorRole: "user",
    prompt,
    expectedThreadId: trigger.threadId,
    lookupChannel: (actor, channelId) =>
      options.channelStore.get(actor, channelId),
    jobStore: options.jobStore,
    ...(options.spend ? { spend: options.spend } : {}),
  });
  if (!result.ok) {
    await options.triggerStore.recordFire(trigger.id, { error: result.error });
    return result;
  }
  await options.triggerStore.recordFire(trigger.id, { enqueued: true });
  if (options.auditStore) {
    await recordAuditEvent(options.auditStore, {
      eventType: "job.enqueued",
      targetType: "job",
      targetId: result.job.id,
      actorUserId: trigger.actingUserId,
      orgId: trigger.orgId,
      payload: {
        channelId: trigger.channelId,
        coworkerId: trigger.coworkerId,
        threadId: result.channel.threadId,
        trigger: trigger.kind,
        triggerId: trigger.id,
      },
    });
  }
  return result;
}

function asKind(value: unknown): JobTriggerKind | null {
  return typeof value === "string" &&
    (JOB_TRIGGER_KINDS as readonly string[]).includes(value)
    ? (value as JobTriggerKind)
    : null;
}

export function createInboundRoutes(options: InboundRoutesOptions) {
  const { requireUser, channelStore, triggerStore } = options;
  const routes = new Hono<{ Variables: AppVariables }>();

  routes.post("/job-triggers", requireUser, async (context) => {
    const actor = context.var.actor;
    const orgId = orgIdOf(actor);
    let body: Record<string, unknown>;
    try {
      body = await context.req.json();
    } catch {
      return context.json({ error: "Send a JSON body." }, 400);
    }
    const kind = asKind(body.kind);
    if (!kind) {
      return context.json(
        { error: "kind must be cron, webhook, or email." },
        400,
      );
    }
    const channelId =
      typeof body.channelId === "string"
        ? body.channelId.trim()
        : typeof body.goalId === "string"
          ? body.goalId.trim()
          : "";
    const goalId =
      typeof body.goalId === "string" ? body.goalId.trim() : channelId;
    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    if (!channelId) {
      return context.json({ error: "A channel is required." }, 400);
    }
    if (kind !== "email" && !prompt) {
      return context.json({ error: "A standing prompt is required." }, 400);
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
      typeof body.coworkerId === "string"
        ? body.coworkerId.trim()
        : typeof body.agentId === "string"
          ? body.agentId.trim()
          : "";
    const coworkerId = requested || channel.agentIds[0] || "";
    if (!coworkerId || !channel.agentIds.includes(coworkerId)) {
      return context.json(
        { error: "That coworker is not in this channel." },
        400,
      );
    }

    const everySeconds =
      typeof body.everySeconds === "number" &&
      Number.isInteger(body.everySeconds)
        ? body.everySeconds
        : typeof body.everySeconds === "string" &&
            /^\d+$/.test(body.everySeconds)
          ? Number(body.everySeconds)
          : undefined;
    if (kind === "cron" && (!everySeconds || everySeconds < 1)) {
      return context.json(
        { error: "everySeconds is required for a cron trigger." },
        400,
      );
    }
    const nextRunAtRaw =
      typeof body.nextRunAt === "string" ? body.nextRunAt.trim() : "";
    const nextRunAt = nextRunAtRaw ? new Date(nextRunAtRaw) : undefined;
    if (nextRunAt && Number.isNaN(nextRunAt.getTime())) {
      return context.json(
        { error: "nextRunAt must be an ISO timestamp." },
        400,
      );
    }
    const mailboxRaw =
      typeof body.mailbox === "string"
        ? body.mailbox
        : typeof body.to === "string"
          ? body.to
          : "";
    const mailbox = normalizeMailbox(mailboxRaw);
    if (kind === "email" && !mailbox) {
      return context.json(
        { error: "A mailbox address is required for inbound email." },
        400,
      );
    }

    const standingPrompt =
      kind === "email"
        ? prompt || "Handle this inbound email as work on this thread."
        : prompt;

    let created: { trigger: JobTrigger; secret?: string };
    try {
      created = await triggerStore.create({
        orgId,
        kind,
        channelId: channel.id,
        goalId: channel.id,
        threadId: channel.threadId,
        coworkerId,
        actingUserId: actor.id,
        prompt: standingPrompt,
        ...(kind === "cron" && everySeconds ? { everySeconds } : {}),
        ...(kind === "cron" && nextRunAt ? { nextRunAt } : {}),
        ...(kind === "email" ? { mailbox } : {}),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/unique|duplicate/i.test(message)) {
        return context.json(
          { error: "That mailbox is already mapped to a goal." },
          409,
        );
      }
      throw error;
    }

    return context.json(
      {
        trigger: publicJobTrigger(created.trigger),
        ...(created.secret ? { secret: created.secret } : {}),
      },
      201,
    );
  });

  routes.get("/job-triggers", requireUser, async (context) => {
    const actor = context.var.actor;
    const orgId = orgIdOf(actor);
    const channelId =
      context.req.query("channelId")?.trim() ||
      context.req.query("goalId")?.trim() ||
      "";
    const listed = await triggerStore.list(orgId);
    const filtered = channelId
      ? listed.filter(
          (row) => row.channelId === channelId || row.goalId === channelId,
        )
      : listed;
    return context.json({ triggers: filtered.map(publicJobTrigger) });
  });

  routes.get("/job-triggers/:triggerId", requireUser, async (context) => {
    const actor = context.var.actor;
    const orgId = orgIdOf(actor);
    const trigger = await triggerStore.get(
      orgId,
      context.req.param("triggerId"),
    );
    if (!trigger) {
      return context.json({ error: "There is no such trigger." }, 404);
    }
    return context.json({ trigger: publicJobTrigger(trigger) });
  });

  routes.patch("/job-triggers/:triggerId", requireUser, async (context) => {
    const actor = context.var.actor;
    const orgId = orgIdOf(actor);
    let body: Record<string, unknown>;
    try {
      body = await context.req.json();
    } catch {
      return context.json({ error: "Send a JSON body." }, 400);
    }
    if (typeof body.enabled !== "boolean") {
      return context.json({ error: "enabled must be true or false." }, 400);
    }
    const updated = await triggerStore.setEnabled(
      orgId,
      context.req.param("triggerId"),
      body.enabled,
    );
    if (!updated) {
      return context.json({ error: "There is no such trigger." }, 404);
    }
    return context.json({ trigger: publicJobTrigger(updated) });
  });

  routes.delete("/job-triggers/:triggerId", requireUser, async (context) => {
    const actor = context.var.actor;
    const orgId = orgIdOf(actor);
    const removed = await triggerStore.remove(
      orgId,
      context.req.param("triggerId"),
    );
    if (!removed) {
      return context.json({ error: "There is no such trigger." }, 404);
    }
    return context.body(null, 204);
  });

  routes.post("/inbound/webhook/:triggerId", async (context) => {
    const raw = await context.req.text();
    const parsed = await parseJsonObject(raw);
    if ("error" in parsed) {
      return context.json({ error: parsed.error }, 400);
    }
    const trigger = await triggerStore.getById(context.req.param("triggerId"));
    if (trigger?.kind !== "webhook") {
      return context.json({ error: "There is no such webhook." }, 404);
    }
    const secret = presentedSecret(context.req.raw.headers);
    const signature = presentedSignature(context.req.raw.headers);
    if (!authenticateInbound(trigger, secret, raw, signature)) {
      return context.json({ error: "The webhook secret is not valid." }, 401);
    }
    const prompt =
      stringField(parsed, "prompt").trim() ||
      stringField(parsed, "text").trim() ||
      trigger.prompt;
    const result = await fireStanding(options, trigger, prompt);
    if (!result.ok) {
      return context.json({ error: result.error }, result.status);
    }
    return context.json({ job: publicJob(result.job) }, 201);
  });

  routes.post("/inbound/email", async (context) => {
    const raw = await context.req.text();
    const parsed = await parseJsonObject(raw);
    if ("error" in parsed) {
      return context.json({ error: parsed.error }, 400);
    }
    const to =
      stringField(parsed, "to").trim() || stringField(parsed, "mailbox").trim();
    if (!to) {
      return context.json({ error: "A mailbox address is required." }, 400);
    }
    const trigger = await triggerStore.getByMailbox(to);
    if (!trigger) {
      return context.json(
        {
          error:
            "That address is not mapped to a goal. Inbound email attaches to an existing channel thread and does not mint one.",
        },
        404,
      );
    }
    const secret = presentedSecret(context.req.raw.headers);
    const signature = presentedSignature(context.req.raw.headers);
    if (!authenticateInbound(trigger, secret, raw, signature)) {
      return context.json({ error: "The inbound secret is not valid." }, 401);
    }
    const from = stringField(parsed, "from").trim();
    const subject = stringField(parsed, "subject").trim();
    const text =
      stringField(parsed, "text").trim() ||
      stringField(parsed, "html").trim() ||
      stringField(parsed, "body").trim();
    if (!text && !subject) {
      return context.json({ error: "A message is required." }, 400);
    }
    const prompt = promptFromEmail(trigger.prompt, { from, subject, text });
    const result = await fireStanding(options, trigger, prompt);
    if (!result.ok) {
      return context.json({ error: result.error }, result.status);
    }
    return context.json({ job: publicJob(result.job) }, 201);
  });

  return routes;
}
