import { describe, expect, test } from "bun:test";
import type { AuditEventInput, AuditStore } from "../src/audit";
import type {
  ChannelMessageStore,
  ChannelPostedMessage,
} from "../src/channels/messages";
import type { AgentChannel, ChannelStore } from "../src/channels/routes";
import type { WakeJob, WakeQueue } from "../src/channels/wake";
import { createComputerGateway } from "../src/computer/gateway";
import type { ActionPolicy } from "../src/computer/policy";
import type {
  ComputerLocation,
  ComputerProvider,
} from "../src/computer/provider";
import type { SnapshotResult } from "../src/computer/schema";
import { REFUSAL_MARKER } from "../src/plugins/tools";
import { childComputerTools } from "../src/subagents/computer-tools";
import {
  createSubagentGateway,
  SPAWN_SUBAGENT_TOOL,
} from "../src/subagents/gateway";
import type { SubagentRun, SubagentStore } from "../src/subagents/store";

const PERMISSIVE: ActionPolicy = { mode: "enforce", deny: [], allow: ["true"] };
const DENY_SHELL: ActionPolicy = {
  mode: "enforce",
  deny: ['intent == "run_command"'],
  allow: ["true"],
};
const actor = { id: "user-1", role: "user" as const };

const SNAPSHOT: SnapshotResult = {
  snapshotId: 7,
  url: "https://example.com/order",
  title: "Order",
  truncated: false,
  elements: [
    { ref: "e1", role: "input", name: "Customer name:", type: "text" },
    { ref: "e9", role: "button", name: "Submit order" },
  ],
};

function recorder() {
  const written: AuditEventInput[] = [];
  const auditStore: AuditStore = {
    insert: async (event) => {
      written.push(event);
    },
  };
  return { written, auditStore };
}

function fakeComputer(options?: {
  routes?: Record<string, (init?: RequestInit) => Response | Promise<Response>>;
}) {
  const calls: string[] = [];
  const locations: ComputerLocation[] = [];
  const provider: ComputerProvider = {
    name: "test",
    isolation: "per-bot",
    locate: async () => "http://agent-computer:4100",
    status: async (botId) => ({ botId, state: "ready" }),
    stop: async () => ({ wasRunning: true }),
    reset: async () => ({ cleared: true }),
    list: async () => locations,
  };
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname;
    calls.push(path);
    if (options?.routes && path in options.routes) {
      return options.routes[path](init);
    }
    switch (path) {
      case "/snapshot":
        return Response.json(SNAPSHOT);
      case "/navigate":
        return Response.json({
          url: "https://example.com/",
          title: "Example",
          text: "Hello",
          truncated: false,
        });
      case "/exec":
        return Response.json({
          command: "ls",
          exitCode: 0,
          stdout: "notes.md",
          stderr: "",
          truncated: false,
          timedOut: false,
          elapsedMs: 1,
        });
      case "/click":
        return Response.json({
          action: "click",
          url: SNAPSHOT.url,
          elapsedMs: 1,
        });
      case "/control/request":
        return Response.json({ holder: "human", requested: true });
      case "/control/secret":
        return Response.json({
          holder: "human",
          secretWanted: { label: "the code" },
        });
      default:
        return Response.json({ error: `Unknown ${path}` }, { status: 404 });
    }
  }) as unknown as typeof fetch;
  return { provider, fetchImpl, calls };
}

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

function memoryChannels(): ChannelStore & { created: AgentChannel[] } {
  const created: AgentChannel[] = [];
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
    async get(owner, id) {
      return (
        rows.find((row) => row.id === id && row.actorUserId === owner.id) ??
        null
      );
    },
    async getForParent(owner, parentAgentId, id) {
      return (
        rows.find(
          (row) =>
            row.id === id &&
            row.parentAgentId === parentAgentId &&
            row.actorUserId === owner.id,
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

async function childHarness(policy: ActionPolicy = PERMISSIVE) {
  const computerFake = fakeComputer();
  const { written, auditStore } = recorder();
  const computer = createComputerGateway({
    provider: computerFake.provider,
    fetchImpl: computerFake.fetchImpl,
    auditStore,
    policy: () => policy,
  });
  const runs = memoryRuns();
  const wake = wakeCapture();
  const subagents = createSubagentGateway({
    runs,
    channels: memoryChannels(),
    messages: memoryMessages(),
    auditStore,
    policy: () => PERMISSIVE,
    wake,
  });
  await subagents.spawn({
    botId: "risk",
    actor,
    goal: "Open the vendor page and list the workspace.",
    successCriteria: "The page title and the files.",
    reportBack: "Title and files.",
  });
  const subagentId = runs.rows[0]?.id ?? "";
  wake.jobs.splice(0);
  const tools = childComputerTools({
    computer,
    subagents,
    botId: "risk",
    actor,
    subagentId,
  });
  return {
    tools,
    calls: computerFake.calls,
    written,
    runs,
    wake,
    subagentId,
    computer,
  };
}

describe("a child's computer tools", () => {
  test("offer the parent's computer and not spawn or messaging", async () => {
    const { tools } = await childHarness();
    const names = tools.map((tool) => tool.name);
    expect(names).toContain("computer_navigate");
    expect(names).toContain("computer_run_command");
    expect(names).toContain("computer_request_help");
    expect(names).not.toContain(SPAWN_SUBAGENT_TOOL);
    expect(names).not.toContain("message_agent");
    expect(names).not.toContain("message_channel");
  });

  test("a child shell command goes through the gateway and is audited", async () => {
    const { tools, calls, written } = await childHarness();
    const run = tools.find((tool) => tool.name === "computer_run_command");
    const answer = await run?.execute({ command: "ls" });

    expect(calls).toContain("/exec");
    expect(answer).toContain("notes.md");
    expect(
      written.some((row) => row.eventType === "computer.action_allowed"),
    ).toBe(true);
    expect(
      written.find((row) => row.eventType === "computer.action_allowed")
        ?.payload,
    ).toMatchObject({ action: "computer_run_command" });
  });

  test("a child navigation goes through the gateway and is audited", async () => {
    const { tools, calls, written } = await childHarness();
    const navigate = tools.find((tool) => tool.name === "computer_navigate");
    const answer = await navigate?.execute({ url: "https://example.com/" });

    expect(calls).toContain("/navigate");
    expect(answer).toContain("Example");
    expect(
      written.some((row) => row.eventType === "computer.action_allowed"),
    ).toBe(true);
    expect(
      written.find((row) => row.eventType === "computer.action_allowed")
        ?.payload,
    ).toMatchObject({ action: "computer_navigate" });
  });

  test("a policy deny is refused, does not reach the computer, and is audited", async () => {
    const { tools, calls, written } = await childHarness(DENY_SHELL);
    const run = tools.find((tool) => tool.name === "computer_run_command");
    const answer = await run?.execute({ command: "rm -rf /" });

    expect(answer?.startsWith(REFUSAL_MARKER)).toBe(true);
    expect(calls).not.toContain("/exec");
    expect(
      written.some((row) => row.eventType === "computer.action_refused"),
    ).toBe(true);
    expect(
      written.find((row) => row.eventType === "computer.action_refused")
        ?.payload,
    ).toMatchObject({ action: "computer_run_command" });
  });

  test("asking for help reports blocked to the parent instead of waiting", async () => {
    const { tools, calls, written, runs, wake, subagentId } =
      await childHarness();
    const help = tools.find((tool) => tool.name === "computer_request_help");
    const answer = await help?.execute({
      reason: "This page is asking for a sign-in.",
    });

    expect(calls).toContain("/control/request");
    expect(answer).toContain("blocked");
    expect(runs.rows[0]?.status).toBe("blocked");
    expect(runs.rows[0]?.result).toContain(subagentId);
    expect(runs.rows[0]?.result).toContain("sign-in");
    expect(wake.jobs).toHaveLength(1);
    expect(wake.jobs[0]?.subagentId).toBeUndefined();
    expect(wake.jobs[0]?.inbound.body).toContain("blocked");
    expect(
      written.some((row) => row.eventType === "computer.help_requested"),
    ).toBe(true);
    expect(written.some((row) => row.eventType === "subagent.reported")).toBe(
      true,
    );
  });

  test("a person already holding the wheel reports blocked", async () => {
    const computerFake = fakeComputer({
      routes: {
        "/click": () =>
          Response.json(
            {
              error:
                "A person has control of the computer right now. Wait for them to hand it back before acting.",
              humanHasControl: true,
            },
            { status: 409 },
          ),
      },
    });
    const { written, auditStore } = recorder();
    const computer = createComputerGateway({
      provider: computerFake.provider,
      fetchImpl: computerFake.fetchImpl,
      auditStore,
      policy: () => PERMISSIVE,
    });
    const runs = memoryRuns();
    const wake = wakeCapture();
    const subagents = createSubagentGateway({
      runs,
      channels: memoryChannels(),
      messages: memoryMessages(),
      auditStore,
      policy: () => PERMISSIVE,
      wake,
    });
    await subagents.spawn({
      botId: "risk",
      actor,
      goal: "Click submit.",
      successCriteria: "The form is sent.",
      reportBack: "Whether it sent.",
    });
    const subagentId = runs.rows[0]?.id ?? "";
    wake.jobs.splice(0);
    await computer.snapshot("risk");
    const tools = childComputerTools({
      computer,
      subagents,
      botId: "risk",
      actor,
      subagentId,
    });
    const click = tools.find((tool) => tool.name === "computer_click");
    const answer = await click?.execute({ ref: "e9", snapshotId: 7 });

    expect(answer).toContain("humanHasControl");
    expect(answer).toContain("blocked");
    expect(runs.rows[0]?.status).toBe("blocked");
    expect(wake.jobs).toHaveLength(1);
    expect(written.some((row) => row.eventType === "subagent.reported")).toBe(
      true,
    );
  });
});
