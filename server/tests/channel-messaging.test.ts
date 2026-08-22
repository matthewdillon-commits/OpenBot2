import { describe, expect, test } from "bun:test";
import type { AuditEventInput, AuditStore } from "../src/audit";
import { isEmptyOrAck, MAX_MESSAGE_HOP } from "../src/channels/ack";
import {
  createMessagingGateway,
  MESSAGE_AGENT_TOOL,
  MESSAGE_CHANNEL_TOOL,
} from "../src/channels/messaging";
import type { ChannelMessageStore, ChannelPostedMessage } from "../src/channels/messages";
import type {
  AgentChannel,
  ChannelStore,
} from "../src/channels/routes";
import { messagingTools } from "../src/channels/tools";
import type { WakeJob, WakeQueue } from "../src/channels/wake";
import type { ActionPolicy } from "../src/computer/policy";
import { REFUSAL_MARKER } from "../src/plugins/tools";

const PERMISSIVE: ActionPolicy = { mode: "enforce", deny: [], allow: ["true"] };
const DENY_MESSAGE: ActionPolicy = {
  mode: "enforce",
  deny: ['intent == "message"'],
  allow: ["true"],
};

const actor = { id: "user-1", role: "user" as const };

function channel(overrides: Partial<AgentChannel> = {}): AgentChannel {
  return {
    id: "channel-room",
    name: "Risk, Knowledge",
    agentIds: ["risk", "knowledge"],
    threadId: "thread-1",
    active: true,
    kind: "channel",
    ...overrides,
  };
}

function posted(
  overrides: Partial<ChannelPostedMessage> = {},
): ChannelPostedMessage {
  return {
    id: "msg_1",
    channelId: "channel-room",
    senderAgentId: "risk",
    senderName: "Risk",
    body: "Please review the vendor list.",
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
): ChannelStore & { created: AgentChannel[]; activity: unknown[] } {
  const created: AgentChannel[] = [...existing];
  const activity: unknown[] = [];
  return {
    created,
    activity,
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
      return { channels: [], nextCursor: null };
    },
    async recordActivity(_actor, channelId, report) {
      activity.push({ channelId, ...report });
    },
    async update(_actor, channelId, patch) {
      const current = created.find((entry) => entry.id === channelId);
      if (!current) throw new Error("missing");
      if (patch.name) current.name = patch.name;
      if (patch.addAgentIds) {
        current.agentIds = [...current.agentIds, ...patch.addAgentIds];
      }
      if (patch.removeAgentIds) {
        current.agentIds = current.agentIds.filter(
          (id) => !patch.removeAgentIds?.includes(id),
        );
      }
      return current;
    },
    async findDirect(_actor, senderAgentId, recipientAgentId) {
      return (
        created.find(
          (entry) =>
            entry.kind === "direct" &&
            entry.agentIds.includes(senderAgentId) &&
            entry.agentIds.includes(recipientAgentId),
        ) ?? null
      );
    },
    async findOrCreateDirect(_actor, senderAgentId, recipientAgentId) {
      const found = created.find(
        (entry) =>
          entry.kind === "direct" &&
          entry.agentIds.includes(senderAgentId) &&
          entry.agentIds.includes(recipientAgentId),
      );
      if (found) return found;
      const next = channel({
        id: "channel-dm",
        name: `${senderAgentId}, ${recipientAgentId}`,
        agentIds: [senderAgentId, recipientAgentId],
        kind: "direct",
      });
      created.push(next);
      return next;
    },
  };
}

function wakeCapture(
  running: string[] = [],
): WakeQueue & { jobs: WakeJob[] } {
  const jobs: WakeJob[] = [];
  return {
    jobs,
    enqueue(job) {
      jobs.push(job);
    },
    isRunning(botId) {
      return running.includes(botId);
    },
  };
}

describe("empty acknowledgements", () => {
  test.each([
    [""],
    ["   "],
    ["ok"],
    ["Got it."],
    ["thanks"],
    ["will do"],
    ["👍"],
  ])("treats %p as nothing to deliver", (text) => {
    expect(isEmptyOrAck(text)).toBe(true);
  });

  test("lets a real question through", () => {
    expect(isEmptyOrAck("What is the residual risk on vendor 12?")).toBe(false);
  });
});

describe("a Bot messaging another Bot", () => {
  test("opens a direct channel, stores the message, audits, and wakes the recipient", async () => {
    const channels = memoryChannels();
    const messages = memoryMessages();
    const { written, auditStore } = recorder();
    const wake = wakeCapture();
    const gateway = createMessagingGateway({
      channels,
      messages,
      auditStore,
      policy: () => PERMISSIVE,
      wake,
    });

    const answer = await gateway.messageAgent({
      botId: "risk",
      actor,
      recipientAgentId: "knowledge",
      text: "Please pull the latest vendor policy.",
    });

    expect(answer).toContain("Sent");
    expect(answer).not.toContain(REFUSAL_MARKER);
    expect(channels.created[0]?.kind).toBe("direct");
    expect(channels.created[0]?.agentIds).toEqual(["risk", "knowledge"]);
    expect(messages.rows).toHaveLength(1);
    expect(messages.rows[0]?.body).toBe("Please pull the latest vendor policy.");
    expect(messages.rows[0]?.hop).toBe(1);
    expect(wake.jobs).toEqual([
      expect.objectContaining({
        botId: "knowledge",
        channelId: "channel-dm",
      }),
    ]);
    expect(written).toHaveLength(1);
    expect(written[0]?.eventType).toBe("channel.message_sent");
    expect(written[0]?.targetType).toBe("channel");
    expect(written[0]?.payload).toMatchObject({
      bot: "risk",
      tool: MESSAGE_AGENT_TOOL,
      recipient: "knowledge",
      text: "Please pull the latest vendor policy.",
      decision: { carriedOut: true },
    });
  });

  test("reuses the existing direct channel rather than opening another", async () => {
    const existing = channel({
      id: "channel-dm",
      kind: "direct",
      agentIds: ["risk", "knowledge"],
    });
    const channels = memoryChannels([existing]);
    const gateway = createMessagingGateway({
      channels,
      messages: memoryMessages(),
      auditStore: recorder().auditStore,
      policy: () => PERMISSIVE,
      wake: wakeCapture(),
    });

    await gateway.messageAgent({
      botId: "knowledge",
      actor,
      recipientAgentId: "risk",
      text: "Here is the vendor policy excerpt.",
    });

    expect(channels.created).toHaveLength(1);
    expect(channels.created[0]?.id).toBe("channel-dm");
  });

  test("refuses a send from a Bot that is currently being woken", async () => {
    const channels = memoryChannels();
    const messages = memoryMessages();
    const { written, auditStore } = recorder();
    const answer = await createMessagingGateway({
      channels,
      messages,
      auditStore,
      policy: () => PERMISSIVE,
      wake: wakeCapture(["risk"]),
    }).messageAgent({
      botId: "risk",
      actor,
      recipientAgentId: "knowledge",
      text: "Please pull the latest vendor policy.",
    });

    expect(answer.startsWith(REFUSAL_MARKER)).toBe(true);
    expect(answer).toContain("answering");
    expect(messages.rows).toHaveLength(0);
    expect(written).toHaveLength(0);
    expect(channels.created).toHaveLength(0);
  });

  test("refuses an empty acknowledgement without writing or waking", async () => {
    const channels = memoryChannels();
    const messages = memoryMessages();
    const { written, auditStore } = recorder();
    const wake = wakeCapture();
    const answer = await createMessagingGateway({
      channels,
      messages,
      auditStore,
      policy: () => PERMISSIVE,
      wake,
    }).messageAgent({
      botId: "risk",
      actor,
      recipientAgentId: "knowledge",
      text: "got it",
    });

    expect(answer.startsWith(REFUSAL_MARKER)).toBe(true);
    expect(messages.rows).toHaveLength(0);
    expect(wake.jobs).toHaveLength(0);
    expect(written).toHaveLength(0);
  });
});

describe("a Bot posting to a group channel", () => {
  test("stores the post, audits, and wakes the other members", async () => {
    const room = channel();
    const channels = memoryChannels([room]);
    const messages = memoryMessages();
    const { written, auditStore } = recorder();
    const wake = wakeCapture();

    const answer = await createMessagingGateway({
      channels,
      messages,
      auditStore,
      policy: () => PERMISSIVE,
      wake,
    }).messageChannel({
      botId: "risk",
      actor,
      channelId: room.id,
      text: "Vendor 12 exceeds residual risk. Knowledge, please confirm the source.",
    });

    expect(answer).toContain("Posted");
    expect(messages.rows).toHaveLength(1);
    expect(wake.jobs.map((job) => job.botId)).toEqual(["knowledge"]);
    expect(written[0]?.eventType).toBe("channel.message_sent");
    expect(written[0]?.payload).toMatchObject({
      tool: MESSAGE_CHANNEL_TOOL,
      bot: "risk",
    });
  });

  test("refuses a Bot that is not a member", async () => {
    const channels = memoryChannels([channel()]);
    const answer = await createMessagingGateway({
      channels,
      messages: memoryMessages(),
      auditStore: recorder().auditStore,
      policy: () => PERMISSIVE,
      wake: wakeCapture(),
    }).messageChannel({
      botId: "stranger",
      actor,
      channelId: "channel-room",
      text: "I should not be able to post this.",
    });

    expect(answer.startsWith(REFUSAL_MARKER)).toBe(true);
    expect(answer.toLowerCase()).toContain("not a member");
  });
});

describe("the messaging gateway policy", () => {
  test("audits a refusal and does not send, store, or wake", async () => {
    const channels = memoryChannels();
    const messages = memoryMessages();
    const { written, auditStore } = recorder();
    const wake = wakeCapture();

    const answer = await createMessagingGateway({
      channels,
      messages,
      auditStore,
      policy: () => DENY_MESSAGE,
      wake,
    }).messageAgent({
      botId: "risk",
      actor,
      recipientAgentId: "knowledge",
      text: "Please pull the latest vendor policy.",
    });

    expect(answer.startsWith(REFUSAL_MARKER)).toBe(true);
    expect(answer).toContain("message_agent");
    expect(messages.rows).toHaveLength(0);
    expect(wake.jobs).toHaveLength(0);
    expect(written).toHaveLength(1);
    expect(written[0]?.eventType).toBe("channel.message_refused");
    expect(written[0]?.payload).toMatchObject({
      decision: { carriedOut: false, allowed: false },
    });
  });
});

describe("the messaging tools", () => {
  test("offer message_agent and message_channel to a Bot", () => {
    const tools = messagingTools({
      messaging: createMessagingGateway({
        channels: memoryChannels(),
        messages: memoryMessages(),
        auditStore: recorder().auditStore,
        policy: () => PERMISSIVE,
        wake: wakeCapture(),
      }),
      botId: "risk",
      actor,
    });

    expect(tools.map((tool) => tool.name)).toEqual([
      MESSAGE_AGENT_TOOL,
      MESSAGE_CHANNEL_TOOL,
    ]);
  });

  test("a wake reply is not itself woken past the hop ceiling", async () => {
    expect(MAX_MESSAGE_HOP).toBe(2);
    const postedReply = await createMessagingGateway({
      channels: memoryChannels([channel()]),
      messages: memoryMessages(),
      auditStore: recorder().auditStore,
      policy: () => PERMISSIVE,
      wake: wakeCapture(),
    }).postWakeReply({
      botId: "knowledge",
      actor,
      channelId: "channel-room",
      text: "ok",
      hop: 2,
    });
    expect(postedReply).toBeNull();
  });
});
