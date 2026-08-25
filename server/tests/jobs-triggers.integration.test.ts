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
  jobTriggers,
  jobs,
  users,
} from "../src/db/schema";
import { enqueueUnattendedJob } from "../src/jobs/enqueue";
import { createJobStore } from "../src/jobs/store";
import { createJobTriggerStore, tickDueCrons } from "../src/jobs/triggers";
import { TEST_POOL } from "./support/database";
import {
  ensureLocalOrganization,
  seedMembership,
} from "./support/organization";

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
  "standing triggers against Postgres",
  () => {
    const database = createDatabase(databaseUrl, TEST_POOL);
    const profileStore = createAgentProfileStore(database);
    const channelStore = createChannelStore(
      database,
      profileStore,
      createThreadIdentity("job-trigger-integration-test"),
    );
    const jobStore = createJobStore(database);
    const triggerStore = createJobTriggerStore(database);
    const prefix = `jtr-int-${randomUUID()}`;
    const createdUserIds: string[] = [];
    const createdAgentIds: string[] = [];
    const createdChannelIds: string[] = [];
    const createdTriggerIds: string[] = [];

    afterAll(async () => {
      for (const triggerId of createdTriggerIds) {
        await database
          .delete(jobTriggers)
          .where(eq(jobTriggers.id, triggerId))
          .catch(() => undefined);
      }
      for (const channelId of createdChannelIds) {
        await database
          .delete(jobs)
          .where(eq(jobs.channelId, channelId))
          .catch(() => undefined);
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
        orgId: "org_local",
      };
      await database.insert(users).values({
        id: actor.id,
        email: `${actor.id}@example.test`,
        name: "Trigger Test",
      });
      createdUserIds.push(actor.id);
      await seedMembership(database, actor.id);
      const agent = await profileStore.create(actor, {
        name: "Researcher",
        title: "Research",
        roleDescription: "Research people.",
        visibility: "public",
        endpoint: "http://127.0.0.1:9/ag-ui",
      });
      createdAgentIds.push(agent.id);
      const channel = await channelStore.create(actor, [agent.id]);
      createdChannelIds.push(channel.id);
      return { actor, agent, channel };
    }

    test("a due cron row enqueues the same jobs row the worker claims", async () => {
      const { actor, agent, channel } = await seedChannel();
      const created = await triggerStore.create({
        orgId: "org_local",
        kind: "cron",
        channelId: channel.id,
        goalId: channel.id,
        threadId: channel.threadId,
        coworkerId: agent.id,
        actingUserId: actor.id,
        prompt: "Morning brief.",
        everySeconds: 3600,
        nextRunAt: new Date(Date.now() - 1000),
      });
      createdTriggerIds.push(created.trigger.id);

      const count = await tickDueCrons({
        triggerStore,
        jobStore,
        lookupChannel: (acting, channelId) =>
          channelStore.get(acting, channelId),
      });
      expect(count).toBe(1);

      const listed = await jobStore.listForChannel("org_local", channel.id);
      const cronJob = listed.find((row) => row.trigger === "cron");
      expect(cronJob?.threadId).toBe(channel.threadId);
      expect(cronJob?.actingUserId).toBe(actor.id);
      expect(cronJob?.payload.prompt).toBe("Morning brief.");
      expect(cronJob?.status).toBe("queued");

      const claimed = await jobStore.claim();
      expect(claimed?.id).toBe(cronJob?.id);
      expect(claimed?.status).toBe("running");
    });

    test("enqueue refuses when the live mapping has no thread", async () => {
      const { actor, agent, channel } = await seedChannel();
      const result = await enqueueUnattendedJob({
        trigger: "webhook",
        orgId: "org_local",
        channelId: channel.id,
        coworkerId: agent.id,
        actingUserId: actor.id,
        actorRole: "user",
        prompt: "From the CRM.",
        expectedThreadId: channel.threadId,
        lookupChannel: async () => ({
          id: channel.id,
          name: channel.name,
          agentIds: [agent.id],
          threadId: "",
          active: true,
        }),
        jobStore,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(409);
    });
  },
);
