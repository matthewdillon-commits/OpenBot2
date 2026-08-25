/**
 * The existing Intelligence thread for an unattended run — look up, wait if locked, persist after.
 *
 * Do not mint a thread. Intelligence user ids are already `org:user`. The mapping row for
 * (acting user, channel) is the source of truth; a job that cannot find that row is refused.
 *
 * Tab turns persist through the CopilotRuntime Intelligence runner while the browser is on the
 * turn. This path is not that runner. The client this tree already uses for thread reads is
 * `CopilotKitIntelligence.getThread` (see `intelligence-client.ts` and `channels/thread-status.ts`).
 * That class has no method that appends chat messages. Persist therefore confirms the mapped
 * thread with `getThread` and fails closed. Never probe guessed names, never POST a speculative
 * `/api/threads/:id/messages`, never treat `updateThread` (metadata) as a transcript write, and
 * never call `createThread` / `getOrCreateThread`. Persist false or throw is FAILED, never
 * succeeded. The job row is not a second transcript.
 */
import { identifyUserFromContext } from "./actor";

export type ThreadMapping = {
  threadId: string;
  channelId: string;
  userId: string;
};

export type ThreadRunState = "idle" | "busy" | "missing";

export type ThreadLookup = {
  mappingFor: (input: {
    userId: string;
    channelId: string;
    orgId: string;
  }) => Promise<ThreadMapping | null>;
};

export type ThreadIdleChecker = {
  state: (input: {
    threadId: string;
    userId: string;
  }) => Promise<ThreadRunState>;
};

export type UnattendedMessage = {
  id: string;
  role: "system" | "user" | "assistant";
  content: string;
};

export type ThreadPersister = {
  append: (input: {
    threadId: string;
    userId: string;
    messages: UnattendedMessage[];
    agentId?: string;
  }) => Promise<boolean>;
};

/**
 * The Intelligence methods this tree may call for an unattended persist attempt.
 *
 * Matches `createThreadReader` / `createThreadIdleChecker`: `getThread` only. Mint methods are
 * typed so a test can prove they are never invoked, not so this file can call them.
 */
export type IntelligenceThreadClient = {
  getThread: (params: { threadId: string; userId: string }) => Promise<unknown>;
  createThread?: (...args: never[]) => unknown;
  getOrCreateThread?: (...args: never[]) => unknown;
};

function statusOf(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
}

function isBusyShape(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (record.status === "running" || record.status === "locked") return true;
  if (record.locked === true) return true;
  if (record.activeRun && typeof record.activeRun === "object") return true;
  return false;
}

/**
 * Ask Intelligence whether this thread already has a run.
 *
 * 404 is missing: refuse, do not mint. 409, or a running shape, is busy. Anything else is
 * rethrown so a timeout is not silently treated as "go ahead and start a second run".
 */
export function createThreadIdleChecker(intelligence: {
  getThread: (params: { threadId: string; userId: string }) => Promise<unknown>;
}): ThreadIdleChecker {
  return {
    async state({ threadId, userId }) {
      try {
        const thread = await intelligence.getThread({ threadId, userId });
        return isBusyShape(thread) ? "busy" : "idle";
      } catch (error) {
        const status = statusOf(error);
        if (status === 404) return "missing";
        if (status === 409) return "busy";
        throw error;
      }
    },
  };
}

export async function waitForThreadIdle(
  checker: ThreadIdleChecker,
  input: { threadId: string; userId: string },
  options: { timeoutMs: number; pollMs: number } = {
    timeoutMs: 15_000,
    pollMs: 500,
  },
): Promise<ThreadRunState> {
  const deadline = Date.now() + options.timeoutMs;
  let last: ThreadRunState = "idle";
  while (Date.now() <= deadline) {
    last = await checker.state(input);
    if (last !== "busy") return last;
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(options.pollMs, remaining)),
    );
  }
  return last;
}

/**
 * Confirm the mapped Intelligence thread still exists, then fail closed.
 *
 * `CopilotKitIntelligence` in this deployment exposes `getThread` for that check — the same
 * method `createThreadReader` uses. It does not expose a chat-message write. Returning false
 * here is the honest answer; the job becomes FAILED. Do not invent a REST append.
 */
export function createThreadPersister(options: {
  intelligence?: IntelligenceThreadClient;
}): ThreadPersister {
  return {
    async append({ threadId, userId }) {
      const client = options.intelligence;
      if (!client || typeof client.getThread !== "function") return false;
      try {
        await client.getThread({ threadId, userId });
      } catch (error) {
        if (statusOf(error) === 404) return false;
        throw error;
      }
      return false;
    },
  };
}

export function intelligenceUserForActor(actor: {
  id: string;
  name: string;
  orgId: string;
}): string {
  return identifyUserFromContext(actor).id;
}
