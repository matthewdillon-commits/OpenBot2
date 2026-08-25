import { afterEach, describe, expect, test } from "bun:test";
import type { AbstractAgent } from "@ag-ui/client";
import { BuiltInAgent, CopilotKitIntelligence } from "@copilotkit/runtime/v2";
import { startUnattendedRun, UNATTENDED_REFUSALS } from "../src/jobs/run";
import { asJobPayload } from "../src/jobs/store";
import {
  createThreadPersister,
  type UnattendedMessage,
} from "../src/jobs/thread";

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

function notFound(threadId: string): never {
  const error = new Error(`not found: ${threadId}`) as Error & {
    status: number;
  };
  error.status = 404;
  throw error;
}

/**
 * Fake Intelligence that records AG-UI messages the way CopilotRuntime.runner.run
 * does on a tab turn: the runner writes the turn onto the existing thread.
 * getThread / getThreadMessages read that store. createThread is refused.
 */
function recordingIntelligence(existingThreadId: string) {
  const threads = new Map<
    string,
    { id: string; messages: UnattendedMessage[] }
  >();
  threads.set(existingThreadId, { id: existingThreadId, messages: [] });
  const minted: string[] = [];

  return {
    minted,
    client: {
      getThread: async ({ threadId }: { threadId: string; userId: string }) => {
        const thread = threads.get(threadId);
        if (!thread) notFound(threadId);
        return { id: thread.id, messages: thread.messages };
      },
      getThreadMessages: async ({
        threadId,
      }: {
        threadId: string;
        userId: string;
      }) => {
        const thread = threads.get(threadId);
        if (!thread) notFound(threadId);
        return { messages: thread.messages };
      },
      createThread: async () => {
        minted.push("createThread");
        throw new Error("must not mint a thread");
      },
      getOrCreateThread: async () => {
        minted.push("getOrCreateThread");
        throw new Error("must not mint a thread");
      },
    },
    record(threadId: string, next: UnattendedMessage[]) {
      const thread = threads.get(threadId);
      if (!thread) return;
      thread.messages = next;
    },
  };
}

function recordingRuntime(
  intelligence: ReturnType<typeof recordingIntelligence>,
) {
  return {
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

function coworkerThatAnswers(text: string) {
  return async ({
    messages: runMessages,
  }: {
    agent: AbstractAgent;
    messages: UnattendedMessage[];
  }) => ({
    text,
    messages: [
      ...runMessages,
      { id: "a1", role: "assistant" as const, content: text },
    ],
  });
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
        userId: "org_local:user-1",
        messages,
        agentId: "researcher",
      }),
    ).resolves.toBe(false);
    expect(calls.every((call) => call.method === "GET")).toBe(true);
    expect(calls.some((call) => call.method === "POST")).toBe(false);
    expect(calls.some((call) => call.method === "PATCH")).toBe(false);
  });

  test("refuses to persist when getThread says the mapped thread is gone", async () => {
    const minted: string[] = [];
    const persister = createThreadPersister({
      intelligence: {
        getThread: async () => notFound("thread-1"),
        createThread: () => {
          minted.push("createThread");
          throw new Error("must not mint a thread");
        },
        getOrCreateThread: () => {
          minted.push("getOrCreateThread");
          throw new Error("must not mint a thread");
        },
      },
    });

    await expect(
      persister.append({
        threadId: "thread-1",
        userId: "org_local:user-1",
        messages,
      }),
    ).resolves.toBe(false);
    expect(minted).toEqual([]);
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
        userId: "org_local:user-1",
        messages,
      }),
    ).resolves.toBe(false);
    expect(guessed).toBe(0);
  });

  test("startUnattendedRun persists prompt and result through CopilotRuntime.runner.run", async () => {
    const intelligence = recordingIntelligence("thread-1");
    const persist = createThreadPersister({
      intelligence: intelligence.client,
    });
    const runtime = recordingRuntime(intelligence);
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
        deps: {
          lookupMapping: async () => ({
            threadId: "thread-1",
            channelId: "channel_1",
            userId: actor.id,
          }),
          waitForThread: async () => "idle",
          runtime,
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
        },
      });

      expect(result.outcome).toBe("succeeded");
      expect(result.persisted).toBe(true);
      expect(result.text).toBe("Ada is at Acme.");
      expect(intelligence.minted).toEqual([]);

      const thread = await intelligence.client.getThread({
        threadId: "thread-1",
        userId: "org_local:user-1",
      });
      const history = await intelligence.client.getThreadMessages({
        threadId: "thread-1",
        userId: "org_local:user-1",
      });
      const blob = JSON.stringify({ thread, history });
      expect(blob).toContain("Find Ada.");
      expect(blob).toContain("Ada is at Acme.");
    } finally {
      BuiltInAgent.prototype.runAgent = originalRunAgent;
    }
  });

  test("startUnattendedRun fails when the runtime run is not on the mapped thread", async () => {
    const intelligence = recordingIntelligence("thread-1");
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
        runCoworker: coworkerThatAnswers("Ada is at Acme."),
      },
    });

    expect(result.outcome).toBe("failed");
    expect(result.persisted).toBe(false);
    expect(result.error).toBe(UNATTENDED_REFUSALS.PERSIST_FAILED);
    expect(intelligence.minted).toEqual([]);
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
