import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { AuditEventInput, AuditStore } from "../src/audit";
import { createAgentProfileStore } from "../src/agents/profile-store";
import type { AgentActor } from "../src/agents/profile-types";
import { createMessagingGateway } from "../src/channels/messaging";
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
  users,
} from "../src/db/schema";
import { REFUSAL_MARKER } from "../src/plugins/tools";
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

const testPrefix = `channel-messaging-${randomUUID()}`;
const createdUserIds: string[] = [];
const createdAgentIds: string[] = [];
const createdChannelIds: string[] = [];

afterEach(async () => {
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
    name: "Messaging Test User",
  });
  createdUserIds.push(id);
  return { id, role: "user" };
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

describe("agent messaging against a real channel store", () => {
  test("a Bot messages another Bot 1:1 and the human can read the room", async () => {
    const actor = await createUser();
    const risk = await createAgent(actor, "Risk");
    const knowledge = await createAgent(actor, "Knowledge");
    const { written, auditStore } = recorder();
    const wakes: WakeJob[] = [];

    const gateway = createMessagingGateway({
      channels: channelStore,
      messages,
      auditStore,
      policy: () => PERMISSIVE,
      wake: { enqueue: (job) => wakes.push(job), isRunning: () => false },
    });

    const answer = await gateway.messageAgent({
      botId: risk,
      actor,
      recipientAgentId: knowledge,
      text: "Please pull the latest vendor policy.",
    });

    expect(answer).toContain("Sent");
    expect(wakes).toHaveLength(1);
    expect(wakes[0]?.botId).toBe(knowledge);
    createdChannelIds.push(wakes[0]?.channelId ?? "");

    const room = await channelStore.get(actor, wakes[0]?.channelId ?? "");
    expect(room?.kind).toBe("direct");
    expect(room?.agentIds.sort()).toEqual([knowledge, risk].sort());

    const posted = await messages.list(actor, room?.id ?? "");
    expect(posted).toHaveLength(1);
    expect(posted[0]?.body).toBe("Please pull the latest vendor policy.");
    expect(written[0]?.eventType).toBe("channel.message_sent");
  });

  test("a Bot posts to a named multi-member room", async () => {
    const actor = await createUser();
    const risk = await createAgent(actor, "Risk");
    const knowledge = await createAgent(actor, "Knowledge");
    const created = await channelStore.create(actor, [risk, knowledge], {
      name: "Vendor review",
    });
    createdChannelIds.push(created.id);
    const { written, auditStore } = recorder();
    const wakes: WakeJob[] = [];

    const answer = await createMessagingGateway({
      channels: channelStore,
      messages,
      auditStore,
      policy: () => PERMISSIVE,
      wake: { enqueue: (job) => wakes.push(job), isRunning: () => false },
    }).messageChannel({
      botId: risk,
      actor,
      channelId: created.id,
      text: "Vendor 12 exceeds residual risk.",
    });

    expect(answer).toContain("Posted");
    expect(wakes.map((job) => job.botId)).toEqual([knowledge]);
    expect(await messages.list(actor, created.id)).toHaveLength(1);
    expect(written[0]?.eventType).toBe("channel.message_sent");
  });

  test("a deny rule is audited and the message is not stored", async () => {
    const actor = await createUser();
    const risk = await createAgent(actor, "Risk");
    const knowledge = await createAgent(actor, "Knowledge");
    const { written, auditStore } = recorder();

    const answer = await createMessagingGateway({
      channels: channelStore,
      messages,
      auditStore,
      policy: () => ({
        mode: "enforce",
        deny: ['tool.name == "message_agent"'],
        allow: ["true"],
      }),
      wake: { enqueue: () => {}, isRunning: () => false },
    }).messageAgent({
      botId: risk,
      actor,
      recipientAgentId: knowledge,
      text: "This must not land.",
    });

    expect(answer.startsWith(REFUSAL_MARKER)).toBe(true);
    expect(written[0]?.eventType).toBe("channel.message_refused");
    const listed = await channelStore.list(actor);
    expect(listed.channels).toHaveLength(0);
  });

  test("a named room can have more than one unattended reply hop", async () => {
    const actor = await createUser();
    const risk = await createAgent(actor, "Risk");
    const knowledge = await createAgent(actor, "Knowledge");
    const ops = await createAgent(actor, "Ops");
    const created = await channelStore.create(actor, [risk, knowledge, ops], {
      name: "Vendor review",
    });
    createdChannelIds.push(created.id);
    const wakes: WakeJob[] = [];
    const gateway = createMessagingGateway({
      channels: channelStore,
      messages,
      auditStore: recorder().auditStore,
      policy: () => PERMISSIVE,
      wake: { enqueue: (job) => wakes.push(job), isRunning: () => false },
    });

    await gateway.messageChannel({
      botId: risk,
      actor,
      channelId: created.id,
      text: "Vendor 12 exceeds residual risk. Knowledge, please confirm the source.",
    });
    expect(wakes.map((job) => job.botId).sort()).toEqual(
      [knowledge, ops].sort(),
    );

    const firstReply = await gateway.postWakeReply({
      botId: knowledge,
      actor,
      channelId: created.id,
      text: "The source is the June vendor policy, section 4.",
      hop: 2,
    });
    expect(firstReply?.hop).toBe(2);
    expect(wakes.map((job) => job.botId)).toContain(risk);
    expect(wakes.map((job) => job.botId)).toContain(ops);

    const secondReply = await gateway.postWakeReply({
      botId: ops,
      actor,
      channelId: created.id,
      text: "I will pull the contract addendum next.",
      hop: 3,
    });
    expect(secondReply?.hop).toBe(3);

    const posted = await messages.list(actor, created.id);
    expect(posted.map((row) => row.body)).toEqual([
      "Vendor 12 exceeds residual risk. Knowledge, please confirm the source.",
      "The source is the June vendor policy, section 4.",
      "I will pull the contract addendum next.",
    ]);
    expect(posted.map((row) => row.hop)).toEqual([1, 2, 3]);
  });
});
