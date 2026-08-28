import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  AgentNotFoundError,
  createAgentProfileStore,
} from "../src/agents/profile-store";
import type { AgentActor } from "../src/agents/profile-types";
import {
  ChannelNotFoundError,
  createChannelStore,
} from "../src/channels/routes";
import { createThreadIdentity } from "../src/channels/thread-identity";
import { createDatabase } from "../src/db/client";
import {
  agentProfiles,
  agents,
  channels,
  intelligenceChannelMappings,
  users,
} from "../src/db/schema";
import { jobs } from "../src/db/schema/jobs";
import { TEST_POOL } from "./support/database";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgres://openbot:openbot@localhost:5432/openbot";
const database = createDatabase(databaseUrl, TEST_POOL);
const profileStore = createAgentProfileStore(
  database,
  new URL("https://managed.example.test/ag-ui"),
);
const store = createChannelStore(
  database,
  profileStore,
  createThreadIdentity("test-deployment"),
);

const testPrefix = `channel-activity-${randomUUID()}`;
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

async function createUser(): Promise<AgentActor> {
  const id = `${testPrefix}-user-${randomUUID()}`;
  await database.insert(users).values({
    id,
    email: `${id}@example.test`,
    name: "Channel Activity Test User",
  });
  createdUserIds.push(id);
  return { id, role: "user" };
}

async function createAgent(owner: AgentActor, name = "Expense Manager") {
  const profile = await profileStore.create(owner, {
    name,
    title: "Finance Operations",
    roleDescription: "Review receipts.",
    visibility: "private",
  });
  createdAgentIds.push(profile.id);
  return profile.id;
}

async function createChannel(
  owner: AgentActor,
  agentIds: string[],
  name?: string,
) {
  const channel = await store.create(
    owner,
    agentIds,
    name ? { name } : undefined,
  );
  createdChannelIds.push(channel.id);
  return channel;
}

async function insertJob(
  owner: AgentActor,
  channel: { id: string; threadId: string },
  agentId: string,
  input: {
    status: "queued" | "succeeded" | "failed";
    goalStatus: "Active" | "Needs you" | "Done";
    lastAction: string;
    needsYou?: boolean;
  },
) {
  await database.insert(jobs).values({
    id: `job_${testPrefix}-${randomUUID()}`,
    orgId: "org_local",
    channelId: channel.id,
    goalId: channel.id,
    coworkerId: agentId,
    actingUserId: owner.id,
    trigger: "manual",
    payload: { prompt: input.lastAction },
    status: input.status,
    threadId: channel.threadId,
    needsYou: input.needsYou === true,
    outcome: {
      status: input.goalStatus,
      last_action: input.lastAction,
      last_action_at: new Date().toISOString(),
      goalId: channel.id,
      channelId: channel.id,
      agentId,
      orgId: "org_local",
      actingUserId: owner.id,
      summary: input.lastAction,
    },
  });
}

/**
 * The sidebar asked for every channel this person has, on every render.
 *
 * One row per channel-agent pair, and nothing removes a channel: somebody who talks to their Bot
 * daily accumulates thousands, so a query that is instant in a demo returns thousands of rows on
 * every page load, for every employee, and grows for as long as they use the product.
 *
 * The page has to be chosen over channels rather than over rows, which is the whole subtlety here: a
 * limit on rows would cut a two-Bot channel in half and its second Bot would arrive on the next page
 * as a separate entry with the same id.
 */
describe("reading a person's channels", () => {
  test("answers a page rather than everything", async () => {
    const owner = await createUser();
    const agentId = await createAgent(owner);
    for (let index = 0; index < 5; index += 1) {
      await createChannel(owner, [agentId]);
    }

    const page = await store.list(owner, { limit: 2 });

    expect(page.channels).toHaveLength(2);
    expect(page.nextCursor).not.toBeNull();
  });

  test("walking the cursor reaches every channel exactly once", async () => {
    const owner = await createUser();
    const agentId = await createAgent(owner);
    const expected: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      expected.push((await createChannel(owner, [agentId])).id);
    }

    const seen: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 10; page += 1) {
      const result = await store.list(owner, {
        limit: 2,
        ...(cursor ? { cursor } : {}),
      });
      seen.push(...result.channels.map((channel) => channel.id));
      if (!result.nextCursor) break;
      cursor = result.nextCursor;
    }

    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.sort()).toEqual(expected.sort());
  });

  test("a channel with two Bots is never split across pages", async () => {
    /*
     * The reason the page is chosen over channels and the agents joined afterwards. Limiting the row
     * set would put the channel's first Bot on one page and its second on the next, as two entries
     * sharing an id, and the sidebar would render the same conversation twice with half its Bots.
     */
    const owner = await createUser();
    const first = await createAgent(owner, "First");
    const second = await createAgent(owner, "Second");
    const shared = await createChannel(owner, [first, second]);
    await createChannel(owner, [first]);

    const seen: { id: string; agentIds: string[] }[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 5; page += 1) {
      const result = await store.list(owner, {
        limit: 1,
        ...(cursor ? { cursor } : {}),
      });
      // One channel per page, whatever it holds. A row limit would put two here.
      expect(result.channels.length).toBeLessThanOrEqual(1);
      seen.push(...result.channels);
      if (!result.nextCursor) break;
      cursor = result.nextCursor;
    }

    // Which of the two sorts first is incidental; that the shared one arrives once and whole is not.
    const found = seen.filter((channel) => channel.id === shared.id);
    expect(found).toHaveLength(1);
    expect(found[0]?.agentIds.sort()).toEqual([first, second].sort());
  });

  test("a caller cannot ask for every channel in one page", async () => {
    // The limit arrives over HTTP, so the ceiling is what makes paging a property of the endpoint.
    const owner = await createUser();
    const agentId = await createAgent(owner);
    await createChannel(owner, [agentId]);

    const page = await store.list(owner, { limit: 100_000 });

    expect(page.channels.length).toBeLessThanOrEqual(200);
  });

  test("a nonsense cursor reads as the first page", async () => {
    const owner = await createUser();
    const agentId = await createAgent(owner);
    await createChannel(owner, [agentId]);

    const page = await store.list(owner, { cursor: "not-a-cursor" });

    expect(page.channels).toHaveLength(1);
  });

  test("somebody with no channels gets an empty page and no cursor", async () => {
    const owner = await createUser();

    const page = await store.list(owner);

    expect(page.channels).toEqual([]);
    expect(page.nextCursor).toBeNull();
  });
});

/**
 * Search and status have to run on the server. Filtering the page the sidebar already
 * loaded is how an existing goal used to vanish — the first page is 50, and nothing
 * asked for the next one.
 */
describe("searching a person's goals", () => {
  test("finds a goal that is not on the first page", async () => {
    const owner = await createUser();
    const agentId = await createAgent(owner);
    const oldest = await createChannel(
      owner,
      [agentId],
      "UniqueZebra research",
    );
    for (let index = 0; index < 50; index += 1) {
      await createChannel(owner, [agentId], `Filler goal ${index}`);
    }

    const unfiltered = await store.list(owner, { limit: 50 });
    expect(unfiltered.channels.map((channel) => channel.id)).not.toContain(
      oldest.id,
    );
    expect(unfiltered.nextCursor).not.toBeNull();

    const found = await store.list(owner, { search: "  uniquezebra  " });
    expect(found.channels.map((channel) => channel.id)).toEqual([oldest.id]);
  });

  test("matches case, surrounding whitespace, a partial title, and a recent message", async () => {
    const owner = await createUser();
    const agentId = await createAgent(owner);
    const named = await createChannel(
      owner,
      [agentId],
      "Research Ada Lovelace",
    );
    const spoken = await createChannel(owner, [agentId], "Other work");
    await store.recordActivity(owner, spoken.id, {
      agentId,
      at: new Date(),
      text: "Filed the quarterly zebra report.",
    });

    const byTitle = await store.list(owner, { search: "  ADA  " });
    expect(byTitle.channels.map((channel) => channel.id)).toEqual([named.id]);

    const byPartial = await store.list(owner, { search: "Lovelace" });
    expect(byPartial.channels.map((channel) => channel.id)).toEqual([named.id]);

    const byMessage = await store.list(owner, { search: "zebra report" });
    expect(byMessage.channels.map((channel) => channel.id)).toEqual([
      spoken.id,
    ]);

    const cleared = await store.list(owner, { search: "   " });
    expect(cleared.channels.map((channel) => channel.id).sort()).toEqual(
      [named.id, spoken.id].sort(),
    );
  });

  test("finds a last action that is not the last message", async () => {
    const owner = await createUser();
    const agentId = await createAgent(owner);
    const channel = await createChannel(owner, [agentId], "Quiet goal");
    await insertJob(owner, channel, agentId, {
      status: "succeeded",
      goalStatus: "Done",
      lastAction: "Wrote the CRM person.",
    });

    const found = await store.list(owner, { search: "crm person" });
    expect(found.channels.map((row) => row.id)).toEqual([channel.id]);
  });

  test("the same query returns the same eligible goals across All, Active, and Completed", async () => {
    const owner = await createUser();
    const agentId = await createAgent(owner);
    const active = await createChannel(owner, [agentId], "Ada active work");
    const needsYou = await createChannel(owner, [agentId], "Ada needs you");
    const done = await createChannel(owner, [agentId], "Ada completed work");
    await insertJob(owner, needsYou, agentId, {
      status: "failed",
      goalStatus: "Needs you",
      lastAction: "Waiting on a login.",
      needsYou: true,
    });
    await insertJob(owner, done, agentId, {
      status: "succeeded",
      goalStatus: "Done",
      lastAction: "Ada filed.",
    });

    const needle = { search: "Ada" };
    const all = await store.list(owner, { ...needle, status: "all" });
    const unfinished = await store.list(owner, { ...needle, status: "active" });
    const completed = await store.list(owner, {
      ...needle,
      status: "completed",
    });

    expect(all.channels.map((row) => row.id).sort()).toEqual(
      [active.id, needsYou.id, done.id].sort(),
    );
    expect(unfinished.channels.map((row) => row.id).sort()).toEqual(
      [active.id, needsYou.id].sort(),
    );
    expect(completed.channels.map((row) => row.id)).toEqual([done.id]);
  });

  test("a search for a wildcard finds that, not everything", async () => {
    const owner = await createUser();
    const agentId = await createAgent(owner);
    const named = await createChannel(owner, [agentId], "100% coverage");
    await createChannel(owner, [agentId], "Everything else");

    const result = await store.list(owner, { search: "100%" });
    expect(result.channels.map((row) => row.id)).toEqual([named.id]);
  });

  test("paging a search still reaches every match", async () => {
    const owner = await createUser();
    const agentId = await createAgent(owner);
    const expected: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      expected.push(
        (await createChannel(owner, [agentId], `Shared needle ${index}`)).id,
      );
    }
    await createChannel(owner, [agentId], "Unrelated");

    const seen: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 10; page += 1) {
      const result = await store.list(owner, {
        search: "Shared needle",
        limit: 2,
        ...(cursor ? { cursor } : {}),
      });
      seen.push(...result.channels.map((channel) => channel.id));
      if (!result.nextCursor) break;
      cursor = result.nextCursor;
    }

    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.sort()).toEqual(expected.sort());
  });
});

/**
 * The roster reads the last thing said from our own row rather than from the Intelligence platform,
 * so it stays one indexed query however long the conversations get. What is stored is whatever the
 * client that ran the agent reported, which is why each of these guards exists.
 */
describe("channel activity", () => {
  test("records the last message and returns it on the roster", async () => {
    const owner = await createUser();
    const agentId = await createAgent(owner);
    const channel = await createChannel(owner, [agentId]);
    const at = new Date();

    await store.recordActivity(owner, channel.id, {
      agentId,
      at,
      text: "Categorized three expenses.",
    });

    expect((await store.list(owner)).channels).toEqual([
      {
        ...channel,
        lastMessage: "Categorized three expenses.",
        lastMessageAgentId: agentId,
        lastMessageAt: at,
        createdAt: expect.any(Date),
        goalStatus: "Active",
        lastAction: "Categorized three expenses.",
        lastActionAt: at,
      },
    ]);
  });

  test("keeps a person's roster to the channels they belong to", async () => {
    const owner = await createUser();
    const otherUser = await createUser();
    const agentId = await createAgent(owner);
    const channel = await createChannel(owner, [agentId]);

    expect((await store.list(otherUser)).channels).toEqual([]);
    await expect(
      store.recordActivity(otherUser, channel.id, {
        agentId: null,
        at: new Date(),
        text: "Not mine.",
      }),
    ).rejects.toBeInstanceOf(ChannelNotFoundError);
  });

  test("ignores a report older than what is already stored", async () => {
    const owner = await createUser();
    const agentId = await createAgent(owner);
    const channel = await createChannel(owner, [agentId]);
    const newest = new Date();
    const older = new Date(newest.getTime() - 60_000);

    await store.recordActivity(owner, channel.id, {
      agentId,
      at: newest,
      text: "The reply.",
    });
    // A person's message and the agent's reply are two separate reports. A slow one must not
    // overwrite a newer one that already landed.
    await store.recordActivity(owner, channel.id, {
      agentId: null,
      at: older,
      text: "The question.",
    });

    expect((await store.list(owner)).channels[0]?.lastMessage).toBe(
      "The reply.",
    );
  });

  test("stores at most 200 code points, without control characters", async () => {
    const owner = await createUser();
    const agentId = await createAgent(owner);
    const channel = await createChannel(owner, [agentId]);

    await store.recordActivity(owner, channel.id, {
      agentId,
      at: new Date(),
      // A terminal escape and a newline: a preview is rendered as text, not replayed as control.
      text: `line one\nline two \u001b[31m ${"x".repeat(400)}`,
    });

    const stored = (await store.list(owner)).channels[0]?.lastMessage ?? "";
    expect(Array.from(stored).length).toBeLessThanOrEqual(200);
    // biome-ignore lint/suspicious/noControlCharactersInRegex: asserting they were removed.
    expect(stored).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/);
    expect(stored.startsWith("line one line two")).toBe(true);
  });

  test("refuses an agent that is not in the channel", async () => {
    const owner = await createUser();
    const agentId = await createAgent(owner);
    const strangerId = await createAgent(owner, "Stranger");
    const channel = await createChannel(owner, [agentId]);

    await expect(
      store.recordActivity(owner, channel.id, {
        agentId: strangerId,
        at: new Date(),
        text: "Not from this channel.",
      }),
    ).rejects.toBeInstanceOf(AgentNotFoundError);
  });

  test("puts a channel just created above one that has already been used", async () => {
    const owner = await createUser();
    const agentId = await createAgent(owner);
    const used = await createChannel(owner, [agentId]);
    await store.recordActivity(owner, used.id, {
      agentId,
      // A minute back, not `now`. The activity time comes from this process and `created_at` comes
      // from Postgres, so two events written in the same instant are ordered by whichever clock is
      // marginally ahead. The property under test is the ordering rule, not the tie-break.
      at: new Date(Date.now() - 60_000),
      text: "Said something a minute ago.",
    });

    // Starting a conversation is the most recent thing this person did, and it is the one they are
    // about to type in. Sorting it under every channel that has a message would bury it.
    const fresh = await createChannel(owner, [agentId]);

    expect(
      (await store.list(owner)).channels.map((channel) => channel.id),
    ).toEqual([fresh.id, used.id]);
  });

  test("sorts by recency and leaves silent channels below, not absent", async () => {
    const owner = await createUser();
    const agentId = await createAgent(owner);
    const quiet = await createChannel(owner, [agentId]);
    const busy = await createChannel(owner, [agentId]);

    await store.recordActivity(owner, busy.id, {
      agentId,
      at: new Date(),
      text: "Said something.",
    });

    expect(
      (await store.list(owner)).channels.map((channel) => channel.id),
    ).toEqual([busy.id, quiet.id]);
  });
});
