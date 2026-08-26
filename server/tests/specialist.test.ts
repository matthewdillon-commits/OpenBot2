import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { AgentActor, AgentProfile } from "../src/agents/profile-types";
import type { AgentChannel } from "../src/channels/routes";
import type { EnqueueUnattendedInput } from "../src/jobs/enqueue";
import {
  SPECIALIST_REFUSALS,
  specialistCrmOrgId,
  specialistGetsComputer,
  startSpecialist,
} from "../src/jobs/specialist";
import { startSpecialistTool } from "../src/jobs/specialist-tool";
import type { UnattendedJob } from "../src/jobs/store";
import { createLoadToolsForActor } from "../src/jobs/tools";
import { jsonSchemaForLlmTool } from "../src/plugins/llm-schema";
import { REFUSAL_MARKER } from "../src/plugins/refusal";

const now = new Date("2026-08-25T16:00:00.000Z");
const actor: AgentActor = {
  id: "user-1",
  role: "user",
  orgId: "org_acme",
};

function profile(overrides: Partial<AgentProfile> = {}): AgentProfile {
  return {
    id: "knowledge",
    name: "Knowledge",
    title: "Company Knowledge",
    roleDescription: "Cite sources.",
    avatarSeed: "knowledge",
    visibility: "public",
    ownerUserId: null,
    systemOwned: true,
    hidden: false,
    deletedAt: null,
    endpoint: null,
    hasAuth: false,
    hasCallbackToken: false,
    standingRole: null,
    ...overrides,
  };
}

const orchestrator = profile({
  id: "general-assistant",
  name: "General Assistant",
  standingRole: "orchestrator",
});
const specialist = profile();

function channel(overrides: Partial<AgentChannel> = {}): AgentChannel {
  return {
    id: "channel_1",
    name: "Research Ada.",
    agentIds: ["general-assistant"],
    threadId: "thread-existing",
    active: true,
    ...overrides,
  };
}

function jobRow(input: EnqueueUnattendedInput): UnattendedJob {
  return {
    id: "job_specialist",
    orgId: input.orgId,
    channelId: input.channelId,
    goalId: input.goalId ?? input.channelId,
    coworkerId: input.coworkerId ?? "knowledge",
    actingUserId: input.actingUserId,
    trigger: input.trigger,
    payload: { prompt: input.prompt },
    status: "queued",
    threadId: input.expectedThreadId ?? "thread-existing",
    needsYou: false,
    error: null,
    outcome: null,
    startedAt: null,
    finishedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

function deps(options?: {
  room?: AgentChannel | null;
  enqueue?: (
    input: EnqueueUnattendedInput,
  ) => Promise<{ ok: true; job: UnattendedJob; channel: AgentChannel }>;
}) {
  let room = options?.room === undefined ? channel() : options.room;
  const enqueueCalls: EnqueueUnattendedInput[] = [];
  return {
    enqueueCalls,
    lookupChannel: async () => room,
    addAgents: async (_actor: AgentActor, _id: string, agentIds: string[]) => {
      if (!room) throw new Error("no room");
      room = {
        ...room,
        agentIds: [...new Set([...room.agentIds, ...agentIds])],
      };
      return room;
    },
    getAgent: async (_actor: AgentActor, id: string) =>
      [orchestrator, specialist].find((agent) => agent.id === id) ?? null,
    listAgents: async () => [orchestrator, specialist],
    skillBySlug: async (slug: string) =>
      slug === "research"
        ? {
            slug: "research",
            title: "Research",
            instructions: "Look them up in the CRM.",
          }
        : null,
    jobStore: {
      enqueue: async () => {
        throw new Error(
          "jobStore.enqueue must not run when enqueue is injected",
        );
      },
    },
    enqueue: async (input: EnqueueUnattendedInput) => {
      enqueueCalls.push(input);
      if (options?.enqueue) return options.enqueue(input);
      const mapped = room ?? channel();
      return { ok: true as const, job: jobRow(input), channel: mapped };
    },
  };
}

const baseInput = {
  actor,
  orgId: "org_acme",
  channelId: "channel_1",
  threadId: "thread-existing",
  parentCoworkerId: "general-assistant",
  task: "Research Ada and write the CRM.",
  specialistId: "knowledge",
};

describe("specialistCrmOrgId", () => {
  test("the specialist reads the organization’s CRM, never a private copy", () => {
    expect(specialistCrmOrgId("org_acme")).toBe("org_acme");
    expect(specialistCrmOrgId("")).toBe("org_local");
  });
});

describe("startSpecialist", () => {
  test("spawns a specialist on the org CRM and enqueues the same unattended job", async () => {
    const started = deps();
    const result = await startSpecialist(baseInput, started);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.orgId).toBe("org_acme");
    expect(result.coworkerId).toBe("knowledge");
    expect(result.threadId).toBe("thread-existing");
    expect(started.enqueueCalls).toHaveLength(1);
    expect(started.enqueueCalls[0]?.orgId).toBe("org_acme");
    expect(started.enqueueCalls[0]?.coworkerId).toBe("knowledge");
    expect(started.enqueueCalls[0]?.channelId).toBe("channel_1");
    expect(started.enqueueCalls[0]?.trigger).toBe("manual");
    expect(started.enqueueCalls[0]?.prompt).toContain(
      "You share this organization’s CRM",
    );
    expect(started.enqueueCalls[0]?.prompt).toContain("computer_navigate");
    expect(started.enqueueCalls[0]?.prompt).not.toContain(
      "The parent did not hand you a computer",
    );
    expect(started.enqueueCalls[0]?.withComputer).toBeUndefined();
    expect(started.enqueueCalls[0]?.expectedThreadId).toBe("thread-existing");
  });

  test("does not strip the computer unless withComputer is explicitly false", async () => {
    const handed = deps();
    const withheld = deps();
    const omitted = await startSpecialist(baseInput, handed);
    const explicitFalse = await startSpecialist(
      { ...baseInput, withComputer: false },
      withheld,
    );
    expect(omitted.ok).toBe(true);
    expect(explicitFalse.ok).toBe(true);
    expect(handed.enqueueCalls[0]?.withComputer).toBeUndefined();
    expect(handed.enqueueCalls[0]?.prompt).toContain("computer_navigate");
    expect(withheld.enqueueCalls[0]?.withComputer).toBe(false);
    expect(withheld.enqueueCalls[0]?.prompt).toContain(
      "The parent did not hand you a computer",
    );
  });

  test("a skill/playbook specialist still enqueues on the org CRM", async () => {
    const started = deps();
    const result = await startSpecialist(
      {
        ...baseInput,
        specialistId: undefined,
        skillSlug: "research",
      },
      started,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.orgId).toBe("org_acme");
    expect(result.coworkerId).toBe("knowledge");
    expect(result.skillInstructions[0]).toContain("Look them up in the CRM.");
    expect(started.enqueueCalls[0]?.orgId).toBe("org_acme");
    expect(started.enqueueCalls[0]?.skillInstructions?.[0]).toContain(
      "Look them up in the CRM.",
    );
  });

  test("unattended specialist work goes through enqueueUnattendedJob, not startUnattendedRun inline", async () => {
    const source = readFileSync(
      fileURLToPath(new URL("../src/jobs/specialist.ts", import.meta.url)),
      "utf8",
    );
    expect(source).toContain("enqueueUnattendedJob");
    expect(source).not.toContain("startUnattendedRun");
    const started = deps();
    const result = await startSpecialist(baseInput, started);
    expect(result.ok).toBe(true);
    expect(started.enqueueCalls).toHaveLength(1);
  });

  test("refuses if there is no Intelligence thread and does not enqueue", async () => {
    const emptyThread = deps();
    const missing = deps({ room: null });
    const blankMapping = deps({ room: channel({ threadId: "" }) });
    const mismatch = deps();

    const noId = await startSpecialist(
      { ...baseInput, threadId: "" },
      emptyThread,
    );
    const noChannel = await startSpecialist(baseInput, missing);
    const empty = await startSpecialist(
      { ...baseInput, threadId: "thread-existing" },
      blankMapping,
    );
    const wrong = await startSpecialist(
      { ...baseInput, threadId: "other-thread" },
      mismatch,
    );

    expect(noId).toEqual({
      ok: false,
      error: SPECIALIST_REFUSALS.NO_THREAD,
      status: 409,
    });
    expect(noChannel).toEqual({
      ok: false,
      error: SPECIALIST_REFUSALS.NO_CHANNEL,
      status: 404,
    });
    expect(empty).toEqual({
      ok: false,
      error: SPECIALIST_REFUSALS.NO_THREAD,
      status: 409,
    });
    expect(wrong).toEqual({
      ok: false,
      error: SPECIALIST_REFUSALS.NO_THREAD,
      status: 409,
    });
    expect(emptyThread.enqueueCalls).toEqual([]);
    expect(missing.enqueueCalls).toEqual([]);
    expect(blankMapping.enqueueCalls).toEqual([]);
    expect(mismatch.enqueueCalls).toEqual([]);
  });
});

describe("specialistGetsComputer", () => {
  test("is true unless the parent explicitly withheld the computer", () => {
    expect(specialistGetsComputer()).toBe(true);
    expect(specialistGetsComputer(undefined)).toBe(true);
    expect(specialistGetsComputer(true)).toBe(true);
    expect(specialistGetsComputer(false)).toBe(false);
  });
});

describe("start_specialist tool", () => {
  test("refuses when this turn has no thread", async () => {
    const calls: unknown[] = [];
    const tool = startSpecialistTool({
      actor,
      parentCoworkerId: "general-assistant",
      start: async (input) => {
        calls.push(input);
        return { ok: false, error: "should not run", status: 400 };
      },
    });
    const result = await tool.execute({
      task: "Research Ada.",
      specialist_id: "knowledge",
    });
    expect(result).toBe(`${REFUSAL_MARKER} ${SPECIALIST_REFUSALS.NO_THREAD}`);
    expect(calls).toEqual([]);
  });

  test("the orchestrator is offered the tool; a leftover specialist is not", async () => {
    const pluginStore = { listForAgent: async () => ({ tools: [] }) };
    const knowledgeSearch = { anyDocuments: async () => false };
    const auditStore = { insert: async () => undefined };
    const crmGateway = {
      search: async () => "",
      get: async () => "",
      create: async () => "",
      update: async () => "",
      send: async () => "",
    };
    const load = createLoadToolsForActor({
      pluginStore: pluginStore as never,
      knowledgeSearch: knowledgeSearch as never,
      database: {} as never,
      auditStore: auditStore as never,
      policyFor: () => ({ mode: "enforce", deny: [], allow: ["true"] }),
      crmGateway: crmGateway as never,
      startSpecialist: async () => ({
        ok: true,
        coworkerId: "knowledge",
        jobId: "job_1",
        orgId: "org_acme",
        channelId: "channel_1",
        threadId: "thread-existing",
        skillInstructions: [],
      }),
    });
    const orchestratorTools = await load(
      "user-1",
      "org_acme",
    )("general-assistant");
    const leftoverTools = await load("user-1", "org_acme")("knowledge");
    expect(
      orchestratorTools.some((tool) => tool.name === "start_specialist"),
    ).toBe(true);
    expect(leftoverTools.some((tool) => tool.name === "start_specialist")).toBe(
      false,
    );
    expect(orchestratorTools.some((tool) => tool.name === "crm_search")).toBe(
      true,
    );
    expect(leftoverTools.some((tool) => tool.name === "crm_search")).toBe(true);
  });

  test("omitted with_computer hands the specialist the computer; false withholds it", async () => {
    const calls: Array<{ withComputer?: boolean }> = [];
    const tool = startSpecialistTool({
      actor,
      parentCoworkerId: "general-assistant",
      runContext: {
        channelId: "channel_1",
        threadId: "thread-existing",
        goalId: "channel_1",
      },
      start: async (input) => {
        calls.push({ withComputer: input.withComputer });
        return {
          ok: true,
          coworkerId: "knowledge",
          jobId: "job_1",
          orgId: "org_acme",
          channelId: "channel_1",
          threadId: "thread-existing",
          skillInstructions: [],
        };
      },
    });
    const omitted = await tool.execute({
      task: "Research Ada.",
      specialist_id: "knowledge",
    });
    expect(omitted).toContain("Started specialist knowledge");
    expect(calls[0]?.withComputer).not.toBe(false);

    const withheld = await tool.execute({
      task: "Research Ada.",
      specialist_id: "knowledge",
      with_computer: false,
    });
    expect(withheld).toContain("Started specialist knowledge");
    expect(calls[1]?.withComputer).toBe(false);
  });

  test("the schema the model sees defaults with_computer to true", () => {
    const tool = startSpecialistTool({
      actor,
      parentCoworkerId: "general-assistant",
      start: async () => ({
        ok: false,
        error: "should not run",
        status: 400,
      }),
    });
    const schema = jsonSchemaForLlmTool(tool.parameters);
    const withComputer = (
      schema.properties as Record<string, { default?: unknown }>
    ).with_computer;
    expect(withComputer?.default).toBe(true);
    expect(tool.description).toContain("with_computer to false");
  });
});
