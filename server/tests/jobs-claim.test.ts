import { afterAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { createAgentProfileStore } from "../src/agents/profile-store";
import type { AgentActor } from "../src/agents/profile-types";
import { createChannelStore } from "../src/channels/routes";
import { createThreadIdentity } from "../src/channels/thread-identity";
import { createDatabase } from "../src/db/client";
import {
  agentProfiles,
  agents,
  channels,
  intelligenceChannelMappings,
  jobs,
  users,
} from "../src/db/schema";
import {
  CLAIM_QUEUED_JOB_SQL,
  createJobStore,
  parseClaimedIds,
} from "../src/jobs/store";
import { TEST_POOL } from "./support/database";
import {
  ensureLocalOrganization,
  seedMembership,
} from "./support/organization";

describe("unattended job claim", () => {
  test("locks with FOR UPDATE SKIP LOCKED so two workers cannot take the same row", () => {
    expect(CLAIM_QUEUED_JOB_SQL).toContain("FOR UPDATE SKIP LOCKED");
    expect(CLAIM_QUEUED_JOB_SQL).toContain("status = 'queued'");
    expect(CLAIM_QUEUED_JOB_SQL).toContain("running.status = 'running'");
  });

  test("claim is one UPDATE, not a drizzle transaction that can deadlock bun-sql", async () => {
    const source = await Bun.file(
      new URL("../src/jobs/store.ts", import.meta.url),
    ).text();
    const start = source.indexOf("async claim()");
    const end = source.indexOf("async finish", start);
    const claim = source.slice(start, end);
    expect(claim).toContain("FOR UPDATE SKIP LOCKED");
    expect(claim).toContain("database.execute");
    expect(claim).not.toContain("database.transaction(");
    expect(claim).not.toContain("tx.execute");
    expect(claim).not.toContain("tx.select");
  });

  test("parseClaimedIds reads bun-sql execute shapes that used to look empty", () => {
    expect(parseClaimedIds([{ id: "job_1" }])).toEqual(["job_1"]);
    expect(parseClaimedIds({ rows: [{ id: "job_1" }] })).toEqual(["job_1"]);
    expect(parseClaimedIds([["job_1"]])).toEqual(["job_1"]);
    expect(parseClaimedIds({ rows: [["job_1"]] })).toEqual(["job_1"]);
    expect(parseClaimedIds("job_1")).toEqual(["job_1"]);
    expect(parseClaimedIds(undefined)).toEqual([]);
    expect(parseClaimedIds({ command: "UPDATE", count: 0 })).toEqual([]);
  });
});

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgres://openbot:openbot@localhost:5432/openbot";

const postgresReachable = await (async () => {
  const probe = createDatabase(databaseUrl, { max: 1 });
  try {
    await probe.execute(sql`select 1`);
    return true;
  } catch {
    return false;
  } finally {
    await probe.$client.close();
  }
})();

describe.skipIf(!postgresReachable)(
  "unattended job claim against Postgres",
  () => {
    const database = createDatabase(databaseUrl, TEST_POOL);
    const profileStore = createAgentProfileStore(database);
    const channelStore = createChannelStore(
      database,
      profileStore,
      createThreadIdentity("job-claim-test"),
    );
    const prefix = `job-claim-${randomUUID()}`;
    const createdUserIds: string[] = [];
    const createdAgentIds: string[] = [];
    const createdChannelIds: string[] = [];
    const createdJobIds: string[] = [];

    afterAll(async () => {
      for (const jobId of createdJobIds) {
        await database
          .delete(jobs)
          .where(eq(jobs.id, jobId))
          .catch(() => undefined);
      }
      for (const channelId of createdChannelIds) {
        await database
          .delete(intelligenceChannelMappings)
          .where(eq(intelligenceChannelMappings.channelId, channelId))
          .catch(() => undefined);
        await database
          .delete(channels)
          .where(eq(channels.id, channelId))
          .catch(() => undefined);
      }
      for (const agentId of createdAgentIds) {
        await database
          .delete(agentProfiles)
          .where(eq(agentProfiles.agentId, agentId))
          .catch(() => undefined);
        await database
          .delete(agents)
          .where(eq(agents.id, agentId))
          .catch(() => undefined);
      }
      for (const userId of createdUserIds) {
        await database
          .delete(users)
          .where(eq(users.id, userId))
          .catch(() => undefined);
      }
      await database.$client.close();
    });

    async function seedChannel() {
      await ensureLocalOrganization(database);
      const actor: AgentActor = {
        id: `${prefix}-user-${randomUUID()}`,
        role: "user",
      };
      await database.insert(users).values({
        id: actor.id,
        email: `${actor.id}@example.test`,
        name: "Claim Test",
      });
      createdUserIds.push(actor.id);
      await seedMembership(database, actor.id);
      const agent = await profileStore.create(actor, {
        name: "Researcher",
        title: "Research",
        roleDescription: "Research people.",
        visibility: "public",
        // create() is remote AG-UI unless a managed Bot is configured. CI has none.
        endpoint: "http://127.0.0.1:9/ag-ui",
      });
      createdAgentIds.push(agent.id);
      const channel = await channelStore.create(actor, [agent.id]);
      createdChannelIds.push(channel.id);
      return { actor, agent, channel };
    }

    test("two workers racing one queued job: one wins", async () => {
      const { actor, agent, channel } = await seedChannel();
      const first = createDatabase(databaseUrl, { max: 1 });
      const second = createDatabase(databaseUrl, { max: 1 });
      try {
        const storeA = createJobStore(first);
        const storeB = createJobStore(second);
        const job = await createJobStore(database).enqueue({
          orgId: "org_local",
          channelId: channel.id,
          coworkerId: agent.id,
          actingUserId: actor.id,
          threadId: channel.threadId,
          prompt: "Research this lead.",
        });
        createdJobIds.push(job.id);

        const [one, two] = await Promise.all([storeA.claim(), storeB.claim()]);
        const claimed = [one, two].filter(Boolean);
        expect(claimed).toHaveLength(1);
        expect(claimed[0]?.id).toBe(job.id);
        expect(claimed[0]?.status).toBe("running");
      } finally {
        await first.$client.close();
        await second.$client.close();
      }
    });

    test("a pool of one claims a queued row and sets started_at", async () => {
      const { actor, agent, channel } = await seedChannel();
      const single = createDatabase(databaseUrl, { max: 1 });
      try {
        const store = createJobStore(single);
        const job = await store.enqueue({
          orgId: "org_local",
          channelId: channel.id,
          coworkerId: agent.id,
          actingUserId: actor.id,
          threadId: channel.threadId,
          prompt: "Claim on one connection.",
        });
        createdJobIds.push(job.id);

        const claimed = await Promise.race([
          store.claim(),
          new Promise<never>((_, reject) => {
            setTimeout(
              () => reject(new Error("claim hung on a pool of one")),
              5_000,
            );
          }),
        ]);
        expect(claimed?.id).toBe(job.id);
        expect(claimed?.status).toBe("running");
        expect(claimed?.startedAt).toBeInstanceOf(Date);
      } finally {
        await single.$client.close();
      }
    });
  },
);
