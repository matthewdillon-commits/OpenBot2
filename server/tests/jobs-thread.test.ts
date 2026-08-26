import { afterEach, describe, expect, test } from "bun:test";
import type { AbstractAgent } from "@ag-ui/client";
import { BuiltInAgent, CopilotKitIntelligence } from "@copilotkit/runtime/v2";
import {
  firstContactFromRequest,
  openIntelligenceThread,
  openThreadForFirstContact,
} from "../src/jobs/open-thread";
import { startUnattendedRun, UNATTENDED_REFUSALS } from "../src/jobs/run";
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
});
