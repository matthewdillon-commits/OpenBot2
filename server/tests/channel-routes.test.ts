import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import {
  AgentNotFoundError,
  createAgentProfileStore,
} from "../src/agents/profile-store";
import type { AgentActor } from "../src/agents/profile-types";
import { createApp } from "../src/app";
import type { AppVariables } from "../src/auth/guards";
import {
  type AgentChannel,
  ChannelNotFoundError,
  type ChannelStore,
  createChannelRoutes,
  createChannelStore,
  parseChannelInput,
} from "../src/channels/routes";
import { createThreadIdentity } from "../src/channels/thread-identity";
import { loadConfig } from "../src/config";
import { createDatabase } from "../src/db/client";
import {
  agentProfiles,
  agents,
  channelAgents,
  channelMemberships,
  channels,
  intelligenceChannelMappings,
  users,
} from "../src/db/schema";
import { TEST_POOL } from "./support/database";
import { testEnvironment } from "./support/environment";

const actor = {
  id: "user-1",
  email: "member@openbot.test",
  role: "user",
} as const;

function channel(overrides: Partial<AgentChannel> = {}): AgentChannel {
  return {
    id: "channel-1",
    name: "Assistant channel",
    agentIds: ["agent-1", "agent-2"],
    threadId: "thread-1",
    active: true,
    expectedImpact: null,
    outcome: null,
    loopStage: null,
    approval: null,
    lastDecision: null,
    ...overrides,
  };
}

type StoreCall = [method: keyof ChannelStore, ...arguments_: unknown[]];

function fakeStore(
  overrides: Partial<ChannelStore> = {},
): ChannelStore & { calls: StoreCall[] } {
  const calls: StoreCall[] = [];
  const base: ChannelStore = {
    async create(receivedActor, agentIds, options) {
      calls.push(
        options
          ? ["create", receivedActor, agentIds, options]
          : ["create", receivedActor, agentIds],
      );
      return channel({
        agentIds,
        ...(options?.name ? { name: options.name } : {}),
      });
    },
    async get(receivedActor, id) {
      calls.push(["get", receivedActor, id]);
      return channel({ id });
    },
    async getByThread(receivedActor, threadId) {
      calls.push(["getByThread", receivedActor, threadId]);
      return channel({ threadId });
    },
    async list(receivedActor, query) {
      calls.push(["list", receivedActor, query]);
      return { channels: [], nextCursor: null };
    },
    async recordActivity(receivedActor, channelId, activity) {
      calls.push(["recordActivity", receivedActor, channelId, activity]);
    },
    async addAgents(receivedActor, channelId, agentIds) {
      calls.push(["addAgents", receivedActor, channelId, agentIds]);
      const existing = channel({ id: channelId });
      return {
        ...existing,
        agentIds: [...new Set([...existing.agentIds, ...agentIds])],
      };
    },
  };

  return Object.assign(base, overrides, { calls });
}

const requireUser: MiddlewareHandler<{ Variables: AppVariables }> = async (
  context,
  next,
) => {
  context.set("actor", actor);
  await next();
};

function appFor(
  store: ChannelStore,
  middleware: MiddlewareHandler<{ Variables: AppVariables }> = requireUser,
) {
  const app = new Hono<{ Variables: AppVariables }>();
  app.route("/", createChannelRoutes(store, middleware));
  return app;
}

async function json(response: Response) {
  return response.json();
}

describe("channel input parser", () => {
  test.each([[null], [[]], ["input"], [42], [true]])(
    "rejects a non-object root: %p",
    (input) => {
      expect(parseChannelInput(input)).toEqual({
        ok: false,
        error: "Channel input must be a JSON object.",
      });
    },
  );

  test.each([
    [undefined, "Agent IDs must be a non-empty array."],
    [null, "Agent IDs must be a non-empty array."],
    ["agent-1", "Agent IDs must be a non-empty array."],
    [{}, "Agent IDs must be a non-empty array."],
    [[], "Agent IDs must be a non-empty array."],
  ])("rejects invalid agentIds: %p", (agentIds, error) => {
    expect(parseChannelInput({ agentIds })).toEqual({ ok: false, error });
  });

  test.each([
    [[""], "Agent IDs must be non-empty strings."],
    [["  "], "Agent IDs must be non-empty strings."],
    [[1], "Agent IDs must be non-empty strings."],
    [[false], "Agent IDs must be non-empty strings."],
    [[null], "Agent IDs must be non-empty strings."],
    [[{}], "Agent IDs must be non-empty strings."],
    [["agent-1", " agent-1 "], "Agent IDs must be unique."],
    [
      Array.from({ length: 9 }, (_, index) => `agent-${index}`),
      "A channel can have at most 8 coworkers.",
    ],
  ])("rejects invalid agent ID members: %p", (agentIds, error) => {
    expect(parseChannelInput({ agentIds })).toEqual({ ok: false, error });
  });

  test("trims and preserves To: order", () => {
    expect(
      parseChannelInput({
        agentIds: [" agent-2 ", "agent-1"],
        id: "forged-channel",
        threadId: "forged-thread",
        active: false,
      }),
    ).toEqual({ ok: true, value: { agentIds: ["agent-2", "agent-1"] } });
  });

  test("accepts an optional goal name and still ignores id, threadId, and active", () => {
    expect(
      parseChannelInput({
        agentIds: ["agent-1"],
        name: "  Research these two people.  ",
        id: "forged-channel",
        threadId: "forged-thread",
        active: false,
      }),
    ).toEqual({
      ok: true,
      value: { agentIds: ["agent-1"], name: "Research these two people." },
    });
  });
});

describe("channel routes", () => {
  test("attaches authentication middleware to every route before calling the store", async () => {
    const store = fakeStore();
    const denied: MiddlewareHandler<{ Variables: AppVariables }> = (context) =>
      Promise.resolve(context.json({ error: "denied" }, 401));
    const app = appFor(store, denied);

    const created = await app.request("http://openbot.test/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agentIds: ["agent-1"] }),
    });
    const fetched = await app.request("http://openbot.test/channel-1");

    expect(created.status).toBe(401);
    expect(fetched.status).toBe(401);
    expect(store.calls).toEqual([]);
  });

  test("uses the authenticated context actor and To: order", async () => {
    const store = fakeStore();
    const app = appFor(store);

    const created = await app.request("http://openbot.test/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agentIds: [" agent-2 ", "agent-1"] }),
    });
    const fetched = await app.request("http://openbot.test/channel-1");

    expect(created.status).toBe(201);
    expect(fetched.status).toBe(200);
    expect(store.calls).toEqual([
      ["create", actor, ["agent-2", "agent-1"]],
      ["get", actor, "channel-1"],
    ]);
  });

  test("passes an optional goal name through to create", async () => {
    const store = fakeStore();
    const app = appFor(store);
    const created = await app.request("http://openbot.test/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agentIds: ["agent-1"],
        name: "Research these two people.",
      }),
    });
    expect(created.status).toBe(201);
    expect(store.calls).toEqual([
      ["create", actor, ["agent-1"], { name: "Research these two people." }],
    ]);
  });

  test("returns only the channel DTO for create and get", async () => {
    const store = fakeStore({
      async create(_actor, agentIds) {
        return Object.assign(channel({ agentIds }), { ownerUserId: "user-1" });
      },
      async get() {
        return Object.assign(channel(), { internalState: "hidden" });
      },
    });
    const app = appFor(store);

    const created = await app.request("http://openbot.test/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agentIds: ["agent-1"] }),
    });
    const fetched = await app.request("http://openbot.test/channel-1");

    expect(created.status).toBe(201);
    expect(await json(created)).toEqual({
      channel: {
        id: "channel-1",
        name: "Assistant channel",
        agentIds: ["agent-1"],
        threadId: "thread-1",
        active: true,
        expectedImpact: null,
        outcome: null,
        loopStage: null,
        approval: null,
        lastDecision: null,
      },
    });
    expect(fetched.status).toBe(200);
    expect(await json(fetched)).toEqual({ channel: channel() });
  });

  test.each([
    ["{", "Channel input must be a JSON object."],
    [JSON.stringify([]), "Channel input must be a JSON object."],
    [JSON.stringify({ agentIds: [] }), "Agent IDs must be a non-empty array."],
  ])(
    "returns safe validation errors for malformed POST bodies",
    async (body, error) => {
      const store = fakeStore();
      const response = await appFor(store).request("http://openbot.test/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      });

      expect(response.status).toBe(400);
      expect(await json(response)).toEqual({ error });
      expect(store.calls).toEqual([]);
    },
  );

  test("returns 404 when get returns null", async () => {
    const store = fakeStore({ get: async () => null });

    const response = await appFor(store).request("http://openbot.test/missing");

    expect(response.status).toBe(404);
    expect(await json(response)).toEqual({ error: "Channel not found." });
  });

  test.each([
    ["create", new AgentNotFoundError("agent-1"), 404, "Agent not found."],
    ["get", new ChannelNotFoundError("channel-1"), 404, "Channel not found."],
  ] as const)(
    "maps known store errors from %s",
    async (method, error, status, message) => {
      const store = fakeStore({
        ...(method === "create"
          ? {
              create: async () => {
                throw error;
              },
            }
          : {
              get: async () => {
                throw error;
              },
            }),
      });
      const app = appFor(store);
      const response =
        method === "create"
          ? await app.request("http://openbot.test/", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ agentIds: ["agent-1"] }),
            })
          : await app.request("http://openbot.test/channel-1");

      expect(response.status).toBe(status);
      expect(await json(response)).toEqual({ error: message });
    },
  );

  test("rethrows unexpected errors to the outer Hono error handler", async () => {
    const store = fakeStore({
      create: async () => {
        throw new Error("database disconnected");
      },
    });
    const app = appFor(store);
    app.onError((error, context) =>
      context.json({ sentinel: error.message }, 599),
    );

    const response = await app.request("http://openbot.test/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agentIds: ["agent-1"] }),
    });

    expect(response.status).toBe(599);
    expect(await json(response)).toEqual({ sentinel: "database disconnected" });
  });

  test("forwards search and status so the roster is not filtered in the browser", async () => {
    const store = fakeStore();
    const response = await appFor(store).request(
      "http://openbot.test/?search=%20Ada%20&status=completed&limit=10",
    );

    expect(response.status).toBe(200);
    expect(store.calls).toEqual([
      ["list", actor, { limit: 10, search: " Ada ", status: "completed" }],
    ]);
  });
});

describe("channel route composition", () => {
  test("mounts the store behind createApp authentication with the derived actor", async () => {
    const store = fakeStore();
    let session: {
      user: { id: string; email: string; name: string; image: string };
    } | null = null;
    const app = createApp(
      loadConfig(testEnvironment()),
      {
        handler: () => new Response(null, { status: 204 }),
        api: { getSession: async () => session },
      },
      { rolesForUser: async () => ["user"] },
      // Positions 4-11, ending at agentProfileStore. The computer gateway and policy store come
      // before these placeholders.
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      store,
    );

    const unauthenticated = await app.request(
      "http://openbot.test/api/channels/channel-1",
    );
    expect(unauthenticated.status).toBe(401);
    expect(store.calls).toEqual([]);

    session = {
      user: {
        id: actor.id,
        email: actor.email,
        name: "OpenBot Member",
        image: "https://example.test/member.png",
      },
    };
    const authenticated = await app.request(
      "http://openbot.test/api/channels/channel-1",
    );

    expect(authenticated.status).toBe(200);
    expect(store.calls).toEqual([
      [
        "get",
        {
          ...actor,
          name: "OpenBot Member",
          image: "https://example.test/member.png",
          platformSuperadmin: false,
          deploymentAdmin: false,
        },
        "channel-1",
      ],
    ]);
  });

  test("leaves channel routes unmounted when createApp has no store", async () => {
    const app = createApp(loadConfig(testEnvironment()));

    const response = await app.request(
      "http://openbot.test/api/channels/channel-1",
    );

    expect(response.status).toBe(404);
  });
});

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgres://openbot:openbot@localhost:5432/openbot";
const database = createDatabase(databaseUrl, TEST_POOL);
const profileStore = createAgentProfileStore(
  database,
  new URL("https://managed.example.test/ag-ui"),
);
const persistentStore = createChannelStore(
  database,
  profileStore,
  createThreadIdentity("test-deployment"),
);
const testPrefix = `channel-store-${randomUUID()}`;
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

function persistentId(kind: string) {
  return `${testPrefix}-${kind}-${randomUUID()}`;
}

async function createPersistentUser(): Promise<AgentActor> {
  const userId = persistentId("user");
  await database.insert(users).values({
    id: userId,
    email: `${userId}@example.test`,
    name: "Channel Store Test User",
  });
  createdUserIds.push(userId);
  return { id: userId, role: "user" };
}

async function createPersistentAgent(options: {
  id?: string;
  name: string;
  owner: AgentActor;
  visibility?: "public" | "private";
}) {
  const agentId = options.id ?? persistentId("agent");
  await database.insert(agents).values({
    id: agentId,
    name: options.name,
    type: "remote_ag_ui",
    configuration: { endpoint: "https://agent.example.test/ag-ui" },
  });
  createdAgentIds.push(agentId);
  await database.insert(agentProfiles).values({
    agentId,
    ownerUserId: options.owner.id,
    title: `${options.name} title`,
    roleDescription: `${options.name} role description`,
    avatarSeed: agentId,
    visibility: options.visibility ?? "private",
  });
  return agentId;
}

async function persistedChannel(channelId: string) {
  const [channelRow] = await database
    .select()
    .from(channels)
    .where(eq(channels.id, channelId));
  const memberships = await database
    .select()
    .from(channelMemberships)
    .where(eq(channelMemberships.channelId, channelId));
  const linkedAgents = await database
    .select()
    .from(channelAgents)
    .where(eq(channelAgents.channelId, channelId));
  const mappings = await database
    .select()
    .from(intelligenceChannelMappings)
    .where(eq(intelligenceChannelMappings.channelId, channelId));
  return { channelRow, memberships, linkedAgents, mappings };
}

async function channelTableSnapshot() {
  return {
    channels: (await database.select({ id: channels.id }).from(channels))
      .map(({ id }) => id)
      .sort(),
    memberships: (
      await database
        .select({
          channelId: channelMemberships.channelId,
          userId: channelMemberships.userId,
        })
        .from(channelMemberships)
    )
      .map(({ channelId, userId }) => `${channelId}:${userId}`)
      .sort(),
    agents: (
      await database
        .select({
          agentId: channelAgents.agentId,
          channelId: channelAgents.channelId,
        })
        .from(channelAgents)
    )
      .map(({ agentId, channelId }) => `${channelId}:${agentId}`)
      .sort(),
    mappings: (
      await database
        .select({
          channelId: intelligenceChannelMappings.channelId,
          threadId: intelligenceChannelMappings.threadId,
          userId: intelligenceChannelMappings.userId,
        })
        .from(intelligenceChannelMappings)
    )
      .map(
        ({ channelId, threadId, userId }) =>
          `${channelId}:${threadId}:${userId}`,
      )
      .sort(),
  };
}

describe("channel store integration", () => {
  test("reads the creator's persisted channel exactly", async () => {
    const actor = await createPersistentUser();
    const agentId = await createPersistentAgent({
      name: "Historical agent",
      owner: actor,
    });
    const created = await persistentStore.create(actor, [agentId]);
    createdChannelIds.push(created.id);

    expect(await persistentStore.get(actor, created.id)).toEqual(created);
  });

  test("does not expose a member's channel to another user through public agents", async () => {
    const creator = await createPersistentUser();
    const otherUser = await createPersistentUser();
    const agentId = await createPersistentAgent({
      name: "Public historical agent",
      owner: creator,
      visibility: "public",
    });
    const created = await persistentStore.create(creator, [agentId]);
    createdChannelIds.push(created.id);
    const otherUserMiddleware: MiddlewareHandler<{
      Variables: AppVariables;
    }> = async (context, next) => {
      context.set("actor", otherUser);
      await next();
    };

    expect(await persistentStore.get(otherUser, created.id)).toBeNull();
    const response = await appFor(persistentStore, otherUserMiddleware).request(
      `http://openbot.test/${created.id}`,
    );
    expect(response.status).toBe(404);
    expect(await json(response)).toEqual({ error: "Channel not found." });
  });

  test("reads linked agent IDs in To: order", async () => {
    const actor = await createPersistentUser();
    const agentIdBase = persistentId("ordered-agent");
    const laterAgentId = await createPersistentAgent({
      id: `${agentIdBase}-zulu`,
      name: "Zulu",
      owner: actor,
    });
    const earlierAgentId = await createPersistentAgent({
      id: `${agentIdBase}-alpha`,
      name: "Alpha",
      owner: actor,
    });
    const created = await persistentStore.create(actor, [
      laterAgentId,
      earlierAgentId,
    ]);
    createdChannelIds.push(created.id);

    expect((await persistentStore.get(actor, created.id))?.agentIds).toEqual([
      laterAgentId,
      earlierAgentId,
    ]);
    const listed = await persistentStore.list(actor);
    expect(
      listed.channels.find((entry) => entry.id === created.id)?.agentIds,
    ).toEqual([laterAgentId, earlierAgentId]);
  });

  test("keeps a historical channel readable but inactive after a linked profile is deleted", async () => {
    const actor = await createPersistentUser();
    const activeAgentId = await createPersistentAgent({
      name: "Active historical agent",
      owner: actor,
    });
    const deletedAgentId = await createPersistentAgent({
      name: "Deleted historical agent",
      owner: actor,
    });
    const created = await persistentStore.create(
      actor,
      [activeAgentId, deletedAgentId].sort(),
    );
    createdChannelIds.push(created.id);
    await profileStore.softDelete(actor, deletedAgentId);

    expect(await persistentStore.get(actor, created.id)).toEqual({
      ...created,
      active: false,
    });
  });

  test("returns null when the member's channel mapping is missing", async () => {
    const actor = await createPersistentUser();
    const agentId = await createPersistentAgent({
      name: "Unmapped historical agent",
      owner: actor,
    });
    const created = await persistentStore.create(actor, [agentId]);
    createdChannelIds.push(created.id);
    await database
      .delete(intelligenceChannelMappings)
      .where(eq(intelligenceChannelMappings.channelId, created.id));

    expect(await persistentStore.get(actor, created.id)).toBeNull();
  });

  test("creates independent persisted channels for repeated agent selections", async () => {
    const actor = await createPersistentUser();
    const agentId = await createPersistentAgent({
      name: "Solo Agent",
      owner: actor,
    });

    const first = await persistentStore.create(actor, [agentId]);
    createdChannelIds.push(first.id);
    const second = await persistentStore.create(actor, [agentId]);
    createdChannelIds.push(second.id);

    expect(first).toMatchObject({
      name: "Solo Agent",
      agentIds: [agentId],
      active: true,
    });
    expect(second).toMatchObject({
      name: "Solo Agent",
      agentIds: [agentId],
      active: true,
    });
    expect(first.id).toMatch(/^channel_[0-9a-f-]{36}$/);
    expect(second.id).toMatch(/^channel_[0-9a-f-]{36}$/);
    expect(first.id).not.toBe(second.id);
    expect(first.threadId).toMatch(/^[0-9a-f-]{36}$/);
    expect(second.threadId).toMatch(/^[0-9a-f-]{36}$/);
    expect(first.threadId).not.toBe(second.threadId);

    for (const created of [first, second]) {
      const persisted = await persistedChannel(created.id);
      expect(persisted.channelRow).toMatchObject({
        id: created.id,
        name: "Solo Agent",
        description: "Private agent channel.",
        suggestedPrompts: [],
        allowedGroups: [],
        packageId: null,
        override: null,
      });
      expect(persisted.memberships).toHaveLength(1);
      expect(persisted.memberships[0]).toMatchObject({
        channelId: created.id,
        userId: actor.id,
      });
      expect(persisted.linkedAgents).toHaveLength(1);
      expect(persisted.linkedAgents[0]).toMatchObject({
        channelId: created.id,
        agentId,
      });
      expect(persisted.mappings).toHaveLength(1);
      expect(persisted.mappings[0]).toMatchObject({
        userId: actor.id,
        channelId: created.id,
        threadId: created.threadId,
      });
    }
  });

  test("persists every agent and derives its name in To: order", async () => {
    const actor = await createPersistentUser();
    const firstId = await createPersistentAgent({
      id: persistentId("agent-a"),
      name: "Zulu",
      owner: actor,
    });
    const secondId = await createPersistentAgent({
      id: persistentId("agent-b"),
      name: "Alpha",
      owner: actor,
    });
    const agentIds = [firstId, secondId];

    const created = await persistentStore.create(actor, agentIds);
    createdChannelIds.push(created.id);

    expect(created).toEqual({
      id: created.id,
      name: "Zulu, Alpha",
      agentIds,
      threadId: created.threadId,
      active: true,
      expectedImpact: null,
      outcome: null,
      loopStage: null,
      approval: null,
      lastDecision: null,
    });
    const persisted = await persistedChannel(created.id);
    expect(persisted.channelRow?.name).toBe("Zulu, Alpha");
    expect(
      persisted.linkedAgents
        .slice()
        .sort((left, right) => left.position - right.position)
        .map(({ agentId }) => agentId),
    ).toEqual(agentIds);
  });

  test("uses the requested goal name instead of coworker names", async () => {
    const actor = await createPersistentUser();
    const agentId = await createPersistentAgent({
      name: "General Assistant",
      owner: actor,
    });
    const created = await persistentStore.create(actor, [agentId], {
      name: "Research these two people.",
    });
    createdChannelIds.push(created.id);
    expect(created.name).toBe("Research these two people.");
    expect((await persistentStore.get(actor, created.id))?.name).toBe(
      "Research these two people.",
    );
  });

  test("looks a goal up by its Intelligence thread", async () => {
    const actor = await createPersistentUser();
    const agentId = await createPersistentAgent({
      name: "LimitlessAI",
      owner: actor,
    });
    const created = await persistentStore.create(actor, [agentId]);
    createdChannelIds.push(created.id);
    const found = await persistentStore.getByThread(actor, created.threadId);
    expect(found?.id).toBe(created.id);
    expect(found?.threadId).toBe(created.threadId);
    expect(await persistentStore.getByThread(actor, "")).toBeNull();
    expect(
      await persistentStore.getByThread(actor, "missing-thread"),
    ).toBeNull();
  });

  test("adds specialists after the lead and refuses a ninth coworker", async () => {
    const actor = await createPersistentUser();
    const leadId = await createPersistentAgent({
      name: "LimitlessAI",
      owner: actor,
    });
    const specialistId = await createPersistentAgent({
      name: "Knowledge",
      owner: actor,
    });
    const extras: string[] = [];
    for (let index = 0; index < 6; index += 1) {
      extras.push(
        await createPersistentAgent({
          name: `Specialist ${index}`,
          owner: actor,
        }),
      );
    }
    const created = await persistentStore.create(actor, [leadId]);
    createdChannelIds.push(created.id);
    const withSpecialist = await persistentStore.addAgents(actor, created.id, [
      specialistId,
    ]);
    expect(withSpecialist.agentIds[0]).toBe(leadId);
    expect(withSpecialist.agentIds).toContain(specialistId);
    await persistentStore.addAgents(actor, created.id, extras);
    const ninth = await createPersistentAgent({
      name: "Ninth",
      owner: actor,
    });
    await expect(
      persistentStore.addAgents(actor, created.id, [ninth]),
    ).rejects.toMatchObject({ name: "RoomFullError" });
  });

  test("truncates derived names to 120 Unicode code points with an ellipsis", async () => {
    const actor = await createPersistentUser();
    const longName = "😀".repeat(121);
    const agentId = await createPersistentAgent({
      name: longName,
      owner: actor,
    });

    const created = await persistentStore.create(actor, [agentId]);
    createdChannelIds.push(created.id);

    expect(Array.from(created.name)).toHaveLength(120);
    expect(created.name).toBe(`${"😀".repeat(119)}…`);
    expect((await persistedChannel(created.id)).channelRow?.name).toBe(
      created.name,
    );
  });

  test.each(["inaccessible private", "soft-deleted"] as const)(
    "rejects an %s agent and leaves every channel table unchanged",
    async (scenario) => {
      const actor = await createPersistentUser();
      const owner =
        scenario === "inaccessible private"
          ? await createPersistentUser()
          : actor;
      const accessibleAgentId = await createPersistentAgent({
        name: "Accessible agent",
        owner: actor,
      });
      const agentId = await createPersistentAgent({
        name: `${scenario} agent`,
        owner,
      });
      if (scenario === "soft-deleted") {
        await profileStore.softDelete(actor, agentId);
      }
      const before = await channelTableSnapshot();

      await expect(
        persistentStore.create(actor, [accessibleAgentId, agentId].sort()),
      ).rejects.toBeInstanceOf(AgentNotFoundError);

      expect(await channelTableSnapshot()).toEqual(before);
    },
  );
});

/**
 * Channel creation validates each selected agent through the profile store while its own
 * transaction is open. If that read runs on a second pooled connection it is both a deadlock (the
 * transaction holds a connection while waiting for one) and a time-of-check race (the read sees a
 * different snapshot and takes no lock, so a concurrent deletion lands between check and insert).
 */
describe("channel store concurrency", () => {
  test("creates a channel without borrowing a second connection", async () => {
    const singleConnection = createDatabase(databaseUrl, { max: 1 });
    const store = createChannelStore(
      singleConnection,
      createAgentProfileStore(
        singleConnection,
        new URL("https://managed.example.test/ag-ui"),
      ),
      createThreadIdentity("test-deployment"),
    );
    const owner = await createPersistentUser();
    const agentId = await createPersistentAgent({
      name: "Single connection agent",
      owner,
    });

    try {
      const created = await store.create(owner, [agentId]);
      createdChannelIds.push(created.id);

      expect(created.agentIds).toEqual([agentId]);
    } finally {
      await singleConnection.$client.close();
    }
  });

  test("refuses an agent whose deletion commits mid-creation", async () => {
    const owner = await createPersistentUser();
    const agentId = await createPersistentAgent({
      name: "Concurrently deleted agent",
      owner,
    });

    let markDeleted: () => void = () => {};
    let releaseDeletion: () => void = () => {};
    const deletionApplied = new Promise<void>((resolve) => {
      markDeleted = resolve;
    });
    const deletionHeld = new Promise<void>((resolve) => {
      releaseDeletion = resolve;
    });
    const deletion = database.transaction(async (transaction) => {
      await transaction
        .update(agentProfiles)
        .set({ deletedAt: new Date() })
        .where(eq(agentProfiles.agentId, agentId));
      markDeleted();
      await deletionHeld;
    });

    await deletionApplied;
    const creation = persistentStore.create(owner, [agentId]);
    // Long enough for a correct implementation to reach the row lock and block on it.
    await Bun.sleep(250);
    releaseDeletion();
    await deletion;

    const outcome = await creation.then(
      (created) => {
        createdChannelIds.push(created.id);
        return created;
      },
      (error: unknown) => error,
    );

    expect(outcome).toBeInstanceOf(AgentNotFoundError);
    expect(
      await database
        .select({ channelId: channelAgents.channelId })
        .from(channelAgents)
        .where(eq(channelAgents.agentId, agentId)),
    ).toEqual([]);
  });
});
