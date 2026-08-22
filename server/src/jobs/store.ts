import { asc, eq, inArray, sql } from "drizzle-orm";
import type { AgentActor } from "../agents/profile-types";
import type { Database } from "../db/client";
import { jobRuns, scheduledJobs } from "../db/schema";
import { nextCronOccurrence } from "./cron";

export type ScheduledJobKind = "cron" | "webhook" | "email";
export type ScheduledJobStatus = "active" | "paused";
export type JobRunStatus = "queued" | "running" | "succeeded" | "failed";
export type JobRunTrigger = "cron" | "webhook" | "email";

export type ScheduledJob = {
  id: string;
  name: string;
  agentId: string;
  kind: ScheduledJobKind;
  cronExpr: string | null;
  weekdayBounded: boolean;
  timezone: string;
  brief: string;
  status: ScheduledJobStatus;
  lastRunAt: Date | null;
  nextRunAt: Date | null;
  hasWebhookSecret: boolean;
  channelId: string | null;
  createdByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type JobRun = {
  id: string;
  jobId: string;
  status: JobRunStatus;
  trigger: JobRunTrigger;
  result: string | null;
  error: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
};

export type CreateScheduledJobInput = {
  name: string;
  agentId: string;
  kind: ScheduledJobKind;
  cronExpr: string | null;
  weekdayBounded: boolean;
  timezone: string;
  brief: string;
  webhookSecretHash: string | null;
  createdBy: AgentActor;
  nextRunAt: Date | null;
};

export type ScheduledJobStore = {
  create(input: CreateScheduledJobInput): Promise<ScheduledJob>;
  get(id: string): Promise<ScheduledJob | null>;
  list(): Promise<ScheduledJob[]>;
  setStatus(
    id: string,
    status: ScheduledJobStatus,
  ): Promise<ScheduledJob | null>;
  remove(id: string): Promise<boolean>;
  attachChannel(id: string, channelId: string): Promise<void>;
  /**
   * Claim due cron jobs and open a run for each, in one transaction.
   *
   * `FOR UPDATE SKIP LOCKED` plus writing the next due time in the same
   * statement is what makes a restart safe: a job whose next time is still
   * in the past is still due. The run row is the in-flight half — if the
   * process dies after the commit, `unfinishedRuns` re-enqueues it rather
   * than losing the occurrence.
   */
  claimDue(
    now: Date,
    limit?: number,
  ): Promise<{ job: ScheduledJob; run: JobRun }[]>;
  /**
   * Queued or running runs left behind by a process that died.
   *
   * The wake is in-process, so a restart loses the in-flight dispatch. These rows
   * are the durable half: the poller re-enqueues them instead of inventing a new run.
   */
  unfinishedRuns(): Promise<JobRun[]>;
  createRun(input: { jobId: string; trigger: JobRunTrigger }): Promise<JobRun>;
  markRunning(id: string): Promise<void>;
  finish(
    id: string,
    status: "succeeded" | "failed",
    result: string | null,
    error: string | null,
  ): Promise<void>;
  listRuns(jobId: string, limit?: number): Promise<JobRun[]>;
  webhookSecretHash(id: string): Promise<string | null>;
};

export function createScheduledJobStore(database: Database): ScheduledJobStore {
  return {
    async create(input) {
      const id = `job_${crypto.randomUUID()}`;
      const [row] = await database
        .insert(scheduledJobs)
        .values({
          id,
          name: input.name,
          agentId: input.agentId,
          kind: input.kind,
          cronExpr: input.cronExpr,
          weekdayBounded: input.weekdayBounded,
          timezone: input.timezone,
          brief: input.brief,
          webhookSecretHash: input.webhookSecretHash,
          createdByUserId: input.createdBy.id,
          nextRunAt: input.nextRunAt,
          status: "active",
        })
        .returning();
      if (!row) throw new Error("The schedule could not be created.");
      return asJob(row);
    },

    async get(id) {
      const [row] = await database
        .select()
        .from(scheduledJobs)
        .where(eq(scheduledJobs.id, id));
      return row ? asJob(row) : null;
    },

    async list() {
      const rows = await database
        .select()
        .from(scheduledJobs)
        .orderBy(asc(scheduledJobs.name), asc(scheduledJobs.createdAt));
      return rows.map(asJob);
    },

    async setStatus(id, status) {
      const [row] = await database
        .update(scheduledJobs)
        .set({ status, updatedAt: new Date() })
        .where(eq(scheduledJobs.id, id))
        .returning();
      return row ? asJob(row) : null;
    },

    async remove(id) {
      const deleted = await database
        .delete(scheduledJobs)
        .where(eq(scheduledJobs.id, id))
        .returning({ id: scheduledJobs.id });
      return deleted.length > 0;
    },

    async attachChannel(id, channelId) {
      await database
        .update(scheduledJobs)
        .set({ channelId, updatedAt: new Date() })
        .where(eq(scheduledJobs.id, id));
    },

    async claimDue(now, limit = 20) {
      const claimed: { job: ScheduledJob; run: JobRun }[] = [];
      for (let i = 0; i < limit; i += 1) {
        const pair = await claimOne(database, now);
        if (!pair) break;
        claimed.push(pair);
      }
      return claimed;
    },

    async unfinishedRuns() {
      const rows = await database
        .select()
        .from(jobRuns)
        .where(inArray(jobRuns.status, ["queued", "running"]))
        .orderBy(asc(jobRuns.createdAt));
      return rows.map(asRun);
    },

    async createRun(input) {
      const id = `run_${crypto.randomUUID()}`;
      const [row] = await database
        .insert(jobRuns)
        .values({
          id,
          jobId: input.jobId,
          trigger: input.trigger,
          status: "queued",
        })
        .returning();
      if (!row) throw new Error("The job run could not be recorded.");
      await database
        .update(scheduledJobs)
        .set({ lastRunAt: new Date(), updatedAt: new Date() })
        .where(eq(scheduledJobs.id, input.jobId));
      return asRun(row);
    },

    async markRunning(id) {
      await database
        .update(jobRuns)
        .set({ status: "running", startedAt: new Date() })
        .where(eq(jobRuns.id, id));
    },

    async finish(id, status, result, error) {
      await database
        .update(jobRuns)
        .set({
          status,
          result,
          error,
          finishedAt: new Date(),
        })
        .where(eq(jobRuns.id, id));
    },

    async listRuns(jobId, limit = 20) {
      const rows = await database
        .select()
        .from(jobRuns)
        .where(eq(jobRuns.jobId, jobId))
        .orderBy(sql`${jobRuns.createdAt} desc`)
        .limit(limit);
      return rows.map(asRun);
    },

    async webhookSecretHash(id) {
      const [row] = await database
        .select({ hash: scheduledJobs.webhookSecretHash })
        .from(scheduledJobs)
        .where(eq(scheduledJobs.id, id));
      return row?.hash ?? null;
    },
  };
}

async function claimOne(
  database: Database,
  now: Date,
): Promise<{ job: ScheduledJob; run: JobRun } | null> {
  return database.transaction(async (tx) => {
    const locked = await tx.execute<{ id: string }>(sql`
      select id from scheduled_jobs
      where status = 'active'
        and kind = 'cron'
        and next_run_at is not null
        and next_run_at <= ${now}
      order by next_run_at
      limit 1
      for update skip locked
    `);
    const id = [...locked][0]?.id;
    if (!id) return null;

    const [row] = await tx
      .select()
      .from(scheduledJobs)
      .where(eq(scheduledJobs.id, id));
    if (!row?.cronExpr) return null;

    const next = nextCronOccurrence(
      row.cronExpr,
      now,
      row.timezone,
      row.weekdayBounded,
    );
    const [updated] = await tx
      .update(scheduledJobs)
      .set({
        lastRunAt: now,
        nextRunAt: next,
        updatedAt: now,
      })
      .where(eq(scheduledJobs.id, id))
      .returning();
    if (!updated) return null;

    const runId = `run_${crypto.randomUUID()}`;
    const [run] = await tx
      .insert(jobRuns)
      .values({
        id: runId,
        jobId: id,
        trigger: "cron",
        status: "queued",
      })
      .returning();
    if (!run) return null;
    return { job: asJob(updated), run: asRun(run) };
  });
}

function asJob(row: typeof scheduledJobs.$inferSelect): ScheduledJob {
  return {
    id: row.id,
    name: row.name,
    agentId: row.agentId,
    kind: row.kind,
    cronExpr: row.cronExpr,
    weekdayBounded: row.weekdayBounded,
    timezone: row.timezone,
    brief: row.brief,
    status: row.status,
    lastRunAt: row.lastRunAt,
    nextRunAt: row.nextRunAt,
    hasWebhookSecret: Boolean(row.webhookSecretHash),
    channelId: row.channelId,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function asRun(row: typeof jobRuns.$inferSelect): JobRun {
  return {
    id: row.id,
    jobId: row.jobId,
    status: row.status,
    trigger: row.trigger,
    result: row.result,
    error: row.error,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    createdAt: row.createdAt,
  };
}
