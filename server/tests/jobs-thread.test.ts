import { describe, expect, test } from "bun:test";
import { createThreadPersister } from "../src/jobs/thread";

describe("unattended thread persist", () => {
  const messages = [
    { id: "u1", role: "user" as const, content: "Find Ada." },
    { id: "a1", role: "assistant" as const, content: "Ada is at Acme." },
  ];

  test("refuses to persist when getThread says the mapped thread is gone", async () => {
    const persister = createThreadPersister({
      intelligence: {
        getThread: async () => {
          const error = new Error("not found") as Error & { status: number };
          error.status = 404;
          throw error;
        },
        createThread: async () => {
          throw new Error("must not mint a thread");
        },
        getOrCreateThread: async () => {
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
  });

  test("appends onto the existing thread through the Intelligence write path", async () => {
    const calls: unknown[] = [];
    const persister = createThreadPersister({
      intelligence: {
        getThread: async () => ({ id: "thread-1" }),
        appendMessages: async (input: unknown) => {
          calls.push(input);
          return { ok: true };
        },
        createThread: async () => {
          throw new Error("must not mint a thread");
        },
      },
    });

    await expect(
      persister.append({
        threadId: "thread-1",
        userId: "org_local:user-1",
        messages,
        agentId: "researcher",
      }),
    ).resolves.toBe(true);
    expect(calls).toEqual([
      {
        threadId: "thread-1",
        userId: "org_local:user-1",
        messages,
        agentId: "researcher",
      },
    ]);
  });

  test("falls back to HTTP append on /api/threads/:id/messages", async () => {
    const urls: string[] = [];
    const persister = createThreadPersister({
      apiUrl: "https://intelligence.test",
      apiKey: "key",
      fetchImpl: (async (input) => {
        urls.push(String(input));
        return new Response("{}", { status: 200 });
      }) as typeof fetch,
    });

    await expect(
      persister.append({
        threadId: "thread-1",
        userId: "org_local:user-1",
        messages,
      }),
    ).resolves.toBe(true);
    expect(urls).toEqual([
      "https://intelligence.test/api/threads/thread-1/messages",
    ]);
  });
});
