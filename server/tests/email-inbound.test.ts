import { describe, expect, test } from "bun:test";
import type { AgentActor } from "../src/agents/profile-types";
import type { AuditEventInput } from "../src/audit";
import type { ActionPolicy } from "../src/computer/policy";
import { memoryInboxCursorStore } from "../src/email/cursor";
import {
  composeInboundBrief,
  messageMatchesJob,
  pollInboundEmail,
} from "../src/email/inbound";
import type { EmailMailbox, EmailMailboxes } from "../src/email/mailbox";
import type { EmailTransport, InboxMessage } from "../src/email/transport";
import { createScheduleGateway } from "../src/jobs/gateway";
import type {
  JobRun,
  ScheduledJob,
  ScheduledJobStore,
} from "../src/jobs/store";
import type { WakeJob } from "../src/channels/wake";
import type { ChannelPostedMessage } from "../src/channels/messages";
import type { AgentChannel, ChannelStore } from "../src/channels/routes";
import type { AgentProfile } from "../src/agents/profile-types";

const ACTOR: AgentActor = { id: "admin-1", role: "admin" };
const PERMISSIVE: ActionPolicy = { mode: "enforce", deny: [], allow: ["true"] };
const DENY_SCHEDULE: ActionPolicy = {
  mode: "enforce",
  deny: ['intent == "schedule"'],
  allow: ["true"],
};

const IMAP: EmailMailbox = {
  host: "imap.example.com",
  port: 993,
  secure: true,
  user: "bot@example.com",
  password: "super-secret-password",
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
  return {
    written,
    auditStore: {
      insert: async (event: AuditEventInput) => written.push(event),
    },
  };
}

function memoryJobs(): ScheduledJobStore & {
  rows: ScheduledJob[];
  runs: JobRun[];
} {
  const rows: ScheduledJob[] = [];
  const runs: JobRun[] = [];
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
        matchFrom: input.matchFrom ?? null,
        matchTo: input.matchTo ?? null,
        matchSubject: input.matchSubject ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      rows.push(job);
      return job;
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
    async remove() {
      return false;
    },
    async attachChannel(id, channelId) {
      const job = rows.find((row) => row.id === id);
      if (job) job.channelId = channelId;
    },
    async claimDue() {
      return [];
    },
    async unfinishedRuns() {
      return [];
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
    async webhookSecretHash() {
      return null;
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

function fakeInbox() {
  const items: InboxMessage[] = [];
  let nextId = 1;
  let uidValidity = 1;
  const transport: EmailTransport = {
    send: async () => {
      throw new Error("must not send");
    },
    list: async (_mailbox, options) => {
      let listed = [...items];
      const afterUid = options.afterUid;
      if (afterUid != null) {
        listed = listed.filter((message) => Number(message.id) > afterUid);
        listed.sort((a, b) => Number(a.id) - Number(b.id));
      } else {
        listed.sort((a, b) => Number(b.id) - Number(a.id));
      }
      return listed.slice(0, options.limit);
    },
    read: async (_mailbox, id) =>
      items.find((message) => message.id === id) ?? null,
    inspect: async () => ({
      uidValidity,
      maxUid:
        items.length === 0
          ? 0
          : Math.max(...items.map((message) => Number(message.id))),
    }),
  };
  return {
    transport,
    push(partial: Omit<InboxMessage, "id"> & { id?: string }): InboxMessage {
      const message: InboxMessage = {
        id: partial.id ?? String(nextId++),
        ...partial,
      };
      nextId = Math.max(nextId, Number(message.id) + 1);
      items.push(message);
      return message;
    },
    resetValidity(value: number) {
      uidValidity = value;
    },
  };
}

function setup(
  overrides: { policy?: ActionPolicy; mailboxes?: EmailMailboxes } = {},
) {
  const { written, auditStore } = recorder();
  const jobs = memoryJobs();
  const wakes: WakeJob[] = [];
  const inbox = fakeInbox();
  const cursors = memoryInboxCursorStore();
  const api = createScheduleGateway({
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
  });
  const poll = () =>
    pollInboundEmail({
      resolve: async () => overrides.mailboxes ?? { smtp: null, imap: IMAP },
      transport: inbox.transport,
      cursors,
      gateway: api,
    });
  return { api, jobs, wakes, written, inbox, cursors, poll };
}

describe("inbound email brief", () => {
  test("includes from, subject, id and a short body", () => {
    const brief = composeInboundBrief("Triage inbound mail.", {
      id: "18",
      from: "Alice <alice@example.com>",
      to: ["bot@example.com"],
      subject: "Quarterly report",
      snippet: "Please find the figures.",
      body: "Please find the figures.\n\nConfidential revenue: 12 million.",
    });
    expect(brief).toContain("Triage inbound mail.");
    expect(brief).toContain("id: 18");
    expect(brief).toContain("from: Alice <alice@example.com>");
    expect(brief).toContain("subject: Quarterly report");
    expect(brief).toContain("Confidential revenue: 12 million.");
  });

  test("an empty filter matches; a from filter is a substring", () => {
    const message = {
      from: "Alice <alice@example.com>",
      to: ["bot@example.com"],
      subject: "Quarterly report",
    };
    expect(
      messageMatchesJob(message, {
        matchFrom: null,
        matchTo: null,
        matchSubject: null,
      }),
    ).toBe(true);
    expect(
      messageMatchesJob(message, {
        matchFrom: "alice@example.com",
        matchTo: null,
        matchSubject: null,
      }),
    ).toBe(true);
    expect(
      messageMatchesJob(message, {
        matchFrom: "bob@",
        matchTo: null,
        matchSubject: null,
      }),
    ).toBe(false);
  });
});

describe("inbound email poller", () => {
  test("a new message enqueues a run and wakes the coworker", async () => {
    const { api, inbox, poll, wakes, jobs, written } = setup();
    await api.create(ACTOR, {
      name: "On mail",
      agentId: "risk",
      kind: "email",
      brief: "Triage inbound mail.",
    });
    inbox.push({
      from: "Old <old@example.com>",
      to: ["bot@example.com"],
      subject: "Already there",
      date: "2026-08-21T10:00:00.000Z",
      snippet: "Old news.",
      body: "Old news.",
    });
    const seeded = await poll();
    expect(seeded.seeded).toBe(true);
    expect(seeded.fired).toBe(0);
    await Bun.sleep(20);
    expect(wakes).toHaveLength(0);

    const fresh = inbox.push({
      from: "Alice <alice@example.com>",
      to: ["bot@example.com"],
      subject: "Quarterly report",
      date: "2026-08-22T10:00:00.000Z",
      snippet: "Please find the figures attached.",
      body: "Please find the figures attached.\n\nConfidential revenue: 12 million.",
    });
    const tick = await poll();
    expect(tick.fired).toBe(1);
    await Bun.sleep(20);
    expect(wakes).toHaveLength(1);
    expect(wakes[0]?.botId).toBe("risk");
    expect(wakes[0]?.inbound.body).toContain("Triage inbound mail.");
    expect(wakes[0]?.inbound.body).toContain(`id: ${fresh.id}`);
    expect(wakes[0]?.inbound.body).toContain("from: Alice <alice@example.com>");
    expect(wakes[0]?.inbound.body).toContain("subject: Quarterly report");
    expect(wakes[0]?.inbound.body).toContain(
      "Confidential revenue: 12 million.",
    );
    expect(jobs.runs).toHaveLength(1);
    expect(jobs.runs[0]?.trigger).toBe("email");
    expect(written.some((event) => event.eventType === "schedule.fired")).toBe(
      true,
    );
    expect(JSON.stringify(written)).not.toContain("Confidential revenue");
    expect(JSON.stringify(written)).not.toContain("super-secret-password");
  });

  test("a seen message does not fire twice", async () => {
    const { api, inbox, poll, wakes } = setup();
    await api.create(ACTOR, {
      name: "On mail",
      agentId: "risk",
      kind: "email",
      brief: "Triage inbound mail.",
    });
    await poll();
    inbox.push({
      from: "Alice <alice@example.com>",
      to: ["bot@example.com"],
      subject: "Once",
      date: "2026-08-22T10:00:00.000Z",
      snippet: "Only once.",
      body: "Only once.",
    });
    expect((await poll()).fired).toBe(1);
    await Bun.sleep(20);
    expect(wakes).toHaveLength(1);
    expect((await poll()).fired).toBe(0);
    await Bun.sleep(10);
    expect(wakes).toHaveLength(1);
  });

  test("pause stops it", async () => {
    const { api, inbox, poll, wakes, jobs } = setup();
    const created = await api.create(ACTOR, {
      name: "On mail",
      agentId: "risk",
      kind: "email",
      brief: "Triage inbound mail.",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    await poll();
    await api.setPaused(ACTOR, created.job.id, true);
    inbox.push({
      from: "Alice <alice@example.com>",
      to: ["bot@example.com"],
      subject: "While paused",
      date: "2026-08-22T10:00:00.000Z",
      snippet: "Should not wake.",
      body: "Should not wake.",
    });
    const tick = await poll();
    expect(tick.fired).toBe(0);
    await Bun.sleep(10);
    expect(wakes).toHaveLength(0);
    expect(jobs.runs).toHaveLength(0);
  });

  test("policy deny writes a refusal and does not wake", async () => {
    const { inbox, poll, wakes, written, jobs } = setup({
      policy: DENY_SCHEDULE,
    });
    await jobs.create({
      name: "On mail",
      agentId: "risk",
      kind: "email",
      cronExpr: null,
      weekdayBounded: true,
      timezone: "UTC",
      brief: "Triage inbound mail.",
      webhookSecretHash: null,
      createdBy: ACTOR,
      nextRunAt: null,
    });
    await poll();
    inbox.push({
      from: "Alice <alice@example.com>",
      to: ["bot@example.com"],
      subject: "Denied",
      date: "2026-08-22T10:00:00.000Z",
      snippet: "Should not wake.",
      body: "Should not wake.",
    });
    const tick = await poll();
    expect(tick.fired).toBe(0);
    await Bun.sleep(10);
    expect(wakes).toHaveLength(0);
    expect(
      written.some((event) => event.eventType === "schedule.fire_refused"),
    ).toBe(true);
    expect(JSON.stringify(written)).not.toContain("Should not wake.");
  });

  test("a from filter skips non-matching mail", async () => {
    const { api, inbox, poll, wakes } = setup();
    await api.create(ACTOR, {
      name: "On mail",
      agentId: "risk",
      kind: "email",
      brief: "Triage inbound mail.",
      matchFrom: "alice@",
    });
    await poll();
    inbox.push({
      from: "Bob <bob@example.com>",
      to: ["bot@example.com"],
      subject: "Noise",
      date: "2026-08-22T10:00:00.000Z",
      snippet: "Ignore.",
      body: "Ignore.",
    });
    expect((await poll()).examined).toBe(1);
    await Bun.sleep(10);
    expect(wakes).toHaveLength(0);
    inbox.push({
      from: "Alice <alice@example.com>",
      to: ["bot@example.com"],
      subject: "Match",
      date: "2026-08-22T10:01:00.000Z",
      snippet: "Act.",
      body: "Act.",
    });
    expect((await poll()).fired).toBe(1);
    await Bun.sleep(20);
    expect(wakes).toHaveLength(1);
  });

  test("absent IMAP does not fire", async () => {
    const { api, inbox, poll, wakes } = setup({
      mailboxes: { smtp: null, imap: null },
    });
    await api.create(ACTOR, {
      name: "On mail",
      agentId: "risk",
      kind: "email",
      brief: "Triage inbound mail.",
    });
    inbox.push({
      from: "Alice <alice@example.com>",
      to: ["bot@example.com"],
      subject: "Hello",
      date: "2026-08-22T10:00:00.000Z",
      snippet: "Hi.",
      body: "Hi.",
    });
    expect((await poll()).fired).toBe(0);
    expect(wakes).toHaveLength(0);
  });
});
