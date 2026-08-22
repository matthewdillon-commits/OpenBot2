import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { AuditEventInput, AuditStore } from "../src/audit";
import { createAgentProfileStore } from "../src/agents/profile-store";
import type { AgentActor } from "../src/agents/profile-types";
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
  subagentRuns,
  users,
} from "../src/db/schema";
import { REFUSAL_MARKER } from "../src/plugins/tools";
import { createSubagentGateway } from "../src/subagents/gateway";
import { createSubagentStore } from "../src/subagents/store";
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
const runs = createSubagentStore(database);

const testPrefix = `subagent-${randomUUID()}`;
const createdUserIds: string[] = [];
const createdAgentIds: string[] = [];
const createdChannelIds: string[] = [];
const createdRunIds: string[] = [];

afterEach(async () => {
  for (const runId of createdRunIds.splice(0)) {
    await database.delete(subagentRuns).where(eq(subagentRuns.id, runId));
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
    name: "Sub-agent Test User",
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

function trackChannel(job: WakeJob | undefined) {
  if (job?.channelId) createdChannelIds.push(job.channelId);
}

function trackRun(answer: string) {
  const match = answer.match(/subagent_[0-9a-f-]+/i);
  if (match?.[0]) createdRunIds.push(match[0]);
  return match?.[0] ?? "";
}

describe("sub-agents against a real store", () => {
  test("a parent spawns a sub-agent, the send returns immediately, and the child result wakes the parent", async () => {
    const actor = await createUser();
    const risk = await createAgent(actor, "Risk");
    const { written, auditStore } = recorder();
    const wakes: WakeJob[] = [];

    const gateway = createSubagentGateway({
      runs,
      channels: channelStore,
      messages,
      auditStore,
      policy: () => PERMISSIVE,
      wake: { enqueue: (job) => wakes.push(job), isRunning: () => false },
    });

    const answer = await gateway.spawn({
      botId: risk,
      actor,
      goal: "Review vendor 12 against the June policy.",
      successCriteria: "A residual-risk figure and the section it came from.",
      reportBack: "The figure and whether it exceeds 0.3.",
    });

    expect(answer).toContain("Started sub-agent");
    expect(answer).toContain("Do not wait");
    const id = trackRun(answer);
    expect(id).toMatch(/^subagent_/);
    expect(wakes).toHaveLength(1);
    expect(wakes[0]?.subagentId).toBe(id);
    trackChannel(wakes[0]);

    const listed = await channelStore.list(actor);
    expect(listed.channels.every((entry) => entry.kind !== "task")).toBe(true);

    const task = await channelStore.get(actor, wakes[0]?.channelId ?? "");
    expect(task?.kind).toBe("task");
    expect(task?.agentIds).toEqual([risk]);

    const childJob = wakes[0];
    wakes.splice(0);

    const reported = await gateway.report({
      botId: risk,
      actor,
      subagentId: id,
      status: "done",
      result: "Vendor 12 residual risk is 0.42, June policy section 4.",
    });

    expect(reported).toContain("Reported");
    expect(wakes).toHaveLength(1);
    expect(wakes[0]?.botId).toBe(risk);
    expect(wakes[0]?.subagentId).toBeUndefined();
    expect(wakes[0]?.inbound.body).toContain(id);
    expect(wakes[0]?.inbound.body).toContain("0.42");
    expect(wakes[0]?.channelId).toBe(childJob?.channelId);
    expect(written.map((row) => row.eventType)).toEqual([
      "subagent.started",
      "subagent.reported",
    ]);
  });

  test("a second spawn is an independent run", async () => {
    const actor = await createUser();
    const risk = await createAgent(actor, "Risk");
    const wakes: WakeJob[] = [];
    const gateway = createSubagentGateway({
      runs,
      channels: channelStore,
      messages,
      auditStore: recorder().auditStore,
      policy: () => PERMISSIVE,
      wake: { enqueue: (job) => wakes.push(job), isRunning: () => false },
    });

    const first = await gateway.spawn({
      botId: risk,
      actor,
      goal: "Review vendor 12.",
      successCriteria: "A residual-risk figure.",
      reportBack: "The figure.",
    });
    const second = await gateway.spawn({
      botId: risk,
      actor,
      goal: "Draft the board note.",
      successCriteria: "A one-page summary.",
      reportBack: "The draft.",
    });

    const firstId = trackRun(first);
    const secondId = trackRun(second);
    expect(firstId).not.toBe(secondId);
    expect(wakes).toHaveLength(2);
    expect(wakes[0]?.subagentId).toBe(firstId);
    expect(wakes[1]?.subagentId).toBe(secondId);
    trackChannel(wakes[0]);
    trackChannel(wakes[1]);

    const follow = await gateway.spawn({
      botId: risk,
      actor,
      goal: "Use the July addendum.",
      successCriteria: "",
      reportBack: "",
      subagentId: firstId,
    });
    expect(follow).toContain(firstId);
    expect(follow).toContain("follow-up");
    expect(wakes[2]?.subagentId).toBe(firstId);
  });

  test("a gateway refusal is audited and does not start a run", async () => {
    const actor = await createUser();
    const risk = await createAgent(actor, "Risk");
    const { written, auditStore } = recorder();

    const answer = await createSubagentGateway({
      runs,
      channels: channelStore,
      messages,
      auditStore,
      policy: () => ({
        mode: "enforce",
        deny: ['tool.name == "spawn_subagent"'],
        allow: ["true"],
      }),
      wake: { enqueue: () => {}, isRunning: () => false },
    }).spawn({
      botId: risk,
      actor,
      goal: "This must not start.",
      successCriteria: "Nothing.",
      reportBack: "Nothing.",
    });

    expect(answer.startsWith(REFUSAL_MARKER)).toBe(true);
    expect(written[0]?.eventType).toBe("subagent.refused");
    const listed = await channelStore.list(actor);
    expect(listed.channels).toHaveLength(0);
    const stored = await database
      .select({ id: subagentRuns.id })
      .from(subagentRuns)
      .where(eq(subagentRuns.parentAgentId, risk));
    expect(stored).toHaveLength(0);
  });
});
