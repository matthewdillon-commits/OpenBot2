import { describe, expect, test } from "bun:test";
import type { AuditEventInput, AuditStore } from "../src/audit";
import { MAX_MESSAGE_HOP } from "../src/channels/ack";
import type {
  ChannelMessageStore,
  ChannelPostedMessage,
} from "../src/channels/messages";
import type { AgentChannel, ChannelStore } from "../src/channels/routes";
import type { WakeJob, WakeQueue } from "../src/channels/wake";
import { createWakeQueue } from "../src/channels/wake";
import type { ActionPolicy } from "../src/computer/policy";
import { REFUSAL_MARKER } from "../src/plugins/tools";
import {
  createSubagentGateway,
  REPORT_SUBAGENT_TOOL,
  SPAWN_SUBAGENT_TOOL,
} from "../src/subagents/gateway";
import type { SubagentRun, SubagentStore } from "../src/subagents/store";
import { reportSubagentTool, subagentTools } from "../src/subagents/tools";

const PERMISSIVE: ActionPolicy = { mode: "enforce", deny: [], allow: ["true"] };
const DENY_SPAWN: ActionPolicy = {
  mode: "enforce",
  deny: ['intent == "spawn"'],
  allow: ["true"],
};

const actor = { id: "user-1", role: "user" as const };

function channel(overrides: Partial<AgentChannel> = {}): AgentChannel {
  return {
    id: "channel-task",
    name: "Sub-agent: Review vendor 12",
    agentIds: ["risk"],
    threadId: "thread-task",
    active: true,
    kind: "task",
    ...overrides,
  };
}

function posted(
  overrides: Partial<ChannelPostedMessage> = {},
): ChannelPostedMessage {
  return {
    id: "msg_1",
    channelId: "channel-task",
    senderAgentId: "risk",
    senderName: "Risk",
    body: "Goal:\nReview vendor 12",
    hop: 1,
    createdAt: new Date("2026-08-22T00:00:00.000Z"),
    ...overrides,
  };
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

function memoryMessages(): ChannelMessageStore & {
  rows: ChannelPostedMessage[];
} {
  const rows: ChannelPostedMessage[] = [];
  return {
    rows,
    async post(input) {
      const row = posted({
        id: `msg_${rows.length + 1}`,
        channelId: input.channelId,
        senderAgentId: input.senderAgentId,
        senderName: input.senderAgentId,
        body: input.body,
        hop: input.hop,
        createdAt: new Date(),
      });
      rows.push(row);
      return row;
    },
    async list() {
      return rows;
    },
  };
}

function memoryChannels(
  existing: AgentChannel[] = [],
): ChannelStore & { created: AgentChannel[] } {
  const created: AgentChannel[] = [...existing];
  return {
    created,
    async create(_actor, agentIds, options) {
      const next = channel({
        id: `channel_${created.length}`,
        agentIds,
        name: options?.name ?? agentIds.join(", "),
        kind: options?.kind ?? "channel",
      });
      created.push(next);
      return next;
    },
    async get(_actor, channelId) {
      return created.find((entry) => entry.id === channelId) ?? null;
    },
    async list() {
      return {
        channels: created
          .filter((entry) => entry.kind !== "task")
          .map((entry) => ({
            ...entry,
            lastMessage: null,
            lastMessageAt: null,
            lastMessageAgentId: null,
            createdAt: new Date(),
          })),
        nextCursor: null,
      };
    },
    async recordActivity() {},
    async update(_actor, channelId) {
      const current = created.find((entry) => entry.id === channelId);
      if (!current) throw new Error("missing");
      return current;
    },
    async findDirect() {
      return null;
    },
    async findOrCreateDirect() {
      throw new Error("not used");
    },
  };
}

function memoryRuns(): SubagentStore & { rows: SubagentRun[] } {
  const rows: SubagentRun[] = [];
  const now = () => new Date();
  return {
    rows,
    async create(input) {
      const row: SubagentRun = {
        id: `subagent_${rows.length + 1}`,
        parentAgentId: input.parentAgentId,
        actorUserId: input.actor.id,
        channelId: input.channelId,
        goal: input.goal,
        successCriteria: input.successCriteria,
        reportBack: input.reportBack,
        followUp: null,
        followUpAt: null,
        status: "queued",
        result: null,
        hop: 1,
        createdAt: now(),
        updatedAt: now(),
        completedAt: null,
      };
      rows.push(row);
      return row;
    },
    async get(actor, id) {
      return (
        rows.find((row) => row.id === id && row.actorUserId === actor.id) ??
        null
      );
    },
    async getForParent(actor, parentAgentId, id) {
      return (
        rows.find(
          (row) =>
            row.id === id &&
            row.parentAgentId === parentAgentId &&
            row.actorUserId === actor.id,
        ) ?? null
      );
    },
    async markRunning(id) {
      const row = rows.find((entry) => entry.id === id);
      if (row) row.status = "running";
    },
    async setFollowUp(id, text, hop, status) {
      const row = rows.find((entry) => entry.id === id);
      if (!row) throw new Error("missing");
      row.followUp = text;
      row.followUpAt = now();
      row.hop = hop;
      row.status = status;
      row.updatedAt = now();
      return row;
    },
    async complete(id, status, result) {
      const row = rows.find((entry) => entry.id === id);
      if (!row) throw new Error("missing");
      row.status = status;
      row.result = result;
      row.completedAt = now();
      row.updatedAt = now();
      return row;
    },
  };
}

function wakeCapture(): WakeQueue & { jobs: WakeJob[] } {
  const jobs: WakeJob[] = [];
  return {
    jobs,
    enqueue(job) {
      jobs.push(job);
    },
    isRunning() {
      return false;
    },
  };
}

function gateway(
  overrides: {
    runs?: SubagentStore;
    channels?: ChannelStore;
    messages?: ChannelMessageStore;
    auditStore?: AuditStore;
    policy?: () => ActionPolicy;
    wake?: WakeQueue;
  } = {},
) {
  return createSubagentGateway({
    runs: overrides.runs ?? memoryRuns(),
    channels: overrides.channels ?? memoryChannels(),
    messages: overrides.messages ?? memoryMessages(),
    auditStore: overrides.auditStore ?? recorder().auditStore,
    policy: overrides.policy ?? (() => PERMISSIVE),
    wake: overrides.wake ?? wakeCapture(),
  });
}

describe("spawning a sub-agent", () => {
  test("returns an id immediately, stores a run, and enqueues the child", async () => {
    const runs = memoryRuns();
    const channels = memoryChannels();
    const messages = memoryMessages();
    const { written, auditStore } = recorder();
    const wake = wakeCapture();

    const answer = await gateway({
      runs,
      channels,
      messages,
      auditStore,
      wake,
    }).spawn({
      botId: "risk",
      actor,
      goal: "Review vendor 12 against the June policy.",
      successCriteria: "A residual-risk figure and the section it came from.",
      reportBack: "The figure and whether it exceeds 0.3.",
    });

    expect(answer).toContain("Started sub-agent");
    expect(answer).toContain("Do not wait");
    expect(answer).not.toContain(REFUSAL_MARKER);
    expect(runs.rows).toHaveLength(1);
    expect(runs.rows[0]?.parentAgentId).toBe("risk");
    expect(runs.rows[0]?.status).toBe("queued");
    expect(channels.created[0]?.kind).toBe("task");
    expect(channels.created[0]?.agentIds).toEqual(["risk"]);
    expect(messages.rows).toHaveLength(1);
    expect(wake.jobs).toHaveLength(1);
    expect(wake.jobs[0]?.subagentId).toBe(runs.rows[0]?.id);
    expect(wake.jobs[0]?.botId).toBe("risk");
    expect(written).toHaveLength(1);
    expect(written[0]?.eventType).toBe("subagent.started");
    expect(written[0]?.payload).toMatchObject({
      bot: "risk",
      tool: SPAWN_SUBAGENT_TOOL,
      decision: { carriedOut: true },
    });
  });

  test("a second spawn is an independent run", async () => {
    const runs = memoryRuns();
    const wake = wakeCapture();
    const subagents = gateway({ runs, wake });

    const first = await subagents.spawn({
      botId: "risk",
      actor,
      goal: "Review vendor 12.",
      successCriteria: "A residual-risk figure.",
      reportBack: "The figure.",
    });
    const second = await subagents.spawn({
      botId: "risk",
      actor,
      goal: "Draft the board note.",
      successCriteria: "A one-page summary.",
      reportBack: "The draft.",
    });

    expect(first).not.toEqual(second);
    expect(runs.rows).toHaveLength(2);
    expect(runs.rows[0]?.id).not.toBe(runs.rows[1]?.id);
    expect(wake.jobs).toHaveLength(2);
    expect(wake.jobs[0]?.subagentId).not.toBe(wake.jobs[1]?.subagentId);
  });

  test("a follow-up goes to the same worker, not a duplicate", async () => {
    const runs = memoryRuns();
    const wake = wakeCapture();
    const subagents = gateway({ runs, wake });

    await subagents.spawn({
      botId: "risk",
      actor,
      goal: "Review vendor 12.",
      successCriteria: "A residual-risk figure.",
      reportBack: "The figure.",
    });
    const id = runs.rows[0]?.id ?? "";
    const answer = await subagents.spawn({
      botId: "risk",
      actor,
      goal: "Use the July addendum, not June.",
      successCriteria: "",
      reportBack: "",
      subagentId: id,
    });

    expect(answer).toContain(id);
    expect(answer).toContain("follow-up");
    expect(runs.rows).toHaveLength(1);
    expect(runs.rows[0]?.followUp).toBe("Use the July addendum, not June.");
    expect(runs.rows[0]?.hop).toBe(2);
    expect(wake.jobs).toHaveLength(2);
    expect(wake.jobs[1]?.subagentId).toBe(id);
  });

  test("refuses an empty brief without writing a run", async () => {
    const runs = memoryRuns();
    const { written, auditStore } = recorder();
    const answer = await gateway({ runs, auditStore }).spawn({
      botId: "risk",
      actor,
      goal: "ok",
      successCriteria: "ok",
      reportBack: "ok",
    });

    expect(answer.startsWith(REFUSAL_MARKER)).toBe(true);
    expect(runs.rows).toHaveLength(0);
    expect(written).toHaveLength(0);
  });

  test("a deny rule is audited and does not start a run", async () => {
    const runs = memoryRuns();
    const channels = memoryChannels();
    const { written, auditStore } = recorder();
    const wake = wakeCapture();

    const answer = await gateway({
      runs,
      channels,
      auditStore,
      wake,
      policy: () => DENY_SPAWN,
    }).spawn({
      botId: "risk",
      actor,
      goal: "Review vendor 12 against the June policy.",
      successCriteria: "A residual-risk figure.",
      reportBack: "The figure.",
    });

    expect(answer.startsWith(REFUSAL_MARKER)).toBe(true);
    expect(answer).toContain("spawn_subagent");
    expect(runs.rows).toHaveLength(0);
    expect(channels.created).toHaveLength(0);
    expect(wake.jobs).toHaveLength(0);
    expect(written).toHaveLength(1);
    expect(written[0]?.eventType).toBe("subagent.refused");
    expect(written[0]?.payload).toMatchObject({
      decision: { carriedOut: false, allowed: false },
    });
  });
});

describe("a child reporting back", () => {
  test("stores the result and wakes the parent, not another child", async () => {
    const runs = memoryRuns();
    const channels = memoryChannels();
    const messages = memoryMessages();
    const { written, auditStore } = recorder();
    const wake = wakeCapture();
    const subagents = gateway({
      runs,
      channels,
      messages,
      auditStore,
      wake,
    });

    await subagents.spawn({
      botId: "risk",
      actor,
      goal: "Review vendor 12.",
      successCriteria: "A residual-risk figure.",
      reportBack: "The figure.",
    });
    const id = runs.rows[0]?.id ?? "";
    wake.jobs.splice(0);

    const answer = await subagents.report({
      botId: "risk",
      actor,
      subagentId: id,
      status: "done",
      result: "Vendor 12 residual risk is 0.42, June policy section 4.",
    });

    expect(answer).toContain("Reported");
    expect(runs.rows[0]?.status).toBe("completed");
    expect(runs.rows[0]?.result).toContain("0.42");
    expect(wake.jobs).toHaveLength(1);
    expect(wake.jobs[0]?.botId).toBe("risk");
    expect(wake.jobs[0]?.subagentId).toBeUndefined();
    expect(wake.jobs[0]?.inbound.body).toContain(id);
    expect(written.some((row) => row.eventType === "subagent.reported")).toBe(
      true,
    );
    expect(
      written.find((row) => row.eventType === "subagent.reported")?.payload,
    ).toMatchObject({ tool: REPORT_SUBAGENT_TOOL });
  });

  test("a blocker still wakes the parent", async () => {
    const runs = memoryRuns();
    const wake = wakeCapture();
    const subagents = gateway({ runs, wake });
    await subagents.spawn({
      botId: "risk",
      actor,
      goal: "Review vendor 12.",
      successCriteria: "A residual-risk figure.",
      reportBack: "The figure.",
    });
    const id = runs.rows[0]?.id ?? "";
    wake.jobs.splice(0);

    await subagents.report({
      botId: "risk",
      actor,
      subagentId: id,
      status: "blocked",
      result: "The June policy is not in the workspace.",
    });

    expect(runs.rows[0]?.status).toBe("blocked");
    expect(wake.jobs).toHaveLength(1);
    expect(wake.jobs[0]?.inbound.body).toContain("blocked");
  });
});

describe("the sub-agent tools", () => {
  test("offer spawn_subagent to a parent", () => {
    const tools = subagentTools({
      subagents: gateway(),
      botId: "risk",
      actor,
    });
    expect(tools.map((tool) => tool.name)).toEqual([SPAWN_SUBAGENT_TOOL]);
  });

  test("offer report_subagent to a child", () => {
    const tool = reportSubagentTool({
      subagents: gateway(),
      botId: "risk",
      actor,
      subagentId: "subagent_1",
    });
    expect(tool.name).toBe(REPORT_SUBAGENT_TOOL);
  });
});

describe("the wake queue with a child run", () => {
  test("a child in flight does not mark the parent as answering a message", async () => {
    let release: () => void = () => {};
    const held = new Promise<string | null>((resolve) => {
      release = () => resolve(null);
    });
    const queue = createWakeQueue(async (job) => {
      if (job.subagentId) return held;
      return null;
    });

    queue.enqueue({
      channelId: "channel-task",
      botId: "risk",
      actor,
      inbound: posted(),
      subagentId: "subagent_1",
    });

    expect(queue.isRunning("risk")).toBe(false);
    release();
    await held;
  });

  test("two independent children can be enqueued together", async () => {
    const seen: string[] = [];
    const queue = createWakeQueue(async (job) => {
      seen.push(job.subagentId ?? "");
      return null;
    });
    queue.enqueue({
      channelId: "a",
      botId: "risk",
      actor,
      inbound: posted(),
      subagentId: "subagent_1",
    });
    queue.enqueue({
      channelId: "b",
      botId: "risk",
      actor,
      inbound: posted(),
      subagentId: "subagent_2",
    });
    await Promise.resolve();
    expect(seen).toEqual(["subagent_1", "subagent_2"]);
  });
});

describe("sub-agent hop limit", () => {
  test("refuses a follow-up past the last allowed hop", async () => {
    const runs = memoryRuns();
    const subagents = gateway({ runs });
    await subagents.spawn({
      botId: "risk",
      actor,
      goal: "Review vendor 12.",
      successCriteria: "A residual-risk figure.",
      reportBack: "The figure.",
    });
    const id = runs.rows[0]?.id ?? "";
    const row = runs.rows[0];
    if (row) row.hop = MAX_MESSAGE_HOP;

    const answer = await subagents.spawn({
      botId: "risk",
      actor,
      goal: "One more correction.",
      successCriteria: "",
      reportBack: "",
      subagentId: id,
    });
    expect(answer.startsWith(REFUSAL_MARKER)).toBe(true);
    expect(answer).toContain("far enough");
    expect(runs.rows[0]?.followUp).toBeNull();
  });
});
