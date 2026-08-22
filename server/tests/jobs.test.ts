import { describe, expect, test } from "bun:test";
import type { AgentActor } from "../src/agents/profile-types";
import type { AgentProfile } from "../src/agents/profile-types";
import type { AuditEventInput, AuditStore } from "../src/audit";
import type { ChannelPostedMessage } from "../src/channels/messages";
import type { AgentChannel, ChannelStore } from "../src/channels/routes";
import type { WakeJob } from "../src/channels/wake";
import type { ActionPolicy } from "../src/computer/policy";
import { createScheduleGateway } from "../src/jobs/gateway";
import type {
  JobRun,
  ScheduledJob,
  ScheduledJobStore,
} from "../src/jobs/store";
import { mintJobSecret } from "../src/jobs/secret";
import { hashJobSecret } from "../src/jobs/secret";

const ACTOR: AgentActor = { id: "admin-1", role: "admin" };
const PERMISSIVE: ActionPolicy = { mode: "enforce", deny: [], allow: ["true"] };
const DENY_SCHEDULE: ActionPolicy = {
  mode: "enforce",
  deny: ['intent == "schedule"'],
  allow: ["true"],
};

function profile(id = "risk"): AgentProfile {
  return {
    id,
    name: "Risk",
    title: "Risk Analyst",
    roleDescription: "Looks at risk.",
    avatarSeed: "risk",
    visibility: "public",
    ownerUserId: ACTOR.id,
    systemOwned: false,
    hidden: false,
    deletedAt: null,
    endpoint: "https://bot.example.test/ag-ui",
    hasAuth: false,
    hasCallbackToken: false,
  };
}

function recorder() {
  const written: AuditEventInput[] = [];
  const auditStore: AuditStore = {
    insert: async (event) => {
      written.push(event);
    },
  };
  return { written, auditStore };
}

function memoryJobs(): ScheduledJobStore & {
  rows: ScheduledJob[];
  runs: JobRun[];
} {
  const rows: ScheduledJob[] = [];
  const runs: JobRun[] = [];
  const hashes = new Map<string, string | null>();

  const asJob = (job: ScheduledJob) => job;

  return {
    rows,
    runs,
    async create(input) {
      const job: ScheduledJob = {
        id: `job_${rows.length + 1}`,
        name: input.name,
        agentId: input.agentId,
        kind: input.kind,
        cronExpr: input.cronExpr,
        weekdayBounded: input.weekdayBounded,
        timezone: input.timezone,
        brief: input.brief,
        status: "active",
        lastRunAt: null,
        nextRunAt: input.nextRunAt,
        hasWebhookSecret: Boolean(input.webhookSecretHash),
        channelId: null,
        createdByUserId: input.createdBy.id,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      rows.push(job);
      hashes.set(job.id, input.webhookSecretHash);
      return asJob(job);
    },
    async get(id) {
      return rows.find((job) => job.id === id) ?? null;
    },
    async list() {
      return [...rows];
    },
    async setStatus(id, status) {
      const job = rows.find((row) => row.id === id);
      if (!job) return null;
      job.status = status;
      return job;
    },
    async remove(id) {
      const index = rows.findIndex((row) => row.id === id);
      if (index < 0) return false;
      rows.splice(index, 1);
      return true;
    },
    async attachChannel(id, channelId) {
      const job = rows.find((row) => row.id === id);
      if (job) job.channelId = channelId;
    },
    async claimDue(now) {
      const due = rows.filter(
        (job) =>
          job.status === "active" &&
          job.kind === "cron" &&
          job.nextRunAt &&
          job.nextRunAt <= now,
      );
      const claimed: { job: ScheduledJob; run: JobRun }[] = [];
      for (const job of due) {
        job.nextRunAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
        job.lastRunAt = now;
        const run: JobRun = {
          id: `run_${runs.length + 1}`,
          jobId: job.id,
          status: "queued",
          trigger: "cron",
          result: null,
          error: null,
          startedAt: null,
          finishedAt: null,
          createdAt: new Date(),
        };
        runs.push(run);
        claimed.push({ job, run });
      }
      return claimed;
    },
    async unfinishedRuns() {
      return runs.filter(
        (run) => run.status === "queued" || run.status === "running",
      );
    },
    async createRun(input) {
      const run: JobRun = {
        id: `run_${runs.length + 1}`,
        jobId: input.jobId,
        status: "queued",
        trigger: input.trigger,
        result: null,
        error: null,
        startedAt: null,
        finishedAt: null,
        createdAt: new Date(),
      };
      runs.push(run);
      return run;
    },
    async markRunning(id) {
      const run = runs.find((row) => row.id === id);
      if (run) {
        run.status = "running";
        run.startedAt = new Date();
      }
    },
    async finish(id, status, result, error) {
      const run = runs.find((row) => row.id === id);
      if (run) {
        run.status = status;
        run.result = result;
        run.error = error;
        run.finishedAt = new Date();
      }
    },
    async listRuns(jobId) {
      return runs.filter((run) => run.jobId === jobId);
    },
    async webhookSecretHash(id) {
      return hashes.get(id) ?? null;
    },
  };
}

function channels(): ChannelStore {
  return {
    create: async () =>
      ({
        id: "channel_task",
        name: "Scheduled",
        agentIds: ["risk"],
        threadId: "thread-1",
        active: true,
        kind: "task",
      }) satisfies AgentChannel,
    get: async () => null,
    list: async () => ({ channels: [], nextCursor: null }),
    recordActivity: async () => undefined,
    update: async () => {
      throw new Error("unused");
    },
    findDirect: async () => null,
    findOrCreateDirect: async () => {
      throw new Error("unused");
    },
  } as ChannelStore;
}

function messages() {
  return {
    post: async (input: {
      channelId: string;
      senderAgentId: string;
      body: string;
      hop: number;
    }) =>
      ({
        id: "msg_1",
        channelId: input.channelId,
        senderAgentId: input.senderAgentId,
        senderName: "Risk",
        body: input.body,
        hop: input.hop,
        createdAt: new Date(),
      }) satisfies ChannelPostedMessage,
    list: async () => [],
  };
}

function gateway(overrides: {
  policy?: ActionPolicy;
  jobs?: ReturnType<typeof memoryJobs>;
  wakes?: WakeJob[];
}) {
  const { written, auditStore } = recorder();
  const jobs = overrides.jobs ?? memoryJobs();
  const wakes: WakeJob[] = overrides.wakes ?? [];
  return {
    written,
    jobs,
    wakes,
    api: createScheduleGateway({
      jobs,
      profiles: {
        get: async (_actor, id) => (id === "missing" ? null : profile(id)),
      } as never,
      channels: channels(),
      messages: messages(),
      auditStore,
      policy: () => overrides.policy ?? PERMISSIVE,
      deploymentTimezone: "UTC",
      wake: async (job) => {
        wakes.push(job);
        return "done";
      },
    }),
  };
}

describe("schedule gateway", () => {
  test("creates a cron job with a next run", async () => {
    const { api, jobs } = gateway({});
    const result = await api.create(ACTOR, {
      name: "Morning brief",
      agentId: "risk",
      kind: "cron",
      cronExpr: "0 9 * * *",
      brief: "Summarise overnight risk.",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.job.nextRunAt).toBeInstanceOf(Date);
    expect(jobs.rows).toHaveLength(1);
  });

  test("policy deny creates nothing", async () => {
    const { api, jobs, written } = gateway({ policy: DENY_SCHEDULE });
    const result = await api.create(ACTOR, {
      name: "Morning brief",
      agentId: "risk",
      kind: "cron",
      cronExpr: "0 9 * * *",
      brief: "Summarise overnight risk.",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(403);
    expect(jobs.rows).toHaveLength(0);
    expect(
      written.some((event) => event.eventType === "schedule.refused"),
    ).toBe(true);
  });

  test("a due cron job wakes the coworker", async () => {
    const jobs = memoryJobs();
    const created = await jobs.create({
      name: "Morning brief",
      agentId: "risk",
      kind: "cron",
      cronExpr: "0 9 * * *",
      weekdayBounded: true,
      timezone: "UTC",
      brief: "Summarise overnight risk.",
      webhookSecretHash: null,
      createdBy: ACTOR,
      nextRunAt: new Date("2020-01-01T00:00:00.000Z"),
    });
    const wakes: WakeJob[] = [];
    const { api } = gateway({ jobs, wakes });
    const count = await api.dispatchDue(new Date("2026-01-15T10:00:00.000Z"));
    expect(count).toBe(1);
    await Bun.sleep(20);
    expect(wakes).toHaveLength(1);
    expect(wakes[0]?.botId).toBe("risk");
    expect(wakes[0]?.inbound.body).toBe("Summarise overnight risk.");
    expect(created.id).toBe(jobs.rows[0]?.id);
  });

  test("pause stops a due job from firing", async () => {
    const jobs = memoryJobs();
    const job = await jobs.create({
      name: "Morning brief",
      agentId: "risk",
      kind: "cron",
      cronExpr: "0 9 * * *",
      weekdayBounded: true,
      timezone: "UTC",
      brief: "Summarise overnight risk.",
      webhookSecretHash: null,
      createdBy: ACTOR,
      nextRunAt: new Date("2020-01-01T00:00:00.000Z"),
    });
    const { api, wakes } = gateway({ jobs });
    await api.setPaused(ACTOR, job.id, true);
    const count = await api.dispatchDue(new Date("2026-01-15T10:00:00.000Z"));
    expect(count).toBe(0);
    await Bun.sleep(10);
    expect(wakes).toHaveLength(0);
  });

  test("a webhook trigger enqueues a run", async () => {
    const secret = mintJobSecret();
    const jobs = memoryJobs();
    const job = await jobs.create({
      name: "On mail",
      agentId: "risk",
      kind: "webhook",
      cronExpr: null,
      weekdayBounded: true,
      timezone: "UTC",
      brief: "A trigger arrived.",
      webhookSecretHash: hashJobSecret(secret),
      createdBy: ACTOR,
      nextRunAt: null,
    });
    const { api, wakes } = gateway({ jobs });
    const result = await api.fireInbound({
      jobId: job.id,
      trigger: "webhook",
      secret,
    });
    expect(result.ok).toBe(true);
    await Bun.sleep(20);
    expect(wakes).toHaveLength(1);
    expect(jobs.runs).toHaveLength(1);
    expect(jobs.runs[0]?.trigger).toBe("webhook");
  });

  test("a restart still sees unfinished work", async () => {
    const jobs = memoryJobs();
    const job = await jobs.create({
      name: "Morning brief",
      agentId: "risk",
      kind: "cron",
      cronExpr: "0 9 * * *",
      weekdayBounded: true,
      timezone: "UTC",
      brief: "Summarise overnight risk.",
      webhookSecretHash: null,
      createdBy: ACTOR,
      nextRunAt: new Date("2026-01-16T09:00:00.000Z"),
    });
    await jobs.createRun({ jobId: job.id, trigger: "cron" });
    const { api, wakes } = gateway({ jobs });
    const recovered = await api.recoverUnfinished();
    expect(recovered).toBe(1);
    await Bun.sleep(20);
    expect(wakes).toHaveLength(1);
  });

  test("policy deny on fire writes a refusal and does not wake", async () => {
    const secret = mintJobSecret();
    const jobs = memoryJobs();
    const job = await jobs.create({
      name: "On mail",
      agentId: "risk",
      kind: "webhook",
      cronExpr: null,
      weekdayBounded: true,
      timezone: "UTC",
      brief: "A trigger arrived.",
      webhookSecretHash: hashJobSecret(secret),
      createdBy: ACTOR,
      nextRunAt: null,
    });
    const { api, wakes, written } = gateway({ jobs, policy: DENY_SCHEDULE });
    const result = await api.fireInbound({
      jobId: job.id,
      trigger: "webhook",
      secret,
    });
    expect(result.ok).toBe(false);
    await Bun.sleep(10);
    expect(wakes).toHaveLength(0);
    expect(
      written.some((event) => event.eventType === "schedule.fire_refused"),
    ).toBe(true);
  });
});
