import { describe, expect, test } from "bun:test";
import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import type { AgentProfile } from "../src/agents/profile-types";
import type { AppVariables, AuthenticatedActor } from "../src/auth/guards";
import type { ChannelStore } from "../src/channels/routes";
import {
  createRoomRoutes,
  SEE_THE_WORK_REFUSAL,
} from "../src/jobs/room-routes";
import type { JobStore, UnattendedJob } from "../src/jobs/store";
import { canSeeTheWork } from "../src/orchestrator";

const now = new Date("2026-08-25T16:00:00.000Z");

function actor(
  overrides: Partial<AuthenticatedActor> = {},
): AuthenticatedActor {
  return {
    id: "user-1",
    email: "ada@openbot.test",
    role: "user",
    orgId: "org_local",
    orgRole: "member",
    ...overrides,
  };
}

function requireAs(
  person: AuthenticatedActor,
): MiddlewareHandler<{ Variables: AppVariables }> {
  return async (context, next) => {
    context.set("actor", person);
    await next();
  };
}

function job(overrides: Partial<UnattendedJob> = {}): UnattendedJob {
  return {
    id: "job_1",
    orgId: "org_local",
    channelId: "channel_1",
    goalId: "channel_1",
    coworkerId: "knowledge",
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

const channelStore: ChannelStore = {
  get: async () => ({
    id: "channel_1",
    name: "Research Ada.",
    agentIds: ["general-assistant", "knowledge"],
    threadId: "thread-1",
    active: true,
  }),
  getByThread: async () => null,
  addAgents: async () => {
    throw new Error("unused");
  },
  create: async () => {
    throw new Error("unused");
  },
  list: async () => ({
    channels: [
      {
        id: "channel_1",
        name: "Research Ada.",
        agentIds: ["general-assistant", "knowledge"],
        threadId: "thread-1",
        active: true,
        lastMessage: "Research Ada.",
        lastMessageAt: now,
        lastMessageAgentId: null,
        createdAt: now,
        goalStatus: "Active",
        lastAction: "Research Ada.",
        lastActionAt: now,
      },
    ],
    nextCursor: null,
  }),
  recordActivity: async () => undefined,
};

const jobStore: JobStore = {
  enqueue: async () => job(),
  claim: async () => null,
  finish: async () => null,
  get: async () => null,
  listForChannel: async () => [job()],
  markNeedsYou: async () => [],
  hasUnfinishedOnThread: async () => false,
};

const profiles: AgentProfile[] = [
  {
    id: "general-assistant",
    name: "General Assistant",
    title: "Everyday Work",
    roleDescription: "LimitlessAI",
    avatarSeed: "general-assistant",
    visibility: "public",
    ownerUserId: null,
    systemOwned: true,
    hidden: false,
    deletedAt: null,
    endpoint: null,
    hasAuth: false,
    hasCallbackToken: false,
    standingRole: "orchestrator",
  },
  {
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
  },
];

function mount(person: AuthenticatedActor) {
  const app = new Hono();
  app.route(
    "/api/rooms",
    createRoomRoutes({
      requireUser: requireAs(person),
      channelStore,
      jobStore,
      agentProfileStore: {
        get: async (_actor, id) =>
          profiles.find((profile) => profile.id === id) ?? null,
      } as never,
    }),
  );
  return app;
}

describe("canSeeTheWork", () => {
  test("typical members cannot open the operator door", () => {
    expect(canSeeTheWork({ role: "user", orgRole: "member" })).toBe(false);
    expect(canSeeTheWork({ role: "user" })).toBe(false);
  });

  test("deployment admin, org admin, and org owner can", () => {
    expect(canSeeTheWork({ role: "admin", orgRole: "member" })).toBe(true);
    expect(canSeeTheWork({ role: "user", orgRole: "admin" })).toBe(true);
    expect(canSeeTheWork({ role: "user", orgRole: "owner" })).toBe(true);
  });
});

describe("See the work is role-gated", () => {
  test("a typical owner/member is refused the room list and the goal room", async () => {
    const app = mount(actor());
    const listed = await app.request("http://openbot.test/api/rooms");
    const room = await app.request("http://openbot.test/api/rooms/channel_1");
    expect(listed.status).toBe(403);
    expect(room.status).toBe(403);
    await expect(listed.json()).resolves.toEqual({
      error: SEE_THE_WORK_REFUSAL,
    });
    await expect(room.json()).resolves.toEqual({
      error: SEE_THE_WORK_REFUSAL,
    });
  });

  test("an administrator can list rooms and open this goal’s room", async () => {
    const app = mount(actor({ role: "admin", orgRole: "admin" }));
    const listed = await app.request("http://openbot.test/api/rooms");
    expect(listed.status).toBe(200);
    const body = (await listed.json()) as { rooms: { id: string }[] };
    expect(body.rooms[0]?.id).toBe("channel_1");

    const room = await app.request("http://openbot.test/api/rooms/channel_1");
    expect(room.status).toBe(200);
    const detail = (await room.json()) as {
      room: { members: { standingRole: string | null }[]; jobs: unknown[] };
    };
    expect(detail.room.members).toEqual([
      {
        id: "general-assistant",
        name: "General Assistant",
        standingRole: "orchestrator",
      },
      { id: "knowledge", name: "Knowledge", standingRole: null },
    ]);
    expect(detail.room.jobs).toHaveLength(1);
  });

  test("an org owner can open See the work", async () => {
    const app = mount(actor({ role: "user", orgRole: "owner" }));
    const room = await app.request("http://openbot.test/api/rooms/channel_1");
    expect(room.status).toBe(200);
  });
});
