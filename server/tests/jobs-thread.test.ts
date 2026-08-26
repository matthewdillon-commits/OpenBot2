import { afterEach, describe, expect, test } from "bun:test";
import type { AbstractAgent } from "@ag-ui/client";
import { BuiltInAgent, CopilotKitIntelligence } from "@copilotkit/runtime/v2";
import {
  firstContactFromRequest,
  openIntelligenceThread,
  openThreadForFirstContact,
  THREAD_NOT_ON_PLATFORM,
} from "../src/jobs/open-thread";
import { startUnattendedRun, UNATTENDED_REFUSALS } from "../src/jobs/run";
import {
  RUNNER_JOIN_TIMEOUT,
  runUnattendedThroughRuntime,
} from "../src/jobs/runtime-run";
import { asJobPayload } from "../src/jobs/store";
import {
  createThreadPersister,
  type UnattendedMessage,
} from "../src/jobs/thread";
import { intelligenceUserId } from "../src/orgs/constants";

const messages: UnattendedMessage[] = [
  { id: "u1", role: "user", content: "Find Ada." },
  { id: "a1", role: "assistant", content: "Ada is at Acme." },
];

const actor = {
  id: "user-1",
  name: "Ada",
  role: "user" as const,
  orgId: "org_local",
};

const intelligenceUser = intelligenceUserId(actor.orgId, actor.id);

function notFound(threadId: string): never {
  const error = new Error(`not found: ${threadId}`) as Error & {
    status: number;
  };
  error.status = 404;
  throw error;
}

/**
 * Fake Intelligence that records AG-UI messages the way CopilotRuntime.runner.run
 * does on a tab turn. Starts empty: the first getOrCreateThread opens the mapped
 * id. A second open of that id must not mint a second thread.
 */
function recordingIntelligence() {
  const threads = new Map<
    string,
    { id: string; userId: string; messages: UnattendedMessage[] }
  >();
  const opened: Array<{ threadId: string; userId: string; created: boolean }> =
    [];
  const locks: Array<{ threadId: string; userId: string; agentId: string }> =
    [];

  return {
    opened,
    locks,
    client: {
      getThread: async ({
        threadId,
        userId,
      }: {
        threadId: string;
        userId: string;
      }) => {
        const thread = threads.get(threadId);
        if (!thread || thread.userId !== userId) notFound(threadId);
        return { id: thread.id, messages: thread.messages };
      },
      getThreadMessages: async ({
        threadId,
        userId,
      }: {
        threadId: string;
        userId: string;
      }) => {
        const thread = threads.get(threadId);
        if (!thread || thread.userId !== userId) notFound(threadId);
        return { messages: thread.messages };
      },
      getOrCreateThread: async ({
        threadId,
        userId,
      }: {
        threadId: string;
        userId: string;
        agentId?: string;
      }) => {
        const existing = threads.get(threadId);
        if (existing && existing.userId === userId) {
          opened.push({ threadId, userId, created: false });
          return { thread: { id: existing.id }, created: false };
        }
        threads.set(threadId, { id: threadId, userId, messages: [] });
        opened.push({ threadId, userId, created: true });
        return { thread: { id: threadId }, created: true };
      },
      createThread: async () => {
        throw new Error("must not call createThread");
      },
      ɵacquireThreadLock: async ({
        threadId,
        userId,
        agentId,
      }: {
        threadId: string;
        runId: string;
        userId: string;
        agentId: string;
      }) => {
        locks.push({ threadId, userId, agentId });
        return { threadId, runId: `lock_${threadId}` };
      },
      ɵcleanupThreadLock: async () => undefined,
    },
    record(threadId: string, next: UnattendedMessage[]) {
      const thread = threads.get(threadId);
      if (!thread) return;
      thread.messages = next;
    },
    threadIds() {
      return [...threads.keys()];
    },
  };
}

function recordingRuntime(
  intelligence: ReturnType<typeof recordingIntelligence>,
) {
  return {
    intelligence: intelligence.client,
    runner: {
      run({
        threadId,
        agent,
        input,
      }: {
        threadId: string;
        agent: AbstractAgent;
        input: { messages: UnattendedMessage[] };
      }) {
        return {
          subscribe(observer: {
            error?: (error: unknown) => void;
            complete?: () => void;
          }) {
            const writable = agent as AbstractAgent & {
              setMessages?: (next: unknown[]) => void;
              runAgent?: () => Promise<unknown>;
              messages?: UnattendedMessage[];
            };
            Promise.resolve()
              .then(async () => {
                writable.setMessages?.(input.messages);
                await writable.runAgent?.();
                const recorded =
                  Array.isArray(writable.messages) &&
                  writable.messages.length > 0
                    ? writable.messages
                    : input.messages;
                intelligence.record(threadId, recorded);
                observer.complete?.();
              })
              .catch((error) => observer.error?.(error));
          },
        };
      },
    },
  };
}

function coworkerDeps(
  intelligence: ReturnType<typeof recordingIntelligence>,
  extras: Record<string, unknown> = {},
) {
  return {
    lookupMapping: async () => ({
      threadId: "thread-1",
      channelId: "channel_1",
      userId: actor.id,
      intelligenceUserId: intelligenceUser,
    }),
    waitForThread: async () => "missing" as const,
    runtime: recordingRuntime(intelligence),
    persistThread: createThreadPersister({
      intelligence: intelligence.client,
    }).append,
    recordActivity: async () => undefined,
    loadAgents: async () => [
      {
        id: "researcher",
        name: "Researcher",
        type: "built_in" as const,
        systemPrompt: "Research people.",
      },
    ],
    loadTools: () => async () => [],
    resolveModelApiKey: async () => "unused",
    model: { provider: "openai" as const, defaultModel: "gpt-4.1" },
    timeoutMs: 5_000,
    ...extras,
  };
}

describe("unattended thread persist", () => {
  let restoreFetch: (() => void) | undefined;

  afterEach(() => {
    restoreFetch?.();
    restoreFetch = undefined;
  });

  test("CopilotKitIntelligence exposes getThread and getThreadMessages, not a message-write method", () => {
    const names = Object.getOwnPropertyNames(
      CopilotKitIntelligence.prototype,
    ).filter(
      (name) =>
        name !== "constructor" &&
        typeof (CopilotKitIntelligence.prototype as Record<string, unknown>)[
          name
        ] === "function",
    );
    expect(names).toContain("getThread");
    expect(names).toContain("getThreadMessages");
    expect(names).toContain("getOrCreateThread");
    expect(names).toContain("ɵacquireThreadLock");
    expect(names).not.toContain("appendMessages");
    expect(names).not.toContain("addMessages");
    expect(names).not.toContain("createMessages");
  });

  test("createThreadPersister is false when getThread exists but the turn is not on the thread", async () => {
    const calls: { method: string; url: string }[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const url = String(input);
      calls.push({ method: (init?.method ?? "GET").toUpperCase(), url });
      return new Response(JSON.stringify({ thread: { id: "thread-1" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    restoreFetch = () => {
      globalThis.fetch = originalFetch;
    };

    const intelligence = new CopilotKitIntelligence({
      apiUrl: "https://intelligence.test",
      wsUrl: "wss://realtime.intelligence.test",
      apiKey: "test-key",
    });
    const persister = createThreadPersister({ intelligence });
    await expect(
      persister.append({
        threadId: "thread-1",
        userId: intelligenceUser,
        messages,
        agentId: "researcher",
      }),
    ).resolves.toBe(false);
    expect(calls.every((call) => call.method === "GET")).toBe(true);
    expect(calls.some((call) => call.method === "POST")).toBe(false);
    expect(calls.some((call) => call.method === "PATCH")).toBe(false);
  });

  test("does not treat guessed appendMessages or a speculative HTTP POST as persist", async () => {
    let guessed = 0;
    const persister = createThreadPersister({
      intelligence: {
        getThread: async () => ({ id: "thread-1" }),
        appendMessages: async () => {
          guessed += 1;
          return { ok: true };
        },
        addMessages: async () => {
          guessed += 1;
          return { ok: true };
        },
        createMessages: async () => {
          guessed += 1;
          return { ok: true };
        },
      } as never,
    });

    await expect(
      persister.append({
        threadId: "thread-1",
        userId: intelligenceUser,
        messages,
      }),
    ).resolves.toBe(false);
    expect(guessed).toBe(0);
  });

  test("unknown thread is opened via Runtime and the assistant reply is on that thread", async () => {
    const intelligence = recordingIntelligence();
    const originalRunAgent = BuiltInAgent.prototype.runAgent;
    BuiltInAgent.prototype.runAgent = async function () {
      const current =
        (this as { messages?: UnattendedMessage[] }).messages ?? [];
      this.setMessages?.([
        ...current,
        { id: "a1", role: "assistant", content: "Ada is at Acme." },
      ]);
    };

    try {
      const result = await startUnattendedRun({
        actor,
        orgId: actor.orgId,
        channelId: "channel_1",
        threadId: "thread-1",
        prompt: "Find Ada.",
        coworkerId: "researcher",
        deps: coworkerDeps(intelligence),
      });

      expect(result.outcome).toBe("succeeded");
      expect(result.persisted).toBe(true);
      expect(result.text).toBe("Ada is at Acme.");
      expect(intelligence.opened).toEqual([
        { threadId: "thread-1", userId: intelligenceUser, created: true },
      ]);
      expect(intelligence.locks).toEqual([
        {
          threadId: "thread-1",
          userId: intelligenceUser,
          agentId: "researcher",
        },
      ]);
      expect(intelligence.threadIds()).toEqual(["thread-1"]);

      const thread = await intelligence.client.getThread({
        threadId: "thread-1",
        userId: intelligenceUser,
      });
      const history = await intelligence.client.getThreadMessages({
        threadId: "thread-1",
        userId: intelligenceUser,
      });
      const blob = JSON.stringify({ thread, history });
      expect(blob).toContain("Find Ada.");
      expect(blob).toContain("Ada is at Acme.");
    } finally {
      BuiltInAgent.prototype.runAgent = originalRunAgent;
    }
  });

  test("a second job on the same mapping attaches and does not mint a second thread", async () => {
    const intelligence = recordingIntelligence();
    const originalRunAgent = BuiltInAgent.prototype.runAgent;
    BuiltInAgent.prototype.runAgent = async function () {
      const current =
        (this as { messages?: UnattendedMessage[] }).messages ?? [];
      this.setMessages?.([
        ...current,
        { id: "a1", role: "assistant", content: "Ada is at Acme." },
      ]);
    };

    try {
      const first = await startUnattendedRun({
        actor,
        orgId: actor.orgId,
        channelId: "channel_1",
        threadId: "thread-1",
        prompt: "Find Ada.",
        coworkerId: "researcher",
        deps: coworkerDeps(intelligence),
      });
      expect(first.outcome).toBe("succeeded");

      const second = await startUnattendedRun({
        actor,
        orgId: actor.orgId,
        channelId: "channel_1",
        threadId: "thread-1",
        prompt: "Find Ada.",
        coworkerId: "researcher",
        deps: coworkerDeps(intelligence, {
          waitForThread: async () => "idle" as const,
        }),
      });
      expect(second.outcome).toBe("succeeded");
      expect(intelligence.opened).toEqual([
        { threadId: "thread-1", userId: intelligenceUser, created: true },
        { threadId: "thread-1", userId: intelligenceUser, created: false },
      ]);
      expect(intelligence.locks).toEqual([
        {
          threadId: "thread-1",
          userId: intelligenceUser,
          agentId: "researcher",
        },
        {
          threadId: "thread-1",
          userId: intelligenceUser,
          agentId: "researcher",
        },
      ]);
      expect(intelligence.threadIds()).toEqual(["thread-1"]);
    } finally {
      BuiltInAgent.prototype.runAgent = originalRunAgent;
    }
  });

  test("composer first contact and an unattended job share the mapped thread and org:user key", async () => {
    const intelligence = recordingIntelligence();
    const connect = new Request(
      "http://openbot.local/api/copilotkit/agent/researcher/connect?threadId=thread-1",
      { method: "POST" },
    );
    const opened = await openThreadForFirstContact({
      intelligence: intelligence.client,
      request: connect,
      userId: intelligenceUser,
    });
    expect(opened).toEqual({
      threadId: "thread-1",
      userId: intelligenceUser,
      agentId: "researcher",
      created: true,
    });

    const originalRunAgent = BuiltInAgent.prototype.runAgent;
    BuiltInAgent.prototype.runAgent = async function () {
      const current =
        (this as { messages?: UnattendedMessage[] }).messages ?? [];
      this.setMessages?.([
        ...current,
        { id: "a1", role: "assistant", content: "Ada is at Acme." },
      ]);
    };
    try {
      const job = await startUnattendedRun({
        actor,
        orgId: actor.orgId,
        channelId: "channel_1",
        threadId: "thread-1",
        prompt: "Find Ada.",
        coworkerId: "researcher",
        deps: coworkerDeps(intelligence, {
          waitForThread: async () => "idle" as const,
        }),
      });
      expect(job.outcome).toBe("succeeded");
      expect(intelligence.threadIds()).toEqual(["thread-1"]);
      expect(intelligence.opened.map((row) => row.userId)).toEqual([
        intelligenceUser,
        intelligenceUser,
      ]);
    } finally {
      BuiltInAgent.prototype.runAgent = originalRunAgent;
    }
  });

  test("startUnattendedRun fails when the runtime run is not on the mapped thread", async () => {
    const intelligence = recordingIntelligence();
    await intelligence.client.getOrCreateThread({
      threadId: "thread-1",
      userId: intelligenceUser,
    });
    const persist = createThreadPersister({
      intelligence: intelligence.client,
    });
    const result = await startUnattendedRun({
      actor,
      orgId: actor.orgId,
      channelId: "channel_1",
      threadId: "thread-1",
      prompt: "Find Ada.",
      coworkerId: "researcher",
      deps: {
        lookupMapping: async () => ({
          threadId: "thread-1",
          channelId: "channel_1",
          userId: actor.id,
        }),
        waitForThread: async () => "idle",
        persistThread: persist.append,
        recordActivity: async () => undefined,
        loadAgents: async () => [
          {
            id: "researcher",
            name: "Researcher",
            type: "built_in",
            systemPrompt: "Research people.",
          },
        ],
        loadTools: () => async () => [],
        resolveModelApiKey: async () => "unused",
        model: { provider: "openai", defaultModel: "gpt-4.1" },
        timeoutMs: 5_000,
        runCoworker: async ({ messages: runMessages }) => ({
          text: "Ada is at Acme.",
          messages: [
            ...runMessages,
            {
              id: "a1",
              role: "assistant" as const,
              content: "Ada is at Acme.",
            },
          ],
        }),
      },
    });

    expect(result.outcome).toBe("failed");
    expect(result.persisted).toBe(false);
    expect(result.error).toBe(UNATTENDED_REFUSALS.PERSIST_FAILED);
    expect(intelligence.threadIds()).toEqual(["thread-1"]);
  });

  test("job payload drops a messages[] chat store", () => {
    expect(
      asJobPayload({
        prompt: "Find Ada.",
        result: {
          text: "Ada is at Acme.",
          persisted: false,
          messages,
        },
      }),
    ).toEqual({
      prompt: "Find Ada.",
      result: { text: "Ada is at Acme.", persisted: false },
    });
  });
});

describe("first-contact thread open", () => {
  test("reads connect, run, and messages the CopilotKit client actually hits", () => {
    expect(
      firstContactFromRequest(
        new Request(
          "http://openbot.local/api/copilotkit/agent/limitlessai/connect?threadId=thread-1",
          { method: "POST" },
        ),
      ),
    ).toEqual({
      threadId: "thread-1",
      agentId: "limitlessai",
      kind: "connect",
    });
    expect(
      firstContactFromRequest(
        new Request(
          "http://openbot.local/api/copilotkit/agent/limitlessai/run",
          { method: "POST" },
        ),
      ),
    ).toEqual({
      threadId: null,
      agentId: "limitlessai",
      kind: "run",
    });
    expect(
      firstContactFromRequest(
        new Request(
          "http://openbot.local/api/copilotkit/threads/thread-1/messages?agentId=limitlessai",
        ),
      ),
    ).toEqual({
      threadId: "thread-1",
      agentId: "limitlessai",
      kind: "messages",
    });
  });

  test("a lock that remaps to a different thread id is refused", async () => {
    const intelligence = recordingIntelligence();
    const originalRunAgent = BuiltInAgent.prototype.runAgent;
    BuiltInAgent.prototype.runAgent = async function () {
      const current =
        (this as { messages?: UnattendedMessage[] }).messages ?? [];
      this.setMessages?.([
        ...current,
        { id: "a1", role: "assistant", content: "Ada is at Acme." },
      ]);
    };
    const runtime = recordingRuntime(intelligence);
    runtime.intelligence = {
      ...intelligence.client,
      ɵacquireThreadLock: async () => ({
        threadId: "some-other-thread",
        runId: "run-other",
      }),
    };
    try {
      const result = await startUnattendedRun({
        actor,
        orgId: actor.orgId,
        channelId: "channel_1",
        threadId: "thread-1",
        prompt: "Find Ada.",
        coworkerId: "researcher",
        deps: coworkerDeps(intelligence, { runtime }),
      });
      expect(result.outcome).toBe("failed");
      expect(result.error).toMatch(/different thread/);
      expect(intelligence.threadIds()).toEqual(["thread-1"]);
    } finally {
      BuiltInAgent.prototype.runAgent = originalRunAgent;
    }
  });

  test("openIntelligenceThread refuses to adopt a different thread id", async () => {
    await expect(
      openIntelligenceThread(
        {
          getOrCreateThread: async () => ({
            thread: { id: "some-other-thread" },
            created: true,
          }),
        },
        {
          threadId: "thread-1",
          userId: intelligenceUser,
          agentId: "researcher",
        },
      ),
    ).rejects.toThrow(/different thread/);
  });

  test("openIntelligenceThread fails closed when getOrCreate returns an id getThread cannot read", async () => {
    await expect(
      openIntelligenceThread(
        {
          getOrCreateThread: async () => ({
            thread: { id: "thread-1" },
            created: true,
          }),
          getThread: async () => notFound("thread-1"),
        },
        {
          threadId: "thread-1",
          userId: intelligenceUser,
          agentId: "researcher",
        },
      ),
    ).rejects.toThrow(/does not have this thread|not found/);
  });

  test("a wrapper that only returns the mapped id POSTs createThread, then getThread reads it", async () => {
    const threads = new Map<string, { id: string; userId: string }>();
    const posts: Array<{
      threadId: string;
      userId: string;
      agentId: string;
    }> = [];
    await openIntelligenceThread(
      {
        getOrCreateThread: async () => ({
          thread: { id: "thread-1" },
          created: true,
        }),
        getThread: async ({ threadId, userId }) => {
          const thread = threads.get(threadId);
          if (!thread || thread.userId !== userId) notFound(threadId);
          return { id: thread.id };
        },
        createThread: async ({ threadId, userId, agentId }) => {
          posts.push({ threadId, userId, agentId });
          threads.set(threadId, { id: threadId, userId });
          return { id: threadId };
        },
      },
      {
        threadId: "thread-1",
        userId: intelligenceUser,
        agentId: "researcher",
      },
    );
    expect(posts).toEqual([
      {
        threadId: "thread-1",
        userId: intelligenceUser,
        agentId: "researcher",
      },
    ]);
    expect(threads.get("thread-1")?.id).toBe("thread-1");
  });
});

/**
 * Live Intelligence HTTP for CopilotKitIntelligence. getOrCreateThread GETs,
 * then POSTs `/api/threads` on 404. Lock methods POST/PATCH/DELETE `/lock`.
 * Persist reads GET thread + GET messages. No local messages[] store —
 * the map here is the fake platform, the same role Intelligence plays.
 */
function installIntelligenceHttp() {
  const threads = new Map<
    string,
    { id: string; userId: string; messages: UnattendedMessage[] }
  >();
  const calls: { method: string; url: string }[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ method, url });
    let path = url;
    try {
      path = new URL(url).pathname;
    } catch {
      // Tests pass absolute Intelligence URLs.
    }
    let body: Record<string, unknown> = {};
    if (typeof init?.body === "string") {
      try {
        body = JSON.parse(init.body) as Record<string, unknown>;
      } catch {
        body = {};
      }
    }
    const json = (value: unknown, status = 200) =>
      new Response(JSON.stringify(value), {
        status,
        headers: { "content-type": "application/json" },
      });
    const lock = path.match(/\/api\/threads\/([^/]+)\/lock\/?$/);
    if (lock?.[1]) {
      const threadId = decodeURIComponent(lock[1]);
      if (method === "POST") {
        return json({
          threadId,
          runId:
            typeof body.runId === "string" ? body.runId : `lock_${threadId}`,
          joinToken: "join-test",
        });
      }
      return json({});
    }
    const messages = path.match(/\/api\/threads\/([^/]+)\/messages\/?$/);
    if (messages?.[1] && method === "GET") {
      const thread = threads.get(decodeURIComponent(messages[1]));
      if (!thread) return new Response("THREAD_NOT_FOUND", { status: 404 });
      return json({ messages: thread.messages });
    }
    const one = path.match(/\/api\/threads\/([^/]+)\/?$/);
    if (one?.[1] && method === "GET") {
      const thread = threads.get(decodeURIComponent(one[1]));
      if (!thread) return new Response("THREAD_NOT_FOUND", { status: 404 });
      return json({ thread: { id: thread.id } });
    }
    if (path.replace(/\/$/, "") === "/api/threads" && method === "POST") {
      const threadId =
        typeof body.threadId === "string" ? body.threadId.trim() : "";
      const userId = typeof body.userId === "string" ? body.userId : "";
      if (!threadId) return new Response("threadId required", { status: 400 });
      threads.set(threadId, { id: threadId, userId, messages: [] });
      return json({ thread: { id: threadId } });
    }
    return new Response(`unmocked ${method} ${path}`, { status: 500 });
  }) as typeof fetch;
  return {
    calls,
    threads,
    record(threadId: string, next: UnattendedMessage[]) {
      const thread = threads.get(threadId);
      if (!thread) return;
      thread.messages = next;
    },
    restore() {
      globalThis.fetch = originalFetch;
    },
  };
}

describe("unattended CopilotKitIntelligence without an HTTP Request", () => {
  test("an unbound lock method throws on this.#request — that is the live worker error", async () => {
    const intelligence = new CopilotKitIntelligence({
      apiUrl: "https://intelligence.test",
      wsUrl: "wss://realtime.intelligence.test",
      apiKey: "test-key",
    });
    const acquire = intelligence.ɵacquireThreadLock;
    await expect(
      acquire({
        threadId: "thread-1",
        runId: "run-1",
        userId: intelligenceUser,
        agentId: "researcher",
      }),
    ).rejects.toThrow(
      /#request|undefined is not an object|Cannot read private member/,
    );
  });

  test("first job mints a thread getThread can read; second job reuses it; no #request throw", async () => {
    const http = installIntelligenceHttp();
    const intelligence = new CopilotKitIntelligence({
      apiUrl: "https://intelligence.test",
      wsUrl: "wss://realtime.intelligence.test",
      apiKey: "test-key",
    });
    const originalRunAgent = BuiltInAgent.prototype.runAgent;
    BuiltInAgent.prototype.runAgent = async function () {
      const current =
        (this as { messages?: UnattendedMessage[] }).messages ?? [];
      this.setMessages?.([
        ...current,
        { id: "a1", role: "assistant", content: "Ada is at Acme." },
      ]);
    };
    const runtime = {
      intelligence,
      runner: {
        run({
          threadId,
          agent,
          input,
        }: {
          threadId: string;
          agent: AbstractAgent;
          input: { messages: UnattendedMessage[] };
        }) {
          return {
            subscribe(observer: {
              error?: (error: unknown) => void;
              complete?: () => void;
            }) {
              const writable = agent as AbstractAgent & {
                setMessages?: (next: unknown[]) => void;
                runAgent?: () => Promise<unknown>;
                messages?: UnattendedMessage[];
              };
              Promise.resolve()
                .then(async () => {
                  writable.setMessages?.(input.messages);
                  await writable.runAgent?.();
                  const recorded =
                    Array.isArray(writable.messages) &&
                    writable.messages.length > 0
                      ? writable.messages
                      : input.messages;
                  http.record(threadId, recorded);
                  observer.complete?.();
                })
                .catch((error) => observer.error?.(error));
            },
          };
        },
      },
    };

    try {
      const first = await startUnattendedRun({
        actor,
        orgId: actor.orgId,
        channelId: "channel_1",
        threadId: "thread-1",
        prompt: "Find Ada.",
        coworkerId: "researcher",
        deps: {
          lookupMapping: async () => ({
            threadId: "thread-1",
            channelId: "channel_1",
            userId: actor.id,
            intelligenceUserId: intelligenceUser,
          }),
          waitForThread: async () => "missing",
          runtime,
          persistThread: createThreadPersister({ intelligence }).append,
          recordActivity: async () => undefined,
          loadAgents: async () => [
            {
              id: "researcher",
              name: "Researcher",
              type: "built_in" as const,
              systemPrompt: "Research people.",
            },
          ],
          loadTools: () => async () => [],
          resolveModelApiKey: async () => "unused",
          model: { provider: "openai" as const, defaultModel: "gpt-4.1" },
          timeoutMs: 5_000,
        },
      });

      expect(first.outcome).toBe("succeeded");
      expect(first.persisted).toBe(true);
      expect(first.error).toBeUndefined();
      expect(
        http.calls.some((call) =>
          /#request|undefined is not an object/.test(JSON.stringify(call)),
        ),
      ).toBe(false);
      const minted = await intelligence.getThread({
        threadId: "thread-1",
        userId: intelligenceUser,
      });
      expect((minted as { id?: string }).id).toBe("thread-1");
      const history = await intelligence.getThreadMessages({
        threadId: "thread-1",
        userId: intelligenceUser,
      });
      const blob = JSON.stringify({ minted, history });
      expect(blob).toContain("Find Ada.");
      expect(blob).toContain("Ada is at Acme.");
      expect(
        http.calls.some(
          (call) =>
            call.method === "POST" &&
            /\/api\/threads$/.test(
              (() => {
                try {
                  return new URL(call.url).pathname.replace(/\/$/, "");
                } catch {
                  return call.url;
                }
              })(),
            ),
        ),
      ).toBe(true);
      expect(
        http.calls.some(
          (call) => call.method === "POST" && call.url.includes("/lock"),
        ),
      ).toBe(true);

      const second = await startUnattendedRun({
        actor,
        orgId: actor.orgId,
        channelId: "channel_1",
        threadId: "thread-1",
        prompt: "Find Ada.",
        coworkerId: "researcher",
        deps: {
          lookupMapping: async () => ({
            threadId: "thread-1",
            channelId: "channel_1",
            userId: actor.id,
            intelligenceUserId: intelligenceUser,
          }),
          waitForThread: async () => "idle",
          runtime,
          persistThread: createThreadPersister({ intelligence }).append,
          recordActivity: async () => undefined,
          loadAgents: async () => [
            {
              id: "researcher",
              name: "Researcher",
              type: "built_in" as const,
              systemPrompt: "Research people.",
            },
          ],
          loadTools: () => async () => [],
          resolveModelApiKey: async () => "unused",
          model: { provider: "openai" as const, defaultModel: "gpt-4.1" },
          timeoutMs: 5_000,
        },
      });
      expect(second.outcome).toBe("succeeded");
      expect(second.persisted).toBe(true);
      expect([...http.threads.keys()]).toEqual(["thread-1"]);
      expect(
        http.calls.filter((call) => {
          try {
            return (
              call.method === "POST" &&
              new URL(call.url).pathname.replace(/\/$/, "") === "/api/threads"
            );
          } catch {
            return false;
          }
        }),
      ).toHaveLength(1);
    } finally {
      BuiltInAgent.prototype.runAgent = originalRunAgent;
      http.restore();
    }
  });

  test("runUnattendedThroughRuntime does not throw on #request without a Request object", async () => {
    const http = installIntelligenceHttp();
    const intelligence = new CopilotKitIntelligence({
      apiUrl: "https://intelligence.test",
      wsUrl: "wss://realtime.intelligence.test",
      apiKey: "test-key",
    });
    const agent = {
      messages: [] as UnattendedMessage[],
      setMessages(next: UnattendedMessage[]) {
        this.messages = next;
      },
      async runAgent() {
        this.messages = [
          ...this.messages,
          { id: "a1", role: "assistant", content: "hello back" },
        ];
      },
    };
    try {
      const result = await runUnattendedThroughRuntime({
        runtime: {
          intelligence,
          runner: {
            run({
              threadId,
              input,
            }: {
              threadId: string;
              input: { messages: UnattendedMessage[] };
            }) {
              return {
                subscribe(observer: {
                  error?: (error: unknown) => void;
                  complete?: () => void;
                }) {
                  Promise.resolve()
                    .then(async () => {
                      agent.setMessages(input.messages);
                      await agent.runAgent();
                      http.record(threadId, agent.messages);
                      observer.complete?.();
                    })
                    .catch((error) => observer.error?.(error));
                },
              };
            },
          },
        },
        agent: agent as never,
        threadId: "thread-1",
        userId: intelligenceUser,
        agentId: "researcher",
        messages: [{ id: "u1", role: "user", content: "Say hello" }],
      });
      expect(result.text).toBe("hello back");
      await expect(
        intelligence.getThread({
          threadId: "thread-1",
          userId: intelligenceUser,
        }),
      ).resolves.toMatchObject({ id: "thread-1" });
    } finally {
      http.restore();
    }
  });

  test("a mint that still 404s after getOrCreate fails the job in seconds, not minutes", async () => {
    const started = Date.now();
    const result = await startUnattendedRun({
      actor,
      orgId: actor.orgId,
      channelId: "channel_1",
      threadId: "thread-1",
      prompt: "Say hello in one short sentence.",
      coworkerId: "researcher",
      deps: coworkerDeps(recordingIntelligence(), {
        runtime: {
          intelligence: {
            getOrCreateThread: async () => ({
              thread: { id: "thread-1" },
              created: true,
            }),
            getThread: async () => notFound("thread-1"),
            createThread: async () => notFound("thread-1"),
          },
          runner: {
            run() {
              return { subscribe() {} };
            },
            runWithStartupBoundary() {
              return {
                startup: new Promise<void>(() => {}),
                events: { subscribe() {} },
              };
            },
          },
          runnerStartupTimeoutMs: 8_000,
        },
        timeoutMs: 8_000,
      }),
    });
    const elapsed = Date.now() - started;
    expect(result.outcome).toBe("failed");
    expect(result.error).toContain(THREAD_NOT_ON_PLATFORM);
    expect(result.text).toBeUndefined();
    expect(elapsed).toBeLessThan(3_000);
  });

  test("a runner that never joins fails quickly and does not echo the prompt as the reply", async () => {
    const intelligence = recordingIntelligence();
    const started = Date.now();
    const result = await startUnattendedRun({
      actor,
      orgId: actor.orgId,
      channelId: "channel_1",
      threadId: "thread-1",
      prompt: "Say hello in one short sentence.",
      coworkerId: "researcher",
      deps: coworkerDeps(intelligence, {
        runtime: {
          intelligence: intelligence.client,
          runner: {
            run() {
              return { subscribe() {} };
            },
            runWithStartupBoundary() {
              return {
                startup: new Promise<void>(() => {}),
                events: { subscribe() {} },
              };
            },
          },
          runnerStartupTimeoutMs: 80,
        },
        timeoutMs: 5_000,
      }),
    });
    const elapsed = Date.now() - started;
    expect(result.outcome).toBe("failed");
    expect(result.error).toBe(RUNNER_JOIN_TIMEOUT);
    expect(result.text).toBeUndefined();
    expect(
      result.messages.some((message) => message.role === "assistant"),
    ).toBe(false);
    expect(elapsed).toBeLessThan(1_500);
  });

  /**
   * Live after #36: getThread already returned the id, then
   * runWithStartupBoundary.startup never resolved because events were
   * not subscribed. IntelligenceAgentRunner is cold — join starts on
   * subscribe, the same order handleIntelligenceRun uses.
   */
  function lazyJoinRunner(
    intelligence: ReturnType<typeof recordingIntelligence>,
    reply: string,
  ) {
    return {
      run() {
        throw new Error("must use runWithStartupBoundary");
      },
      runWithStartupBoundary({
        threadId,
        agent,
        input,
      }: {
        threadId: string;
        agent: AbstractAgent;
        input: { messages: UnattendedMessage[] };
      }) {
        let resolveStartup: (() => void) | undefined;
        const startup = new Promise<void>((resolve) => {
          resolveStartup = resolve;
        });
        return {
          startup,
          events: {
            subscribe(observer: {
              next?: (value: unknown) => void;
              error?: (error: unknown) => void;
              complete?: () => void;
            }) {
              resolveStartup?.();
              const writable = agent as AbstractAgent & {
                setMessages?: (next: unknown[]) => void;
                messages?: UnattendedMessage[];
              };
              Promise.resolve()
                .then(() => {
                  observer.next?.({ type: "RUN_STARTED" });
                  writable.setMessages?.([
                    ...input.messages,
                    { id: "a1", role: "assistant", content: reply },
                  ]);
                  intelligence.record(
                    threadId,
                    (writable.messages ?? []) as UnattendedMessage[],
                  );
                  observer.next?.({ type: "RUN_FINISHED" });
                  observer.complete?.();
                })
                .catch((error) => observer.error?.(error));
              return { unsubscribe() {} };
            },
          },
        };
      },
    };
  }

  test("a known thread + runner.run emits assistant text, not only the join timeout", async () => {
    const intelligence = recordingIntelligence();
    await intelligence.client.getOrCreateThread({
      threadId: "thread-1",
      userId: intelligenceUser,
      agentId: "researcher",
    });
    const known = await intelligence.client.getThread({
      threadId: "thread-1",
      userId: intelligenceUser,
    });
    expect((known as { id?: string }).id).toBe("thread-1");

    const started = Date.now();
    const result = await startUnattendedRun({
      actor,
      orgId: actor.orgId,
      channelId: "channel_1",
      threadId: "thread-1",
      prompt: "Say hello in one short sentence.",
      coworkerId: "researcher",
      deps: coworkerDeps(intelligence, {
        waitForThread: async () => "idle" as const,
        runtime: {
          intelligence: intelligence.client,
          runner: lazyJoinRunner(intelligence, "Hello from the runner."),
          runnerStartupTimeoutMs: 200,
        },
        timeoutMs: 5_000,
      }),
    });
    const elapsed = Date.now() - started;
    expect(result.outcome).toBe("succeeded");
    expect(result.persisted).toBe(true);
    expect(result.text).toBe("Hello from the runner.");
    expect(result.error).toBeUndefined();
    expect(result.error).not.toBe(RUNNER_JOIN_TIMEOUT);
    expect(elapsed).toBeLessThan(1_500);

    const history = await intelligence.client.getThreadMessages({
      threadId: "thread-1",
      userId: intelligenceUser,
    });
    const blob = JSON.stringify(history);
    expect(blob).toContain("Say hello in one short sentence.");
    expect(blob).toContain("Hello from the runner.");
  });

  test("a second job on a known thread also replies through the same runner join", async () => {
    const intelligence = recordingIntelligence();
    await intelligence.client.getOrCreateThread({
      threadId: "thread-1",
      userId: intelligenceUser,
      agentId: "researcher",
    });
    const first = await startUnattendedRun({
      actor,
      orgId: actor.orgId,
      channelId: "channel_1",
      threadId: "thread-1",
      prompt: "Say hello in one short sentence.",
      coworkerId: "researcher",
      deps: coworkerDeps(intelligence, {
        waitForThread: async () => "idle" as const,
        runtime: {
          intelligence: intelligence.client,
          runner: lazyJoinRunner(intelligence, "Hello from job one."),
          runnerStartupTimeoutMs: 200,
        },
        timeoutMs: 5_000,
      }),
    });
    expect(first.outcome).toBe("succeeded");
    expect(first.text).toBe("Hello from job one.");

    const second = await startUnattendedRun({
      actor,
      orgId: actor.orgId,
      channelId: "channel_1",
      threadId: "thread-1",
      prompt: "Say hello again.",
      coworkerId: "researcher",
      deps: coworkerDeps(intelligence, {
        waitForThread: async () => "idle" as const,
        runtime: {
          intelligence: intelligence.client,
          runner: lazyJoinRunner(intelligence, "Hello from job two."),
          runnerStartupTimeoutMs: 200,
        },
        timeoutMs: 5_000,
      }),
    });
    expect(second.outcome).toBe("succeeded");
    expect(second.persisted).toBe(true);
    expect(second.text).toBe("Hello from job two.");
    expect(second.error).not.toBe(RUNNER_JOIN_TIMEOUT);
    expect(intelligence.threadIds()).toEqual(["thread-1"]);
  });

  test("a CHANNEL_JOIN_ERROR after subscribe fails with the join reason, not the 15s timeout", async () => {
    const intelligence = recordingIntelligence();
    await intelligence.client.getOrCreateThread({
      threadId: "thread-1",
      userId: intelligenceUser,
      agentId: "researcher",
    });
    const started = Date.now();
    const result = await startUnattendedRun({
      actor,
      orgId: actor.orgId,
      channelId: "channel_1",
      threadId: "thread-1",
      prompt: "Say hello in one short sentence.",
      coworkerId: "researcher",
      deps: coworkerDeps(intelligence, {
        waitForThread: async () => "idle" as const,
        runtime: {
          intelligence: intelligence.client,
          runner: {
            run() {
              return { subscribe() {} };
            },
            runWithStartupBoundary() {
              let rejectStartup: ((error: Error) => void) | undefined;
              const startup = new Promise<void>((_, reject) => {
                rejectStartup = reject;
              });
              return {
                startup,
                events: {
                  subscribe(observer: {
                    next?: (value: unknown) => void;
                    complete?: () => void;
                  }) {
                    const error = {
                      type: "RUN_ERROR",
                      code: "CHANNEL_JOIN_ERROR",
                      message: "Failed to join channel: {\"reason\":\"no ws\"}",
                    };
                    queueMicrotask(() => {
                      observer.next?.(error);
                      rejectStartup?.(new Error(error.message));
                      observer.complete?.();
                    });
                    return { unsubscribe() {} };
                  },
                },
              };
            },
          },
          runnerStartupTimeoutMs: 2_000,
        },
        timeoutMs: 5_000,
      }),
    });
    const elapsed = Date.now() - started;
    expect(result.outcome).toBe("failed");
    expect(result.error).toMatch(/join was rejected/);
    expect(result.error).toMatch(/INTELLIGENCE_GATEWAY_WS_URL/);
    expect(result.error).not.toBe(RUNNER_JOIN_TIMEOUT);
    expect(result.text).toBeUndefined();
    expect(elapsed).toBeLessThan(1_500);
  });
});
