import { afterAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { createAgentProfileStore } from "../src/agents/profile-store";
import type { AgentActor } from "../src/agents/profile-types";
import { createChannelStore } from "../src/channels/routes";
import { createThreadIdentity } from "../src/channels/thread-identity";
import { createDatabase } from "../src/db/client";
import {
  bindRequestRls,
  currentRlsBinding,
  runWithRequestRls,
} from "../src/db/rls";
import {
  agentProfiles,
  agents,
  channels,
  intelligenceChannelMappings,
  jobs,
  organizationMemberships,
  organizationSso,
  organizations,
  users,
} from "../src/db/schema";
import {
  CLAIM_QUEUED_JOB_SQL,
  createJobStore,
  parseClaimedIds,
} from "../src/jobs/store";
import { TEST_POOL } from "./support/database";
import {
  createTestOrganization,
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

  test("claim() bypasses a leftover processJob org bind so every org is visible", async () => {
    const source = await Bun.file(
      new URL("../src/jobs/store.ts", import.meta.url),
    ).text();
    const start = source.indexOf("async claim()");
    const end = source.indexOf("async finish", start);
    const claim = source.slice(start, end);
    expect(claim).toContain("runWithRequestRls");
    expect(claim).toContain("bypass: true");
    expect(claim).toContain("database.execute");
    expect(claim).not.toContain("database.transaction(");
  });

  test("processJob binds the job org with ALS.run, not enterWith", async () => {
    const source = await Bun.file(
      new URL("../src/jobs/bootstrap.ts", import.meta.url),
    ).text();
    const start = source.indexOf("async function processJob");
    const end = source.indexOf("async function executeJob", start);
    const processJob = source.slice(start, end);
    expect(processJob).toContain("runWithRequestRls");
    expect(processJob).toContain("orgId: job.orgId");
    expect(processJob).not.toContain("bindRequestRls");
    expect(processJob).not.toContain("enterWith");
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
    const createdOrgIds: string[] = [];

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
          .delete(organizationMemberships)
          .where(eq(organizationMemberships.userId, userId))
          .catch(() => undefined);
        await database
          .delete(users)
          .where(eq(users.id, userId))
          .catch(() => undefined);
      }
      for (const orgId of createdOrgIds) {
        await database
          .delete(organizationSso)
          .where(eq(organizationSso.orgId, orgId))
          .catch(() => undefined);
        await database
          .delete(organizations)
          .where(eq(organizations.id, orgId))
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

    async function seedOrgJob(
      org: { id: string; slug: string; name: string },
      prompt: string,
    ) {
      await createTestOrganization(database, org);
      createdOrgIds.push(org.id);
      const actor: AgentActor = {
        id: `${prefix}-user-${org.id}`,
        role: "user",
        orgId: org.id,
      };
      await database.insert(users).values({
        id: actor.id,
        email: `${actor.id}@example.test`,
        name: "Two-org claim",
      });
      createdUserIds.push(actor.id);
      await seedMembership(database, actor.id, "member", org.id);
      const agentId = `${prefix}-agent-${org.id}`;
      await database.insert(agents).values({
        id: agentId,
        orgId: org.id,
        name: "Researcher",
        type: "built_in",
        configuration: {},
      });
      createdAgentIds.push(agentId);
      const channelId = `${prefix}-channel-${org.id}`;
      await database.insert(channels).values({
        id: channelId,
        orgId: org.id,
        name: "Goal",
        description: "two-org claim",
      });
      createdChannelIds.push(channelId);
      const job = await createJobStore(database).enqueue({
        orgId: org.id,
        channelId,
        coworkerId: agentId,
        actingUserId: actor.id,
        threadId: `thread-${channelId}`,
        prompt,
      });
      createdJobIds.push(job.id);
      return job;
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

    test("claim() still starts a second org's job after processJob bound the first", async () => {
      const orgA = {
        id: `org_claim_a_${prefix}`,
        slug: `claim-a-${prefix}`.slice(0, 40),
        name: "Claim Org A",
      };
      const orgB = {
        id: `org_claim_b_${prefix}`,
        slug: `claim-b-${prefix}`.slice(0, 40),
        name: "Claim Org B",
      };
      const jobA = await seedOrgJob(orgA, "First org leftover.");
      const jobB = await seedOrgJob(orgB, "Second org after the leftover.");
      const claimDb = createDatabase(databaseUrl, { max: 1 });
      const runtimeDb = createDatabase(databaseUrl, { max: 1 });
      try {
        await claimDb.execute(sql`grant openbot_rls to current_user`);
        await runtimeDb.execute(sql`grant openbot_rls to current_user`);
        const store = createJobStore(claimDb);

        const first = await store.claim();
        expect(first?.id).toBe(jobA.id);
        expect(first?.orgId).toBe(orgA.id);
        expect(first?.startedAt).toBeInstanceOf(Date);

        // The live worker: processJob enterWith(org A). ALS is process-wide, so
        // the claim pool's next UPDATE ran as openbot_rls for org A and missed
        // org B. A scoped UPDATE here must not match job B.
        await bindRequestRls(claimDb, { orgId: orgA.id, bypass: false });
        const scoped = await claimDb.execute(sql.raw(CLAIM_QUEUED_JOB_SQL));
        expect(parseClaimedIds(scoped)).toEqual([]);

        // processJob now uses ALS.run for the job only; that must not leak.
        await runWithRequestRls(
          runtimeDb,
          { orgId: orgA.id, bypass: false },
          () => runtimeDb.execute(sql`select 1`),
        );
        // enterWith sticks; ALS.run does not add a second leak. Claim must
        // still see org B while this leftover org A store is in place.
        expect(currentRlsBinding()?.orgId).toBe(orgA.id);

        const second = await store.claim();
        expect(second?.id).toBe(jobB.id);
        expect(second?.orgId).toBe(orgB.id);
        expect(second?.status).toBe("running");
        expect(second?.startedAt).toBeInstanceOf(Date);
      } finally {
        await claimDb.$client.close();
        await runtimeDb.$client.close();
      }
    });
  },
);
