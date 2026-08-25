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
import { startUnattendedRun } from "../src/jobs/run";
import { createJobStore } from "../src/jobs/store";
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
  "unattended job enqueue, claim, and run",
  () => {
    const database = createDatabase(databaseUrl, TEST_POOL);
    const profileStore = createAgentProfileStore(database);
    const channelStore = createChannelStore(
      database,
      profileStore,
      createThreadIdentity("job-integration-test"),
    );
    const jobStore = createJobStore(database);
    const prefix = `job-int-${randomUUID()}`;
    const createdUserIds: string[] = [];
    const createdAgentIds: string[] = [];
    const createdChannelIds: string[] = [];

    afterAll(async () => {
      for (const channelId of createdChannelIds) {
        await database.delete(jobs).where(eq(jobs.channelId, channelId));
        await database
          .delete(intelligenceChannelMappings)
          .where(eq(intelligenceChannelMappings.channelId, channelId));
        await database.delete(channels).where(eq(channels.id, channelId));
      }
      for (const agentId of createdAgentIds) {
        await database
          .delete(agentProfiles)
          .where(eq(agentProfiles.agentId, agentId));
        await database.delete(agents).where(eq(agents.id, agentId));
      }
      for (const userId of createdUserIds) {
        await database.delete(users).where(eq(users.id, userId));
      }
      await database.$client.close();
    });

    test("a built-in coworker finishes a fake CRM tool and updates lastMessage", async () => {
      await ensureLocalOrganization(database);
      const actor: AgentActor = {
        id: `${prefix}-user`,
        role: "user",
        orgId: "org_local",
      };
      await database.insert(users).values({
        id: actor.id,
        email: `${actor.id}@example.test`,
        name: "Integration",
      });
      createdUserIds.push(actor.id);
      await seedMembership(database, actor.id);
      const agent = await profileStore.create(actor, {
        name: "Researcher",
        title: "Research",
        roleDescription: "Research people.",
        visibility: "public",
      });
      createdAgentIds.push(agent.id);
      const channel = await channelStore.create(actor, [agent.id]);
      createdChannelIds.push(channel.id);

      const queued = await jobStore.enqueue({
        orgId: "org_local",
        channelId: channel.id,
        coworkerId: agent.id,
        actingUserId: actor.id,
        threadId: channel.threadId,
        prompt: "Find Ada and write the CRM.",
      });
      expect(queued.status).toBe("queued");

      const claimed = await jobStore.claim();
      expect(claimed?.id).toBe(queued.id);
      expect(claimed?.status).toBe("running");

      const result = await startUnattendedRun({
        actor: {
          id: actor.id,
          name: "Integration",
          role: "user",
          orgId: "org_local",
        },
        orgId: "org_local",
        channelId: channel.id,
        threadId: channel.threadId,
        prompt: queued.payload.prompt,
        coworkerId: agent.id,
        deps: {
          lookupMapping: async ({ userId, channelId }) => {
            const mapped = await channelStore.get(
              { id: userId, role: "user", orgId: "org_local" },
              channelId,
            );
            return mapped
              ? {
                  threadId: mapped.threadId,
                  channelId: mapped.id,
                  userId,
                }
              : null;
          },
          waitForThread: async () => "idle",
          persistThread: async () => true,
          recordActivity: async ({
            actor: activityActor,
            channelId,
            activity,
          }) => {
            await channelStore.recordActivity(
              activityActor,
              channelId,
              activity,
            );
          },
          loadAgents: async () => [
            {
              id: agent.id,
              name: "Researcher",
              type: "built_in",
              systemPrompt: "Research people.",
            },
          ],
          loadTools: () => async () => [
            {
              name: "crm_search",
              description: "Search CRM",
              parameters: { parse: () => ({}) } as never,
              execute: async () => "Ada is at Acme.",
            },
          ],
          resolveModelApiKey: async () => "unused",
          model: { provider: "openai", defaultModel: "gpt-4.1" },
          timeoutMs: 5_000,
          runCoworker: async ({ messages }) => {
            const text = "Ada is at Acme.";
            return {
              text,
              messages: [
                ...messages,
                { id: "asst-1", role: "assistant", content: text },
              ],
            };
          },
        },
      });

      expect(result.outcome).toBe("succeeded");
      expect(result.text).toBe("Ada is at Acme.");

      const finished = await jobStore.finish(queued.id, "succeeded", {
        payload: {
          ...queued.payload,
          result: { text: result.text, persisted: result.persisted },
        },
        crmRecordIds: result.crmRecordIds,
        toolSuccessCount: result.toolSuccessCount,
      });
      expect(finished?.status).toBe("succeeded");
      expect(finished?.goalId).toBe(channel.id);
      expect(finished?.outcome).toEqual({
        status: "Done",
        last_action: "Ada is at Acme.",
        last_action_at: finished?.finishedAt?.toISOString(),
        jobStatus: "succeeded",
        finishedAt: finished?.finishedAt?.toISOString(),
        goalId: channel.id,
        channelId: channel.id,
        agentId: agent.id,
        orgId: "org_local",
        actingUserId: actor.id,
        summary: "Ada is at Acme.",
      });

      const [row] = await database
        .select({ lastMessage: channels.lastMessage })
        .from(channels)
        .where(eq(channels.id, channel.id));
      expect(row?.lastMessage).toBe("Ada is at Acme.");
    });
  },
);
