/**
 * The persist write for an unattended turn is the same CopilotRuntime Intelligence
 * runner an open-tab turn uses.
 *
 * Tab turns hit `handleRunAgent` → `handleIntelligenceRun` →
 * `getOrCreateThread` → `ɵacquireThreadLock` → `runtime.runner.run`.
 * That runner (`IntelligenceAgentRunner`) joins the Phoenix ingestion
 * channel and pushes AG-UI events onto the thread. This file is that path
 * without a browser Request: open the mapped id (so a first job is not
 * THREAD_NOT_FOUND), take the same lock the tab takes (so the gateway
 * accepts the join), then run and wait until those events are durable.
 *
 * `getThread` is a read. Persist is true only after the run, when Intelligence
 * on that same thread shows the user prompt and the assistant result.
 * Guessed appends (`appendMessages` / POST `/api/threads/:id/messages`) are
 * never used. A second job on the same mapping opens the same thread id.
 */
import type { AbstractAgent, RunAgentInput } from "@ag-ui/client";
import {
  type IntelligenceThreadOpener,
  openIntelligenceThread,
} from "./open-thread";
import type { UnattendedMessage } from "./thread";

export type UnattendedRuntimeRunner = {
  run: (request: {
    threadId: string;
    agent: AbstractAgent;
    input: RunAgentInput;
    persistedInputMessages?: UnattendedMessage[];
  }) => {
    subscribe: (observer: {
      next?: (value: unknown) => void;
      error?: (error: unknown) => void;
      complete?: () => void;
    }) => unknown;
  };
  runWithStartupBoundary?: (request: {
    threadId: string;
    agent: AbstractAgent;
    input: RunAgentInput;
    persistedInputMessages?: UnattendedMessage[];
  }) => {
    events: {
      subscribe: (observer: {
        next?: (value: unknown) => void;
        error?: (error: unknown) => void;
        complete?: () => void;
      }) => unknown;
    };
    startup: Promise<void>;
  };
};

export type ThreadLockClient = {
  ɵacquireThreadLock?: (params: {
    threadId: string;
    runId: string;
    userId: string;
    agentId: string;
    ttlSeconds?: number;
  }) => Promise<{ threadId?: string; runId?: string }>;
  ɵcleanupThreadLock?: (params: {
    threadId: string;
    runId: string;
  }) => Promise<void>;
  ɵrenewThreadLock?: (params: {
    threadId: string;
    runId: string;
    ttlSeconds: number;
  }) => Promise<unknown>;
};

export type UnattendedCopilotRuntime = {
  runner: UnattendedRuntimeRunner;
  intelligence?: IntelligenceThreadOpener & ThreadLockClient;
  lockTtlSeconds?: number;
  lockHeartbeatIntervalSeconds?: number;
  /**
   * How long Phoenix join / runner startup may sit with no RUN_STARTED.
   * Live after #35: mint 404s then silence — `startup` never resolved and
   * the job stayed `running` for minutes, blocking the next claim.
   */
  runnerStartupTimeoutMs?: number;
};

/** Fail the job in seconds if the Intelligence runner never joins. */
export const DEFAULT_RUNNER_STARTUP_TIMEOUT_MS = 15_000;

function assistantText(messages: UnattendedMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "assistant" && message.content.trim()) {
      return message.content;
    }
  }
  return "";
}

function messagesFromAgent(agent: AbstractAgent): UnattendedMessage[] {
  const raw = (
    agent as {
      messages?: Array<{ id?: string; role?: string; content?: unknown }>;
    }
  ).messages;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((message) => {
    if (
      (message.role === "system" ||
        message.role === "user" ||
        message.role === "assistant") &&
      typeof message.content === "string"
    ) {
      return [
        {
          id:
            typeof message.id === "string"
              ? message.id
              : `${message.role}_${crypto.randomUUID()}`,
          role: message.role,
          content: message.content,
        },
      ];
    }
    return [];
  });
}

function waitForObservable(observable: {
  subscribe: (observer: {
    next?: (value: unknown) => void;
    error?: (error: unknown) => void;
    complete?: () => void;
  }) => unknown;
}): Promise<void> {
  return new Promise((resolve, reject) => {
    observable.subscribe({
      error: reject,
      complete: resolve,
    });
  });
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function waitForRunner(
  runner: UnattendedRuntimeRunner,
  request: Parameters<UnattendedRuntimeRunner["run"]>[0],
  startupTimeoutMs: number,
): Promise<void> {
  const startupMessage =
    "Intelligence runner did not join the thread in time. The job will not stay running on a missing join.";
  if (typeof runner.runWithStartupBoundary === "function") {
    const started = runner.runWithStartupBoundary(request);
    await withTimeout(started.startup, startupTimeoutMs, startupMessage);
    await waitForObservable(started.events);
    return;
  }
  await waitForObservable(runner.run(request));
}

/**
 * `handleIntelligenceRun` acquires this lock before `runner.run` so the
 * Phoenix ingestion channel join is accepted. Without it the runner
 * completes with CHANNEL_JOIN_ERROR and nothing is written.
 */
async function withThreadLock<T>(
  intelligence: ThreadLockClient | undefined,
  params: {
    threadId: string;
    runId: string;
    userId: string;
    agentId: string;
    ttlSeconds: number;
    heartbeatMs: number;
  },
  run: (canonical: { threadId: string; runId: string }) => Promise<T>,
): Promise<T> {
  // Call lock methods with an explicit receiver. Extracting
  // `ɵacquireThreadLock` and invoking it unbound makes
  // CopilotKitIntelligence evaluate `this.#request` with `this === undefined`
  // — the live unattended failure `undefined is not an object (evaluating
  // 'this.#request')`. There is no incoming HTTP Request here; `#request`
  // is the client's private fetch helper.
  if (!intelligence || typeof intelligence.ɵacquireThreadLock !== "function") {
    return run({ threadId: params.threadId, runId: params.runId });
  }
  const lock = await intelligence.ɵacquireThreadLock.call(intelligence, {
    threadId: params.threadId,
    runId: params.runId,
    userId: params.userId,
    agentId: params.agentId,
    ttlSeconds: params.ttlSeconds,
  });
  const threadId = lock.threadId?.trim() || params.threadId;
  const runId = lock.runId?.trim() || params.runId;
  if (threadId !== params.threadId) {
    throw new Error(
      "Intelligence opened a different thread than the one mapped to this goal.",
    );
  }
  const heartbeat =
    typeof intelligence.ɵrenewThreadLock === "function"
      ? setInterval(() => {
          if (typeof intelligence.ɵrenewThreadLock !== "function") return;
          void intelligence.ɵrenewThreadLock
            .call(intelligence, {
              threadId,
              runId,
              ttlSeconds: params.ttlSeconds,
            })
            .catch(() => undefined);
        }, params.heartbeatMs)
      : undefined;
  try {
    return await run({ threadId, runId });
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    if (typeof intelligence.ɵcleanupThreadLock === "function") {
      await intelligence.ɵcleanupThreadLock
        .call(intelligence, { threadId, runId })
        .catch(() => undefined);
    }
  }
}

/**
 * Open the mapped thread if Intelligence has not seen it, then start the
 * coworker through `CopilotRuntime.runner.run`.
 */
export async function runUnattendedThroughRuntime(input: {
  runtime: UnattendedCopilotRuntime;
  agent: AbstractAgent;
  threadId: string;
  userId: string;
  agentId: string;
  messages: UnattendedMessage[];
}): Promise<{ text: string; messages: UnattendedMessage[] }> {
  const intelligence = input.runtime.intelligence;
  if (intelligence && typeof intelligence.getOrCreateThread === "function") {
    await openIntelligenceThread(intelligence, {
      threadId: input.threadId,
      userId: input.userId,
      agentId: input.agentId,
    });
  }
  const runId = `run_${crypto.randomUUID()}`;
  const agent = input.agent as AbstractAgent & {
    setMessages?: (messages: unknown[]) => void;
    threadId?: string;
  };
  agent.setMessages?.(input.messages);
  agent.threadId = input.threadId;
  const ttlSeconds = input.runtime.lockTtlSeconds ?? 20;
  const heartbeatMs = (input.runtime.lockHeartbeatIntervalSeconds ?? 15) * 1000;
  const startupTimeoutMs =
    input.runtime.runnerStartupTimeoutMs ?? DEFAULT_RUNNER_STARTUP_TIMEOUT_MS;
  await withThreadLock(
    intelligence,
    {
      threadId: input.threadId,
      runId,
      userId: input.userId,
      agentId: input.agentId,
      ttlSeconds,
      heartbeatMs,
    },
    async (canonical) => {
      agent.threadId = canonical.threadId;
      await waitForRunner(
        input.runtime.runner,
        {
          threadId: canonical.threadId,
          agent: input.agent,
          input: {
            threadId: canonical.threadId,
            runId: canonical.runId,
            messages: input.messages,
            tools: [],
            context: [],
          },
          persistedInputMessages: input.messages,
        },
        startupTimeoutMs,
      );
    },
  );
  // Only assistant tokens count. Falling back to input.messages made
  // resultText the prompt echo (“Say hello…”) while the runner was still
  // waiting and no model hello existed.
  const messages = messagesFromAgent(input.agent);
  return {
    text: assistantText(messages),
    messages,
  };
}
