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
  intelligenceChannelMappings,
  jobRuns,
  scheduledJobs,
  users,
} from "../src/db/schema";
import { createScheduleGateway } from "../src/jobs/gateway";
import { createScheduledJobStore } from "../src/jobs/store";
import { hashJobSecret, mintJobSecret } from "../src/jobs/secret";
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

const testPrefix = `schedules-${randomUUID()}`;
const createdUserIds: string[] = [];
const createdAgentIds: string[] = [];
const createdJobIds: string[] = [];
const createdChannelIds: string[] = [];

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
});

afterAll(async () => {
  await database.$client.close();
});

async function createUser(): Promise<AgentActor> {
  const id = `${testPrefix}-user-${randomUUID()}`;
  await database.insert(users).values({
    id,
    email: `${id}@example.test`,
    name: "Schedule Test User",
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

function api(policy: ActionPolicy, wakes: WakeJob[], auditStore: AuditStore) {
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

describe("scheduled jobs against Postgres", () => {
  test("creates a cron job, a due job wakes a coworker, pause stops it", async () => {
    const actor = await createUser();
    const risk = await createAgent(actor, "Risk");
    const { written, auditStore } = recorder();
    const wakes: WakeJob[] = [];
    const gateway = api(PERMISSIVE, wakes, auditStore);

    const created = await gateway.create(actor, {
      name: "Morning brief",
      agentId: risk,
      kind: "cron",
      cronExpr: "0 9 * * *",
      brief: "Summarise overnight risk.",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    createdJobIds.push(created.job.id);
    expect(created.job.nextRunAt).toBeTruthy();
    expect(
      written.some((event) => event.eventType === "schedule.created"),
    ).toBe(true);

    await database
      .update(scheduledJobs)
      .set({ nextRunAt: new Date("2020-01-01T00:00:00.000Z") })
      .where(eq(scheduledJobs.id, created.job.id));

    const claimed = await gateway.dispatchDue(
      new Date("2026-01-15T10:00:00.000Z"),
    );
    expect(claimed).toBe(1);
    await Bun.sleep(40);
    expect(wakes).toHaveLength(1);
    expect(wakes[0]?.botId).toBe(risk);
    expect(wakes[0]?.inbound.body).toBe("Summarise overnight risk.");

    await gateway.setPaused(actor, created.job.id, true);
    wakes.splice(0);
    await database
      .update(scheduledJobs)
      .set({ nextRunAt: new Date("2020-01-01T00:00:00.000Z") })
      .where(eq(scheduledJobs.id, created.job.id));
    const afterPause = await gateway.dispatchDue(
      new Date("2026-01-15T11:00:00.000Z"),
    );
    expect(afterPause).toBe(0);
    await Bun.sleep(20);
    expect(wakes).toHaveLength(0);
  });

  test("a webhook trigger enqueues a run", async () => {
    const actor = await createUser();
    const risk = await createAgent(actor, "Risk");
    const { auditStore } = recorder();
    const wakes: WakeJob[] = [];
    const gateway = api(PERMISSIVE, wakes, auditStore);

    const created = await gateway.create(actor, {
      name: "Inbound",
      agentId: risk,
      kind: "webhook",
      brief: "A trigger arrived.",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    createdJobIds.push(created.job.id);
    expect(created.webhookSecret).toBeTruthy();

    const fired = await gateway.fireInbound({
      jobId: created.job.id,
      trigger: "webhook",
      secret: created.webhookSecret,
    });
    expect(fired.ok).toBe(true);
    await Bun.sleep(40);
    expect(wakes).toHaveLength(1);
    const stored = await jobs.listRuns(created.job.id);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.trigger).toBe("webhook");
  });

  test("policy deny creates nothing", async () => {
    const actor = await createUser();
    const risk = await createAgent(actor, "Risk");
    const { written, auditStore } = recorder();
    const gateway = api(DENY, [], auditStore);

    const created = await gateway.create(actor, {
      name: "Morning brief",
      agentId: risk,
      kind: "cron",
      cronExpr: "0 9 * * *",
      brief: "Summarise overnight risk.",
    });
    expect(created.ok).toBe(false);
    const listed = await jobs.list();
    expect(listed.some((job) => job.agentId === risk)).toBe(false);
    expect(
      written.some((event) => event.eventType === "schedule.refused"),
    ).toBe(true);
  });

  test("restart still sees due work and unfinished runs", async () => {
    const actor = await createUser();
    const risk = await createAgent(actor, "Risk");
    const { auditStore } = recorder();
    const wakes: WakeJob[] = [];
    const gateway = api(PERMISSIVE, wakes, auditStore);

    const secret = mintJobSecret();
    const job = await jobs.create({
      name: "Due after restart",
      agentId: risk,
      kind: "cron",
      cronExpr: "0 9 * * *",
      weekdayBounded: true,
      timezone: "UTC",
      brief: "Still due.",
      webhookSecretHash: hashJobSecret(secret),
      createdBy: actor,
      nextRunAt: new Date("2020-01-01T00:00:00.000Z"),
    });
    createdJobIds.push(job.id);

    const claimed = await gateway.dispatchDue(
      new Date("2026-01-15T10:00:00.000Z"),
    );
    expect(claimed).toBe(1);
    await Bun.sleep(40);
    expect(wakes).toHaveLength(1);

    const leftover = await jobs.createRun({ jobId: job.id, trigger: "cron" });
    wakes.splice(0);
    const recovered = await gateway.recoverUnfinished();
    expect(recovered).toBeGreaterThanOrEqual(1);
    await Bun.sleep(40);
    expect(wakes.some((wake) => wake.inbound.body === "Still due.")).toBe(true);
    expect(leftover.jobId).toBe(job.id);
  });
});
