import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createAgentProfileStore } from "../src/agents/profile-store";
import type { AgentActor } from "../src/agents/profile-types";
import type { AuditEventInput, AuditStore } from "../src/audit";
import { createChannelMessageStore } from "../src/channels/messages";
import { createChannelStore } from "../src/channels/routes";
import { createThreadIdentity } from "../src/channels/thread-identity";
import type { WakeJob } from "../src/channels/wake";
import type { ActionPolicy } from "../src/computer/policy";
import { createDatabase } from "../src/db/client";
import {
  agentProfiles,
  agents,
  channels,
  emailInboxCursors,
  intelligenceChannelMappings,
  jobRuns,
  scheduledJobs,
  users,
} from "../src/db/schema";
import { createInboxCursorStore, mailboxKey } from "../src/email/cursor";
import { pollInboundEmail } from "../src/email/inbound";
import type { EmailMailbox } from "../src/email/mailbox";
import type { EmailTransport, InboxMessage } from "../src/email/transport";
import { createScheduleGateway } from "../src/jobs/gateway";
import { createScheduledJobStore } from "../src/jobs/store";
import { TEST_POOL } from "./support/database";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgres://openbot:openbot@localhost:5432/openbot";
const database = createDatabase(databaseUrl, TEST_POOL);
const profileStore = createAgentProfileStore(
  database,
  new URL("https://managed.example.test/ag-ui"),
);
const channelStore = createChannelStore(
  database,
  profileStore,
  createThreadIdentity("test-deployment"),
);
const messages = createChannelMessageStore(database);
const jobs = createScheduledJobStore(database);
const cursors = createInboxCursorStore(database);

const IMAP: EmailMailbox = {
  host: "imap.example.com",
  port: 993,
  secure: true,
  user: `bot-${randomUUID()}@example.com`,
  password: "super-secret-password",
};

const testPrefix = `email-inbound-${randomUUID()}`;
const createdUserIds: string[] = [];
const createdAgentIds: string[] = [];
const createdJobIds: string[] = [];
const createdChannelIds: string[] = [];
const createdCursorKeys = [mailboxKey(IMAP)];

afterEach(async () => {
  for (const jobId of createdJobIds.splice(0)) {
    await database.delete(jobRuns).where(eq(jobRuns.jobId, jobId));
    await database.delete(scheduledJobs).where(eq(scheduledJobs.id, jobId));
  }
  for (const channelId of createdChannelIds.splice(0)) {
    await database
      .delete(intelligenceChannelMappings)
      .where(eq(intelligenceChannelMappings.channelId, channelId));
    await database.delete(channels).where(eq(channels.id, channelId));
  }
  for (const agentId of createdAgentIds.splice(0)) {
    await database
      .delete(agentProfiles)
      .where(eq(agentProfiles.agentId, agentId));
    await database.delete(agents).where(eq(agents.id, agentId));
  }
  for (const userId of createdUserIds.splice(0)) {
    await database.delete(users).where(eq(users.id, userId));
  }
  for (const key of createdCursorKeys) {
    await database
      .delete(emailInboxCursors)
      .where(eq(emailInboxCursors.mailboxKey, key));
  }
});

afterAll(async () => {
  await database.$client.close();
});

async function createUser(): Promise<AgentActor> {
  const id = `${testPrefix}-user-${randomUUID()}`;
  await database.insert(users).values({
    id,
    email: `${id}@example.test`,
    name: "Email Inbound Test User",
  });
  createdUserIds.push(id);
  return { id, role: "admin" };
}

async function createAgent(owner: AgentActor, name: string) {
  const profile = await profileStore.create(owner, {
    name,
    title: `${name} title`,
    roleDescription: `${name} role`,
    visibility: "private",
  });
  createdAgentIds.push(profile.id);
  return profile.id;
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

const PERMISSIVE: ActionPolicy = { mode: "enforce", deny: [], allow: ["true"] };
const DENY: ActionPolicy = {
  mode: "enforce",
  deny: ['intent == "schedule"'],
  allow: ["true"],
};

function fakeInbox() {
  const items: InboxMessage[] = [];
  let nextId = 1;
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
      uidValidity: 1,
      maxUid:
        items.length === 0
          ? 0
          : Math.max(...items.map((message) => Number(message.id))),
    }),
  };
  return {
    transport,
    push(partial: Omit<InboxMessage, "id">): InboxMessage {
      const message: InboxMessage = { id: String(nextId++), ...partial };
      items.push(message);
      return message;
    },
  };
}

function gateway(
  policy: ActionPolicy,
  wakes: WakeJob[],
  auditStore: AuditStore,
) {
  return createScheduleGateway({
    jobs,
    profiles: profileStore,
    channels: channelStore,
    messages,
    auditStore,
    policy: () => policy,
    deploymentTimezone: "UTC",
    wake: async (job) => {
      wakes.push(job);
      if (job.channelId) createdChannelIds.push(job.channelId);
      return "ok";
    },
  });
}

describe("inbound email against Postgres", () => {
  test("a new message enqueues a run; a restart does not re-fire it", async () => {
    const actor = await createUser();
    const risk = await createAgent(actor, "Risk");
    const { written, auditStore } = recorder();
    const wakes: WakeJob[] = [];
    const api = gateway(PERMISSIVE, wakes, auditStore);
    const inbox = fakeInbox();

    const created = await api.create(actor, {
      name: "On mail",
      agentId: risk,
      kind: "email",
      brief: "Triage inbound mail.",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    createdJobIds.push(created.job.id);

    const poller = {
      resolve: async () => ({ smtp: null, imap: IMAP }),
      transport: inbox.transport,
      cursors,
      gateway: api,
    };

    inbox.push({
      from: "Old <old@example.com>",
      to: ["bot@example.com"],
      subject: "Already there",
      date: "2026-08-21T10:00:00.000Z",
      snippet: "Old news.",
      body: "Old news.",
    });
    expect((await pollInboundEmail(poller)).seeded).toBe(true);
    await Bun.sleep(20);
    expect(wakes).toHaveLength(0);

    const fresh = inbox.push({
      from: "Alice <alice@example.com>",
      to: ["bot@example.com"],
      subject: "Quarterly report",
      date: "2026-08-22T10:00:00.000Z",
      snippet: "Please find the figures.",
      body: "Please find the figures.\n\nConfidential revenue: 12 million.",
    });
    expect((await pollInboundEmail(poller)).fired).toBe(1);
    await Bun.sleep(40);
    expect(wakes).toHaveLength(1);
    expect(wakes[0]?.inbound.body).toContain(`id: ${fresh.id}`);
    const stored = await jobs.listRuns(created.job.id);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.trigger).toBe("email");
    expect(written.some((event) => event.eventType === "schedule.fired")).toBe(
      true,
    );
    expect(JSON.stringify(written)).not.toContain("Confidential revenue");
    expect(JSON.stringify(written)).not.toContain("super-secret-password");

    const persisted = await cursors.get(mailboxKey(IMAP));
    expect(persisted?.lastUid).toBe(Number(fresh.id));

    const restarted = createInboxCursorStore(database);
    wakes.splice(0);
    const again = await pollInboundEmail({
      ...poller,
      cursors: restarted,
    });
    expect(again.fired).toBe(0);
    await Bun.sleep(20);
    expect(wakes).toHaveLength(0);
  });

  test("pause stops a new message from waking", async () => {
    const actor = await createUser();
    const risk = await createAgent(actor, "Risk");
    const { auditStore } = recorder();
    const wakes: WakeJob[] = [];
    const api = gateway(PERMISSIVE, wakes, auditStore);
    const inbox = fakeInbox();

    const created = await api.create(actor, {
      name: "On mail",
      agentId: risk,
      kind: "email",
      brief: "Triage inbound mail.",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    createdJobIds.push(created.job.id);

    const poller = {
      resolve: async () => ({ smtp: null, imap: IMAP }),
      transport: inbox.transport,
      cursors,
      gateway: api,
    };
    await pollInboundEmail(poller);
    await api.setPaused(actor, created.job.id, true);
    inbox.push({
      from: "Alice <alice@example.com>",
      to: ["bot@example.com"],
      subject: "While paused",
      date: "2026-08-22T10:00:00.000Z",
      snippet: "Should not wake.",
      body: "Should not wake.",
    });
    expect((await pollInboundEmail(poller)).fired).toBe(0);
    await Bun.sleep(20);
    expect(wakes).toHaveLength(0);
  });

  test("policy deny writes a refusal and does not wake", async () => {
    const actor = await createUser();
    const risk = await createAgent(actor, "Risk");
    const { written, auditStore } = recorder();
    const wakes: WakeJob[] = [];
    const job = await jobs.create({
      name: "On mail",
      agentId: risk,
      kind: "email",
      cronExpr: null,
      weekdayBounded: true,
      timezone: "UTC",
      brief: "Triage inbound mail.",
      webhookSecretHash: null,
      createdBy: actor,
      nextRunAt: null,
    });
    createdJobIds.push(job.id);

    const api = gateway(DENY, wakes, auditStore);
    const inbox = fakeInbox();
    const poller = {
      resolve: async () => ({ smtp: null, imap: IMAP }),
      transport: inbox.transport,
      cursors,
      gateway: api,
    };
    await pollInboundEmail(poller);
    inbox.push({
      from: "Alice <alice@example.com>",
      to: ["bot@example.com"],
      subject: "Denied",
      date: "2026-08-22T10:00:00.000Z",
      snippet: "Should not wake.",
      body: "Should not wake.",
    });
    expect((await pollInboundEmail(poller)).fired).toBe(0);
    await Bun.sleep(20);
    expect(wakes).toHaveLength(0);
    expect(
      written.some((event) => event.eventType === "schedule.fire_refused"),
    ).toBe(true);
    expect(JSON.stringify(written)).not.toContain("Should not wake.");
  });
});
