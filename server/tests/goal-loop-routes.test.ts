import { describe, expect, test } from "bun:test";
import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import type { AppVariables } from "../src/auth/guards";
import type { ChannelStore } from "../src/channels/routes";
import {
  createGoalLoopRoutes,
  createHighRiskWait,
  createMemoryGoalLoopStore,
  emptyGoalLoop,
  orchestratorContextFromLoop,
} from "../src/loop";

const actor = {
  id: "user-1",
  email: "ada@openbot.test",
  role: "user" as const,
  orgId: "org_local",
};

const requireUser: MiddlewareHandler<{ Variables: AppVariables }> = async (
  context,
  next,
) => {
  context.set("actor", actor);
  await next();
};

const presentChannel: ChannelStore = {
  get: async () => ({
    id: "channel_1",
    name: "Book Ada",
    agentIds: ["orchestrator"],
    threadId: "thread-1",
    active: true,
  }),
  getByThread: async () => null,
  addAgents: async () => {
    throw new Error("must not add");
  },
  create: async () => {
    throw new Error("must not mint a channel");
  },
  list: async () => ({ channels: [], nextCursor: null }),
  recordActivity: async () => undefined,
};

function mount(
  loopStore: ReturnType<typeof createMemoryGoalLoopStore>,
  executePending?: (input: {
    toolName: string;
    args: Record<string, unknown>;
  }) => Promise<string>,
) {
  const app = new Hono();
  app.route(
    "/api/channels",
    createGoalLoopRoutes({
      requireUser,
      channelStore: presentChannel,
      loopStore,
      executePending: executePending
        ? async (input) => executePending(input)
        : undefined,
    }),
  );
  return app;
}

describe("goal loop routes", () => {
  test("keep records the decision, carries the pending action out, and feeds the next choice", async () => {
    const loopStore = createMemoryGoalLoopStore();
    const wait = createHighRiskWait({ loopStore });
    const { runInGoalActionScope } = await import("../src/loop/scope");
    await runInGoalActionScope(
      {
        orgId: "org_local",
        channelId: "channel_1",
        goalId: "channel_1",
        actorId: actor.id,
        botId: "orchestrator",
        toolName: "crm_create",
        args: { kind: "person", name: "Casey" },
      },
      () =>
        wait({
          context: {
            tool: { name: "crm_create" },
            bot: { id: "orchestrator" },
            actor: { id: actor.id },
            page: { url: "", host: "" },
            intent: "crm",
          },
          args: { kind: "person", name: "Casey" },
        }),
    );

    const executed: string[] = [];
    const app = mount(loopStore, async ({ toolName }) => {
      executed.push(toolName);
      return "created Casey";
    });

    const kept = await app.request(
      "http://openbot.test/api/channels/channel_1/loop/decision",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision: "keep", note: "Ship it." }),
      },
    );
    expect(kept.status).toBe(200);
    const body = (await kept.json()) as {
      loop: {
        lastDecision: { decision: string; note: string | null };
        outcome: string;
        approval: { status: string } | null;
      };
      carriedOut: string | null;
    };
    expect(body.carriedOut).toBe("created Casey");
    expect(executed).toEqual(["crm_create"]);
    expect(body.loop.lastDecision.decision).toBe("keep");
    expect(body.loop.lastDecision.note).toBe("Ship it.");
    expect(body.loop.outcome).toBe("unknown");
    expect(body.loop.approval?.status).toBe("decided");
    expect(JSON.stringify(body)).not.toContain("pending");

    const stored = await loopStore.get("org_local", "channel_1");
    const guidance = orchestratorContextFromLoop(stored);
    expect(guidance).toContain("Owner's last decision on this goal: keep");
    expect(guidance).toContain("Ship it.");
    expect(guidance).toContain("Measured outcome: unknown");
  });

  test("revise records the decision and does not carry the action out", async () => {
    const loopStore = createMemoryGoalLoopStore();
    await loopStore.save("org_local", "channel_1", {
      ...emptyGoalLoop(),
      expectedImpact: "A reply",
      approval: {
        rationale: "Send a CRM message.",
        expectedImpact: "A reply",
        before: "Unsent",
        after: "Sent",
        rollback: "Do not send",
        status: "waiting",
        jobId: "job_1",
        createdAt: "2026-08-25T12:00:00.000Z",
        pending: {
          toolName: "crm_send",
          args: { to_address: "casey@acme.test" },
          botId: "orchestrator",
        },
      },
    });
    const executed: string[] = [];
    const app = mount(loopStore, async ({ toolName }) => {
      executed.push(toolName);
      return "sent";
    });

    const revised = await app.request(
      "http://openbot.test/api/channels/channel_1/loop/decision",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision: "revise" }),
      },
    );
    expect(revised.status).toBe(200);
    expect(executed).toEqual([]);
    const stored = await loopStore.get("org_local", "channel_1");
    expect(stored.lastDecision?.decision).toBe("revise");
    expect(stored.approval?.status).toBe("decided");
    expect(orchestratorContextFromLoop(stored)).toContain(
      "Owner's last decision on this goal: revise",
    );
  });

  test("revert is recorded for the next proposal", async () => {
    const loopStore = createMemoryGoalLoopStore();
    await loopStore.save("org_local", "channel_1", {
      ...emptyGoalLoop(),
      approval: {
        rationale: "Write notes.md",
        expectedImpact: "A record",
        before: "Empty",
        after: "Written",
        rollback: "Do not write",
        status: "waiting",
        jobId: null,
        createdAt: "2026-08-25T12:00:00.000Z",
        pending: {
          toolName: "computer_write_file",
          args: { path: "notes.md" },
          botId: "orchestrator",
        },
      },
    });
    const app = mount(loopStore, async () => "written");
    const reverted = await app.request(
      "http://openbot.test/api/channels/channel_1/loop/decision",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision: "revert" }),
      },
    );
    expect(reverted.status).toBe(200);
    const stored = await loopStore.get("org_local", "channel_1");
    expect(stored.lastDecision?.decision).toBe("revert");
    expect(orchestratorContextFromLoop(stored)).toContain("revert");
  });

  test("POST outcome stores worked / didn't / unknown on the same goal", async () => {
    const loopStore = createMemoryGoalLoopStore();
    const app = mount(loopStore);

    const worked = await app.request(
      "http://openbot.test/api/channels/channel_1/loop/outcome",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ outcome: "worked" }),
      },
    );
    expect(worked.status).toBe(200);
    expect((await loopStore.get("org_local", "channel_1")).outcome).toBe(
      "worked",
    );

    await app.request(
      "http://openbot.test/api/channels/channel_1/loop/outcome",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ outcome: "didn't" }),
      },
    );
    expect((await loopStore.get("org_local", "channel_1")).outcome).toBe(
      "didn't",
    );

    await app.request(
      "http://openbot.test/api/channels/channel_1/loop/outcome",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ outcome: "unknown" }),
      },
    );
    expect((await loopStore.get("org_local", "channel_1")).outcome).toBe(
      "unknown",
    );
  });

  test("GET loop does not include pending tool arguments", async () => {
    const loopStore = createMemoryGoalLoopStore();
    await loopStore.save("org_local", "channel_1", {
      ...emptyGoalLoop(),
      approval: {
        rationale: "Send it",
        expectedImpact: "A reply",
        before: "Unsent",
        after: "Sent",
        rollback: "Do not send",
        status: "waiting",
        jobId: null,
        createdAt: "2026-08-25T12:00:00.000Z",
        pending: {
          toolName: "crm_send",
          args: { body: "secret-draft" },
          botId: "orchestrator",
        },
      },
    });
    const app = mount(loopStore);
    const response = await app.request(
      "http://openbot.test/api/channels/channel_1/loop",
    );
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain("Send it");
    expect(text).not.toContain("secret-draft");
    expect(text).not.toContain("pending");
  });
});
