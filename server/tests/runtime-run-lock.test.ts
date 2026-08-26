import { describe, expect, test } from "bun:test";
import type { AbstractAgent } from "@ag-ui/client";
import { startUnattendedRun } from "../src/jobs/run";
import {
  isRetryableThreadLockError,
  runUnattendedThroughRuntime,
  THREAD_LOCK_FAILED,
  THREAD_LOCK_STILL_HELD,
  withLockReleaseOnComplete,
} from "../src/jobs/runtime-run";
import type { UnattendedMessage } from "../src/jobs/thread";

const actor = {
  id: "user-1",
  name: "Ada",
  role: "user" as const,
  orgId: "org_local",
};

function threadLockFailed(): Error & {
  status: number;
  code: string;
  retryable: boolean;
} {
  const error = new Error(
    "Thread is already locked by another runner.",
  ) as Error & {
    status: number;
    code: string;
    retryable: boolean;
  };
  error.status = 409;
  error.code = THREAD_LOCK_FAILED;
  error.retryable = true;
  return error;
}

function replyAgent(text: string) {
  return {
    messages: [] as UnattendedMessage[],
    setMessages(next: UnattendedMessage[]) {
      this.messages = next;
    },
    async runAgent() {
      this.messages = [
        ...this.messages,
        { id: "a1", role: "assistant", content: text },
      ];
    },
  };
}

function completingRunner(
  record: (threadId: string, messages: UnattendedMessage[]) => void,
  reply = "Ada is at Acme.",
) {
  return {
    run({
      threadId,
      agent,
      input,
    }: {
      threadId: string;
      agent: AbstractAgent & {
        setMessages?: (next: unknown[]) => void;
        messages?: UnattendedMessage[];
      };
      input: { messages: UnattendedMessage[] };
    }) {
      return {
        subscribe(observer: {
          error?: (error: unknown) => void;
          complete?: () => void;
        }) {
          try {
            const next = [
              ...input.messages,
              { id: "a1", role: "assistant" as const, content: reply },
            ];
            agent.setMessages?.(next);
            record(threadId, next);
            observer.complete?.();
          } catch (error) {
            observer.error?.(error);
          }
        },
      };
    },
  };
}

function mappedDeps(
  intelligence: {
    getOrCreateThread: (params: {
      threadId: string;
      userId: string;
      agentId: string;
    }) => Promise<unknown>;
    getThread: (params: {
      threadId: string;
      userId: string;
    }) => Promise<unknown>;
    ɵacquireThreadLock: (params: {
      threadId: string;
      runId: string;
      userId: string;
      agentId: string;
    }) => Promise<{ threadId: string; runId: string }>;
    ɵcleanupThreadLock?: (params: {
      threadId: string;
      runId: string;
    }) => Promise<void>;
  },
  extras: Record<string, unknown> = {},
) {
  return {
    lookupMapping: async () => ({
      threadId: "thread-1",
      channelId: "channel_1",
      userId: actor.id,
    }),
    waitForThread: async () => "idle" as const,
    persistThread: async () => true,
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
    runtime: extras.runtime,
  };
}

describe("isRetryableThreadLockError", () => {
  test("recognises the live Intelligence 409", () => {
    expect(isRetryableThreadLockError(threadLockFailed())).toBe(true);
    expect(
      isRetryableThreadLockError({
        status: 409,
        code: THREAD_LOCK_FAILED,
        retryable: true,
        message: "Thread is already locked by another runner.",
      }),
    ).toBe(true);
    expect(isRetryableThreadLockError(new Error("different thread"))).toBe(
      false,
    );
  });
});

describe("unattended thread lock retry", () => {
  test("a 409 THREAD_LOCK_FAILED then 200 on retry succeeds on the same thread", async () => {
    const threads = new Map<string, UnattendedMessage[]>();
    let acquires = 0;
    const agent = replyAgent("Ada is at Acme.");
    const intelligence = {
      getOrCreateThread: async ({ threadId }: { threadId: string }) => ({
        thread: { id: threadId },
        created: false,
      }),
      getThread: async ({ threadId }: { threadId: string }) => ({
        id: threadId,
        messages: threads.get(threadId) ?? [],
      }),
      ɵacquireThreadLock: async ({
        threadId,
        runId,
      }: {
        threadId: string;
        runId: string;
      }) => {
        acquires += 1;
        if (acquires === 1) throw threadLockFailed();
        return { threadId, runId };
      },
      ɵcleanupThreadLock: async () => undefined,
    };
    const result = await startUnattendedRun({
      actor,
      orgId: actor.orgId,
      channelId: "channel_1",
      threadId: "thread-1",
      prompt: "Find Ada.",
      coworkerId: "researcher",
      deps: mappedDeps(intelligence, {
        prebuiltAgents: { researcher: agent },
        runtime: {
          intelligence,
          lockRetry: { maxAttempts: 3, delaysMs: [0, 0] },
          runner: completingRunner((threadId, messages) => {
            threads.set(threadId, messages);
          }),
        },
        persistThread: async () => true,
      }),
    });

    expect(acquires).toBe(2);
    expect(result.outcome).toBe("succeeded");
    expect(result.error).toBeUndefined();
    expect(result.text).toBe("Ada is at Acme.");
    expect([...threads.keys()]).toEqual(["thread-1"]);
  });

  test("exhausted lock retries mark the job failed with a visible error", async () => {
    let acquires = 0;
    const agent = replyAgent("should not run");
    const intelligence = {
      getOrCreateThread: async ({ threadId }: { threadId: string }) => ({
        thread: { id: threadId },
        created: false,
      }),
      getThread: async ({ threadId }: { threadId: string }) => ({
        id: threadId,
      }),
      ɵacquireThreadLock: async () => {
        acquires += 1;
        throw threadLockFailed();
      },
      ɵcleanupThreadLock: async () => undefined,
    };
    const result = await startUnattendedRun({
      actor,
      orgId: actor.orgId,
      channelId: "channel_1",
      threadId: "thread-1",
      prompt: "Find Ada.",
      coworkerId: "researcher",
      deps: mappedDeps(intelligence, {
        prebuiltAgents: { researcher: agent },
        runtime: {
          intelligence,
          lockRetry: { maxAttempts: 3, delaysMs: [0, 0] },
          runner: completingRunner(() => undefined),
        },
      }),
    });

    expect(acquires).toBe(3);
    expect(result.outcome).toBe("failed");
    expect(result.error).toBe(THREAD_LOCK_STILL_HELD);
    expect(result.text).toBeUndefined();
    expect(
      result.messages.some((message) => message.role === "assistant"),
    ).toBe(false);
  });
});

describe("withLockReleaseOnComplete", () => {
  test("releases the thread lock when the runner completes", async () => {
    const cleaned: Array<{ threadId: string; runId: string }> = [];
    const runner = {
      run({
        threadId,
        input,
      }: {
        threadId: string;
        input: { runId: string };
      }) {
        return {
          subscribe(observer: { complete?: () => void }) {
            observer.complete?.();
            return { unsubscribe() {} };
          },
        };
      },
    };
    const wrapped = withLockReleaseOnComplete(runner, {
      ɵcleanupThreadLock: async (params) => {
        cleaned.push(params);
      },
    });
    await new Promise<void>((resolve, reject) => {
      wrapped
        .run({
          threadId: "thread-1",
          agent: {} as AbstractAgent,
          input: {
            threadId: "thread-1",
            runId: "run-1",
            messages: [],
            tools: [],
            context: [],
          },
        })
        .subscribe({
          complete: resolve,
          error: reject,
        });
    });
    expect(cleaned).toEqual([{ threadId: "thread-1", runId: "run-1" }]);
  });

  test("runUnattendedThroughRuntime still uses the mapped thread after a lock retry", async () => {
    const opened: string[] = [];
    let acquires = 0;
    const agent = replyAgent("hello back");
    const result = await runUnattendedThroughRuntime({
      runtime: {
        intelligence: {
          getOrCreateThread: async ({ threadId }: { threadId: string }) => {
            opened.push(threadId);
            return { thread: { id: threadId }, created: false };
          },
          getThread: async ({ threadId }: { threadId: string }) => ({
            id: threadId,
          }),
          ɵacquireThreadLock: async ({
            threadId,
            runId,
          }: {
            threadId: string;
            runId: string;
          }) => {
            acquires += 1;
            if (acquires === 1) throw threadLockFailed();
            return { threadId, runId };
          },
          ɵcleanupThreadLock: async () => undefined,
        },
        lockRetry: { maxAttempts: 2, delaysMs: [0] },
        runner: completingRunner(() => undefined, "hello back"),
      },
      agent: agent as never,
      threadId: "thread-1",
      userId: "org_local:user-1",
      agentId: "researcher",
      messages: [{ id: "u1", role: "user", content: "Say hello" }],
    });
    expect(opened).toEqual(["thread-1"]);
    expect(acquires).toBe(2);
    expect(result.text).toBe("hello back");
  });
});
