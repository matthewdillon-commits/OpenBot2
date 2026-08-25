import { describe, expect, test } from "bun:test";
import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import type { AppVariables } from "../src/auth/guards";
import type { ChannelStore } from "../src/channels/routes";
import { createJobRoutes, type publicJob } from "../src/jobs/routes";
import type { JobStore, UnattendedJob } from "../src/jobs/store";

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

function job(overrides: Partial<UnattendedJob> = {}): UnattendedJob {
  const now = new Date("2026-08-25T03:00:00.000Z");
  return {
    id: "job_1",
    orgId: "org_local",
    channelId: "channel_1",
    goalId: "channel_1",
    coworkerId: "researcher",
    actingUserId: "user-1",
    trigger: "manual",
    payload: { prompt: "Research Ada." },
    status: "queued",
    threadId: "thread-1",
    needsYou: false,
    error: null,
    outcome: null,
    startedAt: null,
    finishedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function mount(jobStore: JobStore, channelStore: ChannelStore) {
  const app = new Hono();
  app.route(
    "/api/jobs",
    createJobRoutes({ requireUser, jobStore, channelStore }),
  );
  return app;
}

const recordingStore = () => {
  const enqueued: UnattendedJob[] = [];
  const jobStore: JobStore = {
    enqueue: async (input) => {
      const row = job({
        channelId: input.channelId,
        goalId: input.goalId ?? input.channelId,
        coworkerId: input.coworkerId,
        threadId: input.threadId,
        trigger: input.trigger ?? "manual",
        payload: { prompt: input.prompt },
      });
      enqueued.push(row);
      return row;
    },
    claim: async () => null,
    finish: async () => null,
    get: async (orgId, id) =>
      orgId === "org_local" && id === "job_1"
        ? job({ status: "succeeded" })
        : null,
    listForChannel: async () => [],
    markNeedsYou: async () => [],
    hasUnfinishedOnThread: async () => false,
  };
  return { jobStore, enqueued };
};

const presentChannel: ChannelStore = {
  get: async () => ({
    id: "channel_1",
    name: "Researcher",
    agentIds: ["researcher"],
    threadId: "thread-existing",
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

describe("job routes", () => {
  test("enqueues against the existing channel thread and does not mint one", async () => {
    const { jobStore, enqueued } = recordingStore();
    const app = mount(jobStore, presentChannel);

    const created = await app.request("http://openbot.test/api/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        channelId: "channel_1",
        prompt: "Research Ada.",
      }),
    });
    expect(created.status).toBe(201);
    const body = (await created.json()) as {
      job: ReturnType<typeof publicJob>;
    };
    expect(body.job.threadId).toBe("thread-existing");
    expect(body.job.goalId).toBe("channel_1");
    expect(enqueued[0]?.threadId).toBe("thread-existing");
  });

  test("refuses a goalId that is not the existing channel", async () => {
    const { jobStore } = recordingStore();
    const app = mount(jobStore, presentChannel);
    const refused = await app.request("http://openbot.test/api/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        channelId: "channel_1",
        goalId: "goal_other",
        prompt: "Research Ada.",
      }),
    });
    expect(refused.status).toBe(409);
  });

  test("refuses a channel the acting user cannot see", async () => {
    const { jobStore } = recordingStore();
    const app = mount(jobStore, { ...presentChannel, get: async () => null });
    const refused = await app.request("http://openbot.test/api/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        channelId: "channel_unknown",
        prompt: "Research Ada.",
      }),
    });
    expect(refused.status).toBe(404);
  });

  test("hides another organization's job", async () => {
    const { jobStore } = recordingStore();
    const isolated: JobStore = {
      ...jobStore,
      get: async () => null,
    };
    const app = mount(isolated, presentChannel);
    const hidden = await app.request("http://openbot.test/api/jobs/job_1");
    expect(hidden.status).toBe(404);
  });
});
