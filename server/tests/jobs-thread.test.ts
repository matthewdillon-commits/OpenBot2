import { afterEach, describe, expect, test } from "bun:test";
import { CopilotKitIntelligence } from "@copilotkit/runtime/v2";
import { startUnattendedRun, UNATTENDED_REFUSALS } from "../src/jobs/run";
import { asJobPayload } from "../src/jobs/store";
import { createThreadPersister } from "../src/jobs/thread";

const messages = [
  { id: "u1", role: "user" as const, content: "Find Ada." },
  { id: "a1", role: "assistant" as const, content: "Ada is at Acme." },
];

const actor = {
  id: "user-1",
  name: "Ada",
  role: "user" as const,
  orgId: "org_local",
};

function intelligencePrototypeNames(): string[] {
  return Object.getOwnPropertyNames(CopilotKitIntelligence.prototype).filter(
    (name) =>
      name !== "constructor" &&
      typeof (CopilotKitIntelligence.prototype as Record<string, unknown>)[
        name
      ] === "function",
  );
}

describe("unattended thread persist", () => {
  let restoreFetch: (() => void) | undefined;

  afterEach(() => {
    restoreFetch?.();
    restoreFetch = undefined;
  });

  test("CopilotKitIntelligence exposes getThread and no message-write method", () => {
    const names = intelligencePrototypeNames();
    expect(names).toContain("getThread");
    expect(names).toContain("getThreadMessages");
    expect(names).not.toContain("appendMessages");
    expect(names).not.toContain("addMessages");
    expect(names).not.toContain("createMessages");
  });

  test("createThreadPersister uses CopilotKitIntelligence.getThread and fails closed without a message-write API", async () => {
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
    const minted: string[] = [];
    const createThread = intelligence.createThread.bind(intelligence);
    const getOrCreateThread = intelligence.getOrCreateThread.bind(intelligence);
    intelligence.createThread = (async (...args: never[]) => {
      minted.push("createThread");
      return createThread(...args);
    }) as typeof intelligence.createThread;
    intelligence.getOrCreateThread = (async (...args: never[]) => {
      minted.push("getOrCreateThread");
      return getOrCreateThread(...args);
    }) as typeof intelligence.getOrCreateThread;

    const persister = createThreadPersister({ intelligence });
    await expect(
      persister.append({
        threadId: "thread-1",
        userId: "org_local:user-1",
        messages,
        agentId: "researcher",
      }),
    ).resolves.toBe(false);

    expect(minted).toEqual([]);
    expect(calls).toEqual([
      {
        method: "GET",
        url: "https://intelligence.test/api/threads/thread-1?userId=org_local%3Auser-1",
      },
    ]);
    expect(calls.some((call) => call.url.includes("/messages"))).toBe(false);
    expect(calls.some((call) => call.method === "POST")).toBe(false);
    expect(calls.some((call) => call.method === "PATCH")).toBe(false);
  });

  test("refuses to persist when getThread says the mapped thread is gone", async () => {
    const minted: string[] = [];
    const persister = createThreadPersister({
      intelligence: {
        getThread: async () => {
          const error = new Error("not found") as Error & { status: number };
          error.status = 404;
          throw error;
        },
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

  test("startUnattendedRun fails when persist uses CopilotKitIntelligence.getThread only", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ thread: { id: "thread-1" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as typeof fetch;
    restoreFetch = () => {
      globalThis.fetch = originalFetch;
    };

    const intelligence = new CopilotKitIntelligence({
      apiUrl: "https://intelligence.test",
      wsUrl: "wss://realtime.intelligence.test",
      apiKey: "test-key",
    });
    const persist = createThreadPersister({ intelligence });
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
            { id: "a1", role: "assistant", content: "Ada is at Acme." },
          ],
        }),
      },
    });

    expect(result.outcome).toBe("failed");
    expect(result.persisted).toBe(false);
    expect(result.error).toBe(UNATTENDED_REFUSALS.PERSIST_FAILED);
    expect(result.text).toBe("Ada is at Acme.");
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
