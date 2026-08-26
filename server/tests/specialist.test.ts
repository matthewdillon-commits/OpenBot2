import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { AgentActor, AgentProfile } from "../src/agents/profile-types";
import type { AgentChannel } from "../src/channels/routes";
import { createLoadToolsForActor } from "../src/jobs/tools";
import {
  SPECIALIST_REFUSALS,
  specialistCrmOrgId,
  startSpecialist,
} from "../src/jobs/specialist";
import { startSpecialistTool } from "../src/jobs/specialist-tool";
import type { EnqueueUnattendedInput } from "../src/jobs/enqueue";
import type { UnattendedJob } from "../src/jobs/store";
import {
  SALES_CRON_EVERY_SECONDS,
  SALES_STANDING_PROMPT,
  standingSalesTriggerId,
  WORKER_PLAYBOOKS,
  WORKER_UNSCOPED_IDS,
} from "../src/jobs/worker-kinds";
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
const campaignWorker = profile({
  id: "org_acme__campaign-worker",
  name: "Email campaign",
  title: "Email campaign worker",
  avatarSeed: "campaign-worker",
});
const researchWorker = profile({
  id: "org_acme__research-worker",
  name: "Marketing research",
  title: "Marketing research worker",
  avatarSeed: "research-worker",
});
const salesWorker = profile({
  id: "org_acme__sales-worker",
  name: "Always-on sales",
  title: "Always-on sales worker",
  avatarSeed: "sales-worker",
});
const packagedWorkers = [
  orchestrator,
  specialist,
  campaignWorker,
  researchWorker,
  salesWorker,
];

function memoryTriggerStore() {
  const rows: {
    id: string;
    kind: string;
    channelId: string;
    coworkerId: string;
    everySeconds: number | null;
    prompt: string;
  }[] = [];
  const creates: { id?: string; everySeconds?: number; prompt: string }[] = [];
  return {
    creates,
    rows,
    async create(input: {
      id?: string;
      orgId: string;
      kind: "cron" | "webhook" | "email";
      channelId: string;
      goalId: string;
      threadId: string;
      coworkerId: string;
      actingUserId: string;
      prompt: string;
      everySeconds?: number;
    }) {
      creates.push(input);
      const trigger = {
        id: input.id ?? `jtr_${creates.length}`,
        kind: input.kind,
        channelId: input.channelId,
        coworkerId: input.coworkerId,
        everySeconds: input.everySeconds ?? null,
        prompt: input.prompt,
      };
      rows.push(trigger);
      return { trigger };
    },
    async list() {
      return rows;
    },
    async get(_orgId: string, id: string) {
      return rows.find((row) => row.id === id) ?? null;
    },
  };
}

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
  agents?: AgentProfile[];
  triggerStore?: {
    create: (input: {
      id?: string;
      orgId: string;
      kind: "cron" | "webhook" | "email";
      channelId: string;
      goalId: string;
      threadId: string;
      coworkerId: string;
      actingUserId: string;
      prompt: string;
      everySeconds?: number;
    }) => Promise<{ trigger: { id: string } }>;
    list: (orgId: string) => Promise<
      {
        id: string;
        kind: string;
        channelId: string;
        coworkerId: string;
      }[]
    >;
    get: (orgId: string, id: string) => Promise<{ id: string } | null>;
  };
}) {
  let room = options?.room === undefined ? channel() : options.room;
  const listed = options?.agents ?? [orchestrator, specialist];
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
      listed.find((agent) => agent.id === id) ?? null,
    listAgents: async () => listed,
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
    ...(options?.triggerStore ? { triggerStore: options.triggerStore } : {}),
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
    expect(started.enqueueCalls[0]?.expectedThreadId).toBe("thread-existing");
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

  test("kind=campaign is enough; leftover specialist_id is not required", async () => {
    const calls: unknown[] = [];
    const tool = startSpecialistTool({
      actor,
      parentCoworkerId: "general-assistant",
      runContext: {
        channelId: "channel_1",
        threadId: "thread-existing",
        goalId: "channel_1",
      },
      start: async (input) => {
        calls.push(input);
        return {
          ok: true,
          coworkerId: "org_acme__campaign-worker",
          jobId: "job_1",
          orgId: "org_acme",
          channelId: "channel_1",
          threadId: "thread-existing",
          skillInstructions: [],
          kind: "campaign",
        };
      },
    });
    const result = await tool.execute({
      task: "Set up an email campaign for existing customers about the spring offer.",
      kind: "campaign",
    });
    expect(calls).toEqual([
      expect.objectContaining({
        kind: "campaign",
        task: "Set up an email campaign for existing customers about the spring offer.",
      }),
    ]);
    expect(result).toContain("campaign worker");
    expect(result).toContain("job_1");
  });
});

describe("owner jobs spawn workers onto the same goal", () => {
  test("kind=campaign enqueues the campaign worker with the playbook, not an inline run", async () => {
    const started = deps({ agents: packagedWorkers });
    const result = await startSpecialist(
      {
        ...baseInput,
        specialistId: undefined,
        kind: "campaign",
        task: "Set up an email campaign for existing customers about the spring offer.",
      },
      started,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.kind).toBe("campaign");
    expect(result.coworkerId).toBe("org_acme__campaign-worker");
    expect(result.threadId).toBe("thread-existing");
    expect(result.standingTriggerId).toBeUndefined();
    expect(started.enqueueCalls).toHaveLength(1);
    expect(started.enqueueCalls[0]?.coworkerId).toBe(
      "org_acme__campaign-worker",
    );
    expect(started.enqueueCalls[0]?.trigger).toBe("manual");
    expect(started.enqueueCalls[0]?.skillInstructions?.[0]).toBe(
      WORKER_PLAYBOOKS.campaign,
    );
    expect(started.enqueueCalls[0]?.expectedThreadId).toBe("thread-existing");
  });

  test("kind=research enqueues the research worker with the playbook", async () => {
    const started = deps({ agents: packagedWorkers });
    const result = await startSpecialist(
      {
        ...baseInput,
        specialistId: undefined,
        kind: "research",
        task: "Do marketing research on regional HVAC competitors.",
      },
      started,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.kind).toBe("research");
    expect(result.coworkerId).toBe("org_acme__research-worker");
    expect(started.enqueueCalls[0]?.skillInstructions?.[0]).toBe(
      WORKER_PLAYBOOKS.research,
    );
    expect(started.enqueueCalls[0]?.skillInstructions?.[0]).toContain(
      "search_web",
    );
  });

  test("kind=sales enqueues and creates a standing hourly cron on this goal", async () => {
    const triggers = memoryTriggerStore();
    const started = deps({
      agents: packagedWorkers,
      triggerStore: triggers,
    });
    const result = await startSpecialist(
      {
        ...baseInput,
        specialistId: undefined,
        kind: "sales",
        task: "Keep selling. Research leads, send outreach, update CRM, book meetings.",
      },
      started,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.kind).toBe("sales");
    expect(result.coworkerId).toBe("org_acme__sales-worker");
    expect(started.enqueueCalls).toHaveLength(1);
    expect(started.enqueueCalls[0]?.coworkerId).toBe("org_acme__sales-worker");
    expect(started.enqueueCalls[0]?.skillInstructions?.[0]).toBe(
      WORKER_PLAYBOOKS.sales,
    );
    const expectedId = standingSalesTriggerId(
      "org_acme",
      "channel_1",
      "org_acme__sales-worker",
    );
    expect(result.standingTriggerId).toBe(expectedId);
    expect(triggers.creates).toHaveLength(1);
    expect(triggers.creates[0]?.everySeconds).toBe(SALES_CRON_EVERY_SECONDS);
    expect(triggers.creates[0]?.prompt).toBe(SALES_STANDING_PROMPT);
    expect(triggers.creates[0]?.id).toBe(expectedId);
  });

  test("a second sales spawn reuses the standing cron", async () => {
    const triggers = memoryTriggerStore();
    const started = deps({
      agents: packagedWorkers,
      triggerStore: triggers,
    });
    const first = await startSpecialist(
      {
        ...baseInput,
        specialistId: undefined,
        kind: "sales",
        task: "Always-on sales.",
      },
      started,
    );
    const second = await startSpecialist(
      {
        ...baseInput,
        specialistId: undefined,
        kind: "sales",
        task: "Keep going.",
      },
      started,
    );
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.standingTriggerId).toBe(first.standingTriggerId);
    expect(triggers.creates).toHaveLength(1);
    expect(started.enqueueCalls).toHaveLength(2);
  });

  test("kind=campaign does not create a standing cron", async () => {
    const triggers = memoryTriggerStore();
    const started = deps({
      agents: packagedWorkers,
      triggerStore: triggers,
    });
    await startSpecialist(
      {
        ...baseInput,
        specialistId: undefined,
        kind: "campaign",
        task: "Set up an email campaign for the waitlist.",
      },
      started,
    );
    expect(triggers.creates).toHaveLength(0);
  });

  test("refuses an unknown job kind without enqueueing", async () => {
    const started = deps({ agents: packagedWorkers });
    const result = await startSpecialist(
      {
        ...baseInput,
        specialistId: undefined,
        kind: "ops",
        task: "Do ops.",
      },
      started,
    );
    expect(result).toEqual({
      ok: false,
      error: SPECIALIST_REFUSALS.UNKNOWN_WORKER,
      status: 400,
    });
    expect(started.enqueueCalls).toEqual([]);
  });

  test("the packaged worker ids are campaign, research, and sales — not a nav family", () => {
    expect(WORKER_UNSCOPED_IDS).toEqual({
      campaign: "campaign-worker",
      research: "research-worker",
      sales: "sales-worker",
    });
    const agentsYaml = readFileSync(
      fileURLToPath(
        new URL("../../examples/fintech/agents.yaml", import.meta.url),
      ),
      "utf8",
    );
    const channelsYaml = readFileSync(
      fileURLToPath(
        new URL("../../examples/fintech/channels.yaml", import.meta.url),
      ),
      "utf8",
    );
    expect(agentsYaml).toContain("id: campaign-worker");
    expect(agentsYaml).toContain("id: research-worker");
    expect(agentsYaml).toContain("id: sales-worker");
    expect(agentsYaml).toContain("kind=campaign");
    expect(agentsYaml).toContain("kind=research");
    expect(agentsYaml).toContain("kind=sales");
    expect(channelsYaml).not.toContain("campaign-worker");
    expect(channelsYaml).not.toContain("research-worker");
    expect(channelsYaml).not.toContain("sales-worker");
    expect(channelsYaml).not.toMatch(/^\s+name: Sales\s*$/m);
    expect(channelsYaml).not.toMatch(/^\s+name: Website\s*$/m);
    expect(channelsYaml).not.toMatch(/^\s+name: Marketing\s*$/m);
  });
});
