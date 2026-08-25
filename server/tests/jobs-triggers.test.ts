import { describe, expect, test } from "bun:test";
import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import type { AppVariables } from "../src/auth/guards";
import type { AgentChannel, ChannelStore } from "../src/channels/routes";
import { ENQUEUE_REFUSALS, enqueueUnattendedJob } from "../src/jobs/enqueue";
import { createInboundRoutes } from "../src/jobs/inbound";
import type { JobStore, UnattendedJob } from "../src/jobs/store";
import {
  CLAIM_DUE_CRON_SQL,
  hashTriggerSecret,
  hmacTriggerBody,
  mintTriggerSecret,
  sameTriggerSecret,
  sameTriggerSignature,
  tickDueCrons,
  TRIGGER_SECRET_PREFIX,
  type JobTrigger,
  type JobTriggerStore,
} from "../src/jobs/triggers";

const now = new Date("2026-08-25T14:00:00.000Z");

function job(overrides: Partial<UnattendedJob> = {}): UnattendedJob {
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

function recordingJobs() {
  const enqueued: UnattendedJob[] = [];
  const unfinished = new Set<string>();
  const jobStore: JobStore = {
    enqueue: async (input) => {
      const row = job({
        id: `job_${enqueued.length + 1}`,
        orgId: input.orgId,
        channelId: input.channelId,
        goalId: input.goalId ?? input.channelId,
        coworkerId: input.coworkerId,
        actingUserId: input.actingUserId,
        threadId: input.threadId,
        trigger: input.trigger ?? "manual",
        payload: { prompt: input.prompt },
      });
      enqueued.push(row);
      unfinished.add(`${input.orgId}:${input.threadId}`);
      return row;
    },
    claim: async () => null,
    finish: async () => null,
    get: async () => null,
    listForChannel: async () => [],
    markNeedsYou: async () => [],
    hasUnfinishedOnThread: async (orgId, threadId) =>
      unfinished.has(`${orgId}:${threadId}`),
  };
  return { jobStore, enqueued, unfinished };
}

const mappedChannel: AgentChannel = {
  id: "channel_1",
  name: "Researcher",
  agentIds: ["researcher"],
  threadId: "thread-existing",
  active: true,
};

const presentChannel: ChannelStore = {
  get: async (actor, channelId) => {
    if (actor.orgId !== "org_local" || channelId !== "channel_1") return null;
    return mappedChannel;
  },
  create: async () => {
    throw new Error("must not mint a channel");
  },
  list: async () => ({ channels: [], nextCursor: null }),
  recordActivity: async () => undefined,
};

const missingThread: ChannelStore = {
  ...presentChannel,
  get: async () => ({ ...mappedChannel, threadId: "" }),
};

function standingTrigger(overrides: Partial<JobTrigger> = {}): JobTrigger {
  const secret = mintTriggerSecret();
  return {
    id: "jtr_1",
    orgId: "org_local",
    kind: "cron",
    channelId: "channel_1",
    goalId: "channel_1",
    threadId: "thread-existing",
    coworkerId: "researcher",
    actingUserId: "user-1",
    prompt: "Morning brief.",
    enabled: true,
    everySeconds: 3600,
    nextRunAt: now,
    secretHash: hashTriggerSecret(secret),
    mailbox: null,
    lastEnqueuedAt: null,
    lastError: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

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

function memoryTriggers(rows: JobTrigger[] = []) {
  const stored = [...rows];
  const secrets = new Map<string, string>();
  const store: JobTriggerStore = {
    create: async (input) => {
      const secret =
        input.kind === "webhook" || input.kind === "email"
          ? mintTriggerSecret()
          : undefined;
      const row = standingTrigger({
        id: `jtr_${stored.length + 1}`,
        orgId: input.orgId,
        kind: input.kind,
        channelId: input.channelId,
        goalId: input.goalId,
        threadId: input.threadId,
        coworkerId: input.coworkerId,
        actingUserId: input.actingUserId,
        prompt: input.prompt,
        everySeconds: input.everySeconds ?? null,
        nextRunAt: input.nextRunAt ?? null,
        mailbox: input.mailbox ?? null,
        secretHash: secret ? hashTriggerSecret(secret) : null,
      });
      stored.push(row);
      if (secret) secrets.set(row.id, secret);
      return { trigger: row, ...(secret ? { secret } : {}) };
    },
    get: async (orgId, id) =>
      stored.find((row) => row.id === id && row.orgId === orgId) ?? null,
    getById: async (id) => stored.find((row) => row.id === id) ?? null,
    getByMailbox: async (mailbox) =>
      stored.find(
        (row) =>
          row.kind === "email" &&
          row.enabled &&
          row.mailbox === mailbox.trim().toLowerCase(),
      ) ?? null,
    list: async (orgId) => stored.filter((row) => row.orgId === orgId),
    remove: async (orgId, id) => {
      const index = stored.findIndex(
        (row) => row.id === id && row.orgId === orgId,
      );
      if (index < 0) return false;
      stored.splice(index, 1);
      return true;
    },
    claimDueCron: async () => {
      const due = stored.find(
        (row) =>
          row.kind === "cron" &&
          row.enabled &&
          row.nextRunAt &&
          row.nextRunAt.getTime() <= Date.now(),
      );
      if (!due) return null;
      due.nextRunAt = new Date(Date.now() + (due.everySeconds ?? 3600) * 1000);
      return due;
    },
    recordFire: async (id, update) => {
      const row = stored.find((item) => item.id === id);
      if (!row) return;
      if (update.enqueued) {
        row.lastEnqueuedAt = new Date();
        row.lastError = null;
      }
      if (update.error) row.lastError = update.error;
    },
  };
  return { store, stored, secrets };
}

describe("standing trigger secrets", () => {
  test("hashes the org-scoped secret and never compares plaintext", () => {
    const secret = mintTriggerSecret();
    expect(secret.startsWith(TRIGGER_SECRET_PREFIX)).toBe(true);
    const hash = hashTriggerSecret(secret);
    expect(sameTriggerSecret(secret, hash)).toBe(true);
    expect(sameTriggerSecret(`${secret}x`, hash)).toBe(false);
  });

  test("accepts an HMAC-SHA256 signed payload with the same secret", () => {
    const secret = mintTriggerSecret();
    const raw = `{"prompt":"Ping."}`;
    const header = `sha256=${hmacTriggerBody(secret, raw)}`;
    expect(sameTriggerSignature(secret, raw, header)).toBe(true);
    expect(sameTriggerSignature(secret, raw, "sha256=deadbeef")).toBe(false);
  });
});

describe("cron claim SQL", () => {
  test("locks due rows with FOR UPDATE SKIP LOCKED", () => {
    expect(CLAIM_DUE_CRON_SQL).toContain("FOR UPDATE SKIP LOCKED");
    expect(CLAIM_DUE_CRON_SQL).toContain("kind = 'cron'");
    expect(CLAIM_DUE_CRON_SQL).toContain("next_run_at <= now()");
  });
});

describe("enqueue-from-cron", () => {
  test("inserts the same jobs row the worker claims", async () => {
    const { jobStore, enqueued } = recordingJobs();
    const result = await enqueueUnattendedJob({
      trigger: "cron",
      orgId: "org_local",
      channelId: "channel_1",
      goalId: "channel_1",
      coworkerId: "researcher",
      actingUserId: "user-1",
      actorRole: "user",
      prompt: "Morning brief.",
      expectedThreadId: "thread-existing",
      lookupChannel: (acting, id) => presentChannel.get(acting, id),
      jobStore,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(enqueued[0]?.trigger).toBe("cron");
    expect(enqueued[0]?.threadId).toBe("thread-existing");
    expect(enqueued[0]?.actingUserId).toBe("user-1");
    expect(enqueued[0]?.payload.prompt).toBe("Morning brief.");
  });

  test("tickDueCrons enqueues from a due standing row, not a second runner", async () => {
    const { jobStore, enqueued } = recordingJobs();
    const due = standingTrigger({
      kind: "cron",
      nextRunAt: new Date(Date.now() - 1000),
      secretHash: null,
    });
    const { store } = memoryTriggers([due]);
    const count = await tickDueCrons({
      triggerStore: store,
      jobStore,
      lookupChannel: (acting, id) => presentChannel.get(acting, id),
    });
    expect(count).toBe(1);
    expect(enqueued[0]?.trigger).toBe("cron");
    expect(enqueued[0]?.threadId).toBe("thread-existing");
  });

  test("skips a due cron when the thread already has a queued job", async () => {
    const { jobStore, enqueued, unfinished } = recordingJobs();
    unfinished.add("org_local:thread-existing");
    const due = standingTrigger({
      kind: "cron",
      nextRunAt: new Date(Date.now() - 1000),
      secretHash: null,
    });
    const { store } = memoryTriggers([due]);
    const count = await tickDueCrons({
      triggerStore: store,
      jobStore,
      lookupChannel: (acting, id) => presentChannel.get(acting, id),
    });
    expect(count).toBe(0);
    expect(enqueued).toHaveLength(0);
  });
});

describe("enqueue-from-webhook", () => {
  test("an authenticated POST enqueues using the stored actor, not a cookie", async () => {
    const secret = mintTriggerSecret();
    const trigger = standingTrigger({
      kind: "webhook",
      prompt: "Standing webhook prompt.",
      secretHash: hashTriggerSecret(secret),
    });
    const { store } = memoryTriggers([trigger]);
    const { jobStore, enqueued } = recordingJobs();
    const app = new Hono();
    app.route(
      "/api",
      createInboundRoutes({
        requireUser,
        jobStore,
        channelStore: presentChannel,
        triggerStore: store,
      }),
    );

    const created = await app.request(
      "http://openbot.test/api/inbound/webhook/jtr_1",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${secret}`,
        },
        body: JSON.stringify({ prompt: "From the CRM." }),
      },
    );
    expect(created.status).toBe(201);
    expect(enqueued[0]?.trigger).toBe("webhook");
    expect(enqueued[0]?.actingUserId).toBe("user-1");
    expect(enqueued[0]?.payload.prompt).toBe("From the CRM.");
    expect(enqueued[0]?.threadId).toBe("thread-existing");
  });

  test("a signed payload with HMAC-SHA256 of the body also authenticates", async () => {
    const secret = mintTriggerSecret();
    const trigger = standingTrigger({
      kind: "webhook",
      prompt: "Standing webhook prompt.",
      secretHash: hashTriggerSecret(secret),
    });
    const { store } = memoryTriggers([trigger]);
    const { jobStore, enqueued } = recordingJobs();
    const app = new Hono();
    app.route(
      "/api",
      createInboundRoutes({
        requireUser,
        jobStore,
        channelStore: presentChannel,
        triggerStore: store,
      }),
    );
    const raw = JSON.stringify({ prompt: "Signed." });
    const signed = await app.request(
      "http://openbot.test/api/inbound/webhook/jtr_1",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${secret}`,
          "x-openbot-signature": `sha256=${hmacTriggerBody(secret, raw)}`,
        },
        body: raw,
      },
    );
    expect(signed.status).toBe(201);
    expect(enqueued[0]?.payload.prompt).toBe("Signed.");
  });

  test("refuses a bad secret and does not enqueue", async () => {
    const trigger = standingTrigger({
      kind: "webhook",
      secretHash: hashTriggerSecret(mintTriggerSecret()),
    });
    const { store } = memoryTriggers([trigger]);
    const { jobStore, enqueued } = recordingJobs();
    const app = new Hono();
    app.route(
      "/api",
      createInboundRoutes({
        requireUser,
        jobStore,
        channelStore: presentChannel,
        triggerStore: store,
      }),
    );
    const refused = await app.request(
      "http://openbot.test/api/inbound/webhook/jtr_1",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer obot_trg_nope",
        },
        body: JSON.stringify({ prompt: "Nope." }),
      },
    );
    expect(refused.status).toBe(401);
    expect(enqueued).toHaveLength(0);
  });
});

describe("enqueue-from-email", () => {
  test("a mapped mailbox enqueues work on that thread", async () => {
    const secret = mintTriggerSecret();
    const trigger = standingTrigger({
      kind: "email",
      mailbox: "work@openbot.test",
      prompt: "Handle this inbound email as work on this thread.",
      secretHash: hashTriggerSecret(secret),
    });
    const { store } = memoryTriggers([trigger]);
    const { jobStore, enqueued } = recordingJobs();
    const app = new Hono();
    app.route(
      "/api",
      createInboundRoutes({
        requireUser,
        jobStore,
        channelStore: presentChannel,
        triggerStore: store,
      }),
    );

    const arrived = await app.request("http://openbot.test/api/inbound/email", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-openbot-trigger-secret": secret,
      },
      body: JSON.stringify({
        to: "Work@openbot.test",
        from: "ada@example.test",
        subject: "Follow up",
        text: "Please research Ada.",
      }),
    });
    expect(arrived.status).toBe(201);
    expect(enqueued[0]?.trigger).toBe("email");
    expect(enqueued[0]?.threadId).toBe("thread-existing");
    expect(enqueued[0]?.payload.prompt).toContain("Please research Ada.");
    expect(enqueued[0]?.payload.prompt).toContain("From: ada@example.test");
  });

  test("an unknown mailbox is a refuse, not a new thread", async () => {
    const { store } = memoryTriggers([]);
    const { jobStore, enqueued } = recordingJobs();
    const app = new Hono();
    app.route(
      "/api",
      createInboundRoutes({
        requireUser,
        jobStore,
        channelStore: presentChannel,
        triggerStore: store,
      }),
    );
    const refused = await app.request("http://openbot.test/api/inbound/email", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${mintTriggerSecret()}`,
      },
      body: JSON.stringify({
        to: "nobody@openbot.test",
        text: "Hello.",
      }),
    });
    expect(refused.status).toBe(404);
    expect(enqueued).toHaveLength(0);
  });
});

describe("org isolation", () => {
  test("one org cannot list or read another org's standing trigger", async () => {
    const theirs = standingTrigger({
      id: "jtr_other",
      orgId: "org_other",
      kind: "webhook",
      secretHash: hashTriggerSecret(mintTriggerSecret()),
    });
    const { store } = memoryTriggers([theirs]);
    expect(await store.get("org_local", "jtr_other")).toBeNull();
    expect(await store.list("org_local")).toHaveLength(0);

    const { jobStore } = recordingJobs();
    const app = new Hono();
    app.route(
      "/api",
      createInboundRoutes({
        requireUser,
        jobStore,
        channelStore: presentChannel,
        triggerStore: store,
      }),
    );
    const listed = await app.request("http://openbot.test/api/job-triggers");
    expect(listed.status).toBe(200);
    const body = (await listed.json()) as { triggers: unknown[] };
    expect(body.triggers).toHaveLength(0);

    const hidden = await app.request(
      "http://openbot.test/api/job-triggers/jtr_other",
    );
    expect(hidden.status).toBe(404);
  });

  test("a foreign secret cannot fire this org's webhook", async () => {
    const ours = mintTriggerSecret();
    const theirs = mintTriggerSecret();
    const trigger = standingTrigger({
      kind: "webhook",
      secretHash: hashTriggerSecret(ours),
    });
    const { store } = memoryTriggers([trigger]);
    const { jobStore, enqueued } = recordingJobs();
    const app = new Hono();
    app.route(
      "/api",
      createInboundRoutes({
        requireUser,
        jobStore,
        channelStore: presentChannel,
        triggerStore: store,
      }),
    );
    const refused = await app.request(
      "http://openbot.test/api/inbound/webhook/jtr_1",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${theirs}`,
        },
        body: JSON.stringify({ prompt: "Steal." }),
      },
    );
    expect(refused.status).toBe(401);
    expect(enqueued).toHaveLength(0);
  });

  test("enqueue refuses a channel the acting org cannot see", async () => {
    const { jobStore, enqueued } = recordingJobs();
    const result = await enqueueUnattendedJob({
      trigger: "webhook",
      orgId: "org_other",
      channelId: "channel_1",
      coworkerId: "researcher",
      actingUserId: "user-other",
      actorRole: "user",
      prompt: "Cross-org.",
      expectedThreadId: "thread-existing",
      lookupChannel: (acting, id) => presentChannel.get(acting, id),
      jobStore,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(404);
    expect(enqueued).toHaveLength(0);
  });
});

describe("refuse-if-no-thread", () => {
  test("cron does not enqueue when the mapping has no Intelligence thread", async () => {
    const { jobStore, enqueued } = recordingJobs();
    const result = await enqueueUnattendedJob({
      trigger: "cron",
      orgId: "org_local",
      channelId: "channel_1",
      coworkerId: "researcher",
      actingUserId: "user-1",
      actorRole: "user",
      prompt: "Morning brief.",
      expectedThreadId: "thread-existing",
      lookupChannel: (acting, id) => missingThread.get(acting, id),
      jobStore,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe(ENQUEUE_REFUSALS.MISSING_THREAD);
    expect(enqueued).toHaveLength(0);
  });

  test("a thread mismatch against the standing config is a refuse", async () => {
    const { jobStore, enqueued } = recordingJobs();
    const result = await enqueueUnattendedJob({
      trigger: "email",
      orgId: "org_local",
      channelId: "channel_1",
      coworkerId: "researcher",
      actingUserId: "user-1",
      actorRole: "user",
      prompt: "Handle this inbound email as work on this thread.",
      expectedThreadId: "thread-stale",
      lookupChannel: (acting, id) => presentChannel.get(acting, id),
      jobStore,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe(ENQUEUE_REFUSALS.THREAD_MISMATCH);
    expect(enqueued).toHaveLength(0);
  });

  test("creating a standing trigger refuses a channel with no thread", async () => {
    const { store } = memoryTriggers([]);
    const { jobStore } = recordingJobs();
    const app = new Hono();
    app.route(
      "/api",
      createInboundRoutes({
        requireUser,
        jobStore,
        channelStore: missingThread,
        triggerStore: store,
      }),
    );
    const created = await app.request("http://openbot.test/api/job-triggers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "cron",
        channelId: "channel_1",
        prompt: "Morning brief.",
        everySeconds: 3600,
      }),
    });
    expect(created.status).toBe(409);
  });
});
