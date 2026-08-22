import type { AgentActor } from "../agents/profile-types";
import type { AgentProfileStore } from "../agents/profile-store";
import { type AuditStore, recordAuditEvent } from "../audit";
import type { ChannelMessageStore } from "../channels/messages";
import type { ChannelStore } from "../channels/routes";
import type { WakeJob, WakeRunner } from "../channels/wake";
import {
  type ActionPolicy,
  evaluateActionPolicy,
  type PolicyContext,
  type PolicyDecision,
} from "../computer/policy";
import { CronParseError, isValidTimeZone, nextCronOccurrence } from "./cron";
import {
  hashJobSecret,
  looksLikeJobSecret,
  mintJobSecret,
  sameSecretHash,
} from "./secret";
import type {
  JobRun,
  JobRunTrigger,
  ScheduledJob,
  ScheduledJobKind,
  ScheduledJobStore,
} from "./store";

export const CREATE_SCHEDULE_TOOL = "create_schedule";
export const FIRE_SCHEDULE_TOOL = "fire_schedule";

export type CreateScheduleInput = {
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

export type CreateScheduleResult =
  | {
      ok: true;
      job: ScheduledJob;
      /** Present once, on a new webhook job. Never stored in the clear. */
      webhookSecret?: string;
    }
  | { ok: false; error: string; status: 400 | 403 | 404 };

export type FireScheduleResult =
  | { ok: true; run: JobRun; job: ScheduledJob }
  | { ok: false; error: string; status: 400 | 403 | 404 };

export type ScheduleGateway = {
  create(
    actor: AgentActor,
    input: CreateScheduleInput,
  ): Promise<CreateScheduleResult>;
  list(): Promise<ScheduledJob[]>;
  get(id: string): Promise<ScheduledJob | null>;
  listRuns(jobId: string): Promise<JobRun[]>;
  setPaused(
    actor: AgentActor,
    id: string,
    paused: boolean,
  ): Promise<ScheduledJob | null>;
  remove(actor: AgentActor, id: string): Promise<boolean>;
  /**
   * Fire an inbound event (webhook or a later email trigger).
   *
   * HTTP callers must present the webhook secret. In-process callers — the
   * email-trigger PR — pass `trusted: true` so a mailbox fetcher does not
   * have to hold the secret.
   */
  fireInbound(input: {
    jobId: string;
    trigger: Exclude<JobRunTrigger, "cron">;
    secret?: string;
    trusted?: boolean;
    actor?: AgentActor;
    /**
     * In-process only. Replaces the standing brief when waking.
     * Never written to the audit trail — use `inbound` for the envelope.
     */
    wakeBrief?: string;
    /** From / subject / id for the trail. Never a body. */
    inbound?: { from: string; subject: string; id: string };
  }): Promise<FireScheduleResult>;
  /**
   * Claim due cron jobs and dispatch each one. Called by the in-process poller.
   *
   * Returns how many runs were opened, including ones policy then refused —
   * those still wrote an audit row and did not wake anyone.
   */
  dispatchDue(now?: Date): Promise<number>;
  /** Re-enqueue queued/running runs after a restart. */
  recoverUnfinished(): Promise<number>;
};

export function createScheduleGateway(options: {
  jobs: ScheduledJobStore;
  profiles: AgentProfileStore;
  channels: ChannelStore;
  messages: ChannelMessageStore;
  auditStore: AuditStore;
  policy: () => ActionPolicy | undefined;
  deploymentTimezone: string;
  wake: WakeRunner;
}): ScheduleGateway {
  const {
    jobs,
    profiles,
    channels,
    messages,
    auditStore,
    policy,
    deploymentTimezone,
    wake,
  } = options;

  const dispatch = createInProcessDispatch((runId, job) =>
    runWake({
      jobs,
      profiles,
      channels,
      messages,
      wake,
      runId,
      job,
    }),
  );

  const decide = async (input: {
    tool: typeof CREATE_SCHEDULE_TOOL | typeof FIRE_SCHEDULE_TOOL;
    actor: AgentActor;
    botId: string;
    jobId: string;
    text: string;
    inbound?: { from: string; subject: string; id: string };
  }): Promise<{ verdict: PolicyDecision }> => {
    const verdict = evaluateActionPolicy(
      policy(),
      policyContext({
        tool: input.tool,
        botId: input.botId,
        actorId: input.actor.id,
        jobId: input.jobId,
      }),
    );
    await writeAudit(auditStore, {
      actor: input.actor,
      botId: input.botId,
      jobId: input.jobId,
      tool: input.tool,
      text: input.text,
      inbound: input.inbound,
      verdict,
    });
    return { verdict };
  };

  const openAndDispatch = async (
    job: ScheduledJob,
    run: JobRun,
    actor: AgentActor,
    extras?: {
      wakeBrief?: string;
      inbound?: { from: string; subject: string; id: string };
    },
  ): Promise<FireScheduleResult> => {
    const decided = await decide({
      tool: FIRE_SCHEDULE_TOOL,
      actor,
      botId: job.agentId,
      jobId: job.id,
      text: job.brief,
      inbound: extras?.inbound,
    });
    if (!decided.verdict.forward) {
      await jobs.finish(run.id, "failed", null, decided.verdict.reason);
      return { ok: false, error: decided.verdict.reason, status: 403 };
    }
    const wakeJob = extras?.wakeBrief
      ? { ...job, brief: extras.wakeBrief }
      : job;
    dispatch.enqueue(run.id, wakeJob);
    return { ok: true, run, job };
  };

  return {
    async create(actor, input) {
      const name = input.name.trim();
      const brief = input.brief.trim();
      if (!name)
        return { ok: false, error: "A schedule needs a name.", status: 400 };
      if (!brief) {
        return {
          ok: false,
          error: "A schedule needs a brief for the coworker.",
          status: 400,
        };
      }

      const timezone = (input.timezone?.trim() || deploymentTimezone).trim();
      if (!isValidTimeZone(timezone)) {
        return {
          ok: false,
          error: `Unknown timezone: ${timezone}`,
          status: 400,
        };
      }

      const weekdayBounded = input.weekdayBounded !== false;
      let cronExpr: string | null = null;
      let nextRunAt: Date | null = null;
      if (input.kind === "cron") {
        cronExpr = input.cronExpr?.trim() ?? "";
        if (!cronExpr) {
          return {
            ok: false,
            error: "A cron schedule needs a cron expression.",
            status: 400,
          };
        }
        try {
          nextRunAt = nextCronOccurrence(
            cronExpr,
            new Date(),
            timezone,
            weekdayBounded,
          );
        } catch (error) {
          return {
            ok: false,
            error:
              error instanceof CronParseError
                ? error.message
                : "The cron expression is invalid.",
            status: 400,
          };
        }
        if (!nextRunAt) {
          return {
            ok: false,
            error:
              "That schedule never falls on an allowed day. Clear weekday-only, or change the cron.",
            status: 400,
          };
        }
      }

      const profile = await profiles.get(actor, input.agentId);
      if (!profile || profile.deletedAt) {
        return {
          ok: false,
          error: "That coworker could not be found.",
          status: 404,
        };
      }

      const decided = await decide({
        tool: CREATE_SCHEDULE_TOOL,
        actor,
        botId: input.agentId,
        jobId: "",
        text: [name, brief].join("\n"),
      });
      if (!decided.verdict.forward) {
        return { ok: false, error: decided.verdict.reason, status: 403 };
      }

      const webhookSecret =
        input.kind === "webhook" ? mintJobSecret() : undefined;

      const job = await jobs.create({
        name,
        agentId: input.agentId,
        kind: input.kind,
        cronExpr,
        weekdayBounded,
        timezone,
        brief,
        webhookSecretHash: webhookSecret ? hashJobSecret(webhookSecret) : null,
        createdBy: actor,
        nextRunAt,
        matchFrom: input.kind === "email" ? input.matchFrom : null,
        matchTo: input.kind === "email" ? input.matchTo : null,
        matchSubject: input.kind === "email" ? input.matchSubject : null,
      });

      return webhookSecret
        ? { ok: true, job, webhookSecret }
        : { ok: true, job };
    },

    list: () => jobs.list(),
    get: (id) => jobs.get(id),
    listRuns: (jobId) => jobs.listRuns(jobId),

    async setPaused(actor, id, paused) {
      const current = await jobs.get(id);
      if (!current) return null;
      const job = await jobs.setStatus(id, paused ? "paused" : "active");
      if (job) {
        await recordAuditEvent(auditStore, {
          eventType: paused ? "schedule.paused" : "schedule.resumed",
          targetType: "schedule",
          targetId: job.id,
          actorUserId: actor.id,
          payload: { bot: job.agentId, name: job.name },
        });
      }
      return job;
    },

    async remove(actor, id) {
      const current = await jobs.get(id);
      const removed = await jobs.remove(id);
      if (removed && current) {
        await recordAuditEvent(auditStore, {
          eventType: "schedule.deleted",
          targetType: "schedule",
          targetId: id,
          actorUserId: actor.id,
          payload: { bot: current.agentId, name: current.name },
        });
      }
      return removed;
    },

    async fireInbound(input) {
      const job = await jobs.get(input.jobId);
      if (!job)
        return {
          ok: false,
          error: "That schedule was not found.",
          status: 404,
        };
      if (job.status !== "active") {
        return { ok: false, error: "That schedule is paused.", status: 400 };
      }
      if (job.kind === "cron") {
        return {
          ok: false,
          error: "A cron schedule is fired by the poller, not a trigger.",
          status: 400,
        };
      }
      if (input.trigger === "webhook" && job.kind !== "webhook") {
        return {
          ok: false,
          error: "That schedule is not a webhook trigger.",
          status: 400,
        };
      }
      if (
        input.trigger === "email" &&
        job.kind !== "email" &&
        job.kind !== "webhook"
      ) {
        return {
          ok: false,
          error: "That schedule does not accept an inbound email trigger.",
          status: 400,
        };
      }

      if (!input.trusted) {
        const presented = input.secret?.trim() ?? "";
        if (!looksLikeJobSecret(presented)) {
          return {
            ok: false,
            error: "A valid trigger secret is required.",
            status: 403,
          };
        }
        const stored = await jobs.webhookSecretHash(job.id);
        if (!stored || !sameSecretHash(hashJobSecret(presented), stored)) {
          return {
            ok: false,
            error: "A valid trigger secret is required.",
            status: 403,
          };
        }
      }

      const actor = input.actor ?? actorOf(job);
      const run = await jobs.createRun({
        jobId: job.id,
        trigger: input.trigger,
      });
      const extras = input.trusted
        ? {
            ...(input.wakeBrief ? { wakeBrief: input.wakeBrief } : {}),
            ...(input.inbound ? { inbound: input.inbound } : {}),
          }
        : undefined;
      return openAndDispatch(job, run, actor, extras);
    },

    async dispatchDue(now = new Date()) {
      const claimed = await jobs.claimDue(now);
      for (const { job, run } of claimed) {
        await openAndDispatch(job, run, actorOf(job));
      }
      return claimed.length;
    },

    async recoverUnfinished() {
      const unfinished = await jobs.unfinishedRuns();
      let recovered = 0;
      for (const run of unfinished) {
        const job = await jobs.get(run.jobId);
        if (job?.status !== "active") {
          await jobs.finish(
            run.id,
            "failed",
            null,
            job
              ? "The schedule was paused before this run could finish."
              : "The schedule was deleted.",
          );
          continue;
        }
        dispatch.enqueue(run.id, job);
        recovered += 1;
      }
      return recovered;
    },
  };
}

function actorOf(job: ScheduledJob): AgentActor {
  return { id: job.createdByUserId ?? "schedule", role: "admin" };
}

function createInProcessDispatch(
  run: (runId: string, job: ScheduledJob) => Promise<void>,
): { enqueue(runId: string, job: ScheduledJob): void } {
  const inflight = new Set<string>();
  return {
    enqueue(runId, job) {
      if (inflight.has(runId)) return;
      inflight.add(runId);
      void Promise.resolve()
        .then(() => run(runId, job))
        .catch((error) => {
          console.error(
            JSON.stringify({
              type: "schedule-run-failed",
              jobId: job.id,
              runId,
              error: error instanceof Error ? error.message : String(error),
            }),
          );
        })
        .finally(() => {
          inflight.delete(runId);
        });
    },
  };
}

async function runWake(input: {
  jobs: ScheduledJobStore;
  profiles: AgentProfileStore;
  channels: ChannelStore;
  messages: ChannelMessageStore;
  wake: WakeRunner;
  runId: string;
  job: ScheduledJob;
}): Promise<void> {
  const { jobs, profiles, channels, messages, wake, runId, job } = input;
  await jobs.markRunning(runId);
  const actor = actorOf(job);

  const profile = await profiles.get(actor, job.agentId);
  if (!profile || profile.deletedAt) {
    await jobs.finish(
      runId,
      "failed",
      null,
      "That coworker is no longer available.",
    );
    return;
  }

  let channelId = job.channelId;
  if (!channelId) {
    const channel = await channels.create(actor, [job.agentId], {
      kind: "task",
      name: taskName(job.name),
    });
    channelId = channel.id;
    await jobs.attachChannel(job.id, channelId);
  }

  const posted = await messages.post({
    channelId,
    senderAgentId: job.agentId,
    body: job.brief,
    hop: 0,
  });

  const wakeJob: WakeJob = {
    channelId,
    botId: job.agentId,
    actor,
    inbound: posted,
  };

  try {
    const reply = await wake(wakeJob);
    await jobs.finish(runId, "succeeded", reply, null);
  } catch (error) {
    await jobs.finish(
      runId,
      "failed",
      null,
      error instanceof Error ? error.message : String(error),
    );
  }
}

function taskName(name: string): string {
  const trimmed = name.trim() || "Scheduled job";
  return trimmed.length > 80 ? `${trimmed.slice(0, 77)}…` : trimmed;
}

function policyContext(input: {
  tool: string;
  botId: string;
  actorId: string;
  jobId: string;
}): PolicyContext {
  return {
    tool: { name: input.tool },
    bot: { id: input.botId },
    actor: { id: input.actorId },
    page: { url: "", host: "" },
    element: { ref: "", role: "", name: "", type: "" },
    key: "",
    file: { path: "", name: "", extension: "" },
    command: "",
    intent: "schedule",
    channel: { id: input.jobId },
    recipient: { id: input.botId },
  };
}

async function writeAudit(
  auditStore: AuditStore,
  entry: {
    actor: AgentActor;
    botId: string;
    jobId: string;
    tool: string;
    text: string;
    inbound?: { from: string; subject: string; id: string };
    verdict: PolicyDecision;
  },
) {
  const creating = entry.tool === CREATE_SCHEDULE_TOOL;
  await recordAuditEvent(auditStore, {
    eventType: creating
      ? entry.verdict.forward
        ? "schedule.created"
        : "schedule.refused"
      : entry.verdict.forward
        ? "schedule.fired"
        : "schedule.fire_refused",
    targetType: "schedule",
    targetId: entry.jobId || entry.botId,
    actorUserId: entry.actor.id,
    payload: {
      bot: entry.botId,
      actor: entry.actor.id,
      tool: entry.tool,
      text: entry.text,
      ...(entry.inbound
        ? {
            email: {
              from: entry.inbound.from,
              subject: entry.inbound.subject,
              id: entry.inbound.id,
            },
          }
        : {}),
      decision: {
        allowed: entry.verdict.allowed,
        mode: entry.verdict.mode,
        source: entry.verdict.source,
        rule: entry.verdict.matched,
        carriedOut: entry.verdict.forward,
      },
    },
  });
}
