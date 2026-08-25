/**
 * The existing Intelligence thread for an unattended run — look up, wait if locked, persist after.
 *
 * Do not mint a thread. Intelligence user ids are already `org:user`. The mapping row for
 * (acting user, channel) is the source of truth; a job that cannot find that row is refused.
 *
 * Intelligence WebSocket is for replay to an open tab. Persistence is a write to that same
 * thread (duck-typed SDK or HTTP), plus the job payload, plus channel `lastMessage`. A second
 * chat store must not become the source of truth.
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
  }) => Promise<boolean>;
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
 * 404 is idle-enough: the mapping exists and the first persist will create history. 409, or a
 * running shape, is busy. Anything else is rethrown so a timeout is not silently treated as
 * "go ahead and start a second run".
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
 * Best-effort write of the unattended transcript onto the mapped Intelligence thread.
 *
 * Tries duck-typed client methods first, then a conventional HTTP append. Returns whether
 * something accepted the write. The caller still stores the transcript on the job and updates
 * channel lastMessage either way.
 */
export function createThreadPersister(options: {
  intelligence?: Record<string, unknown>;
  apiUrl?: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
}): ThreadPersister {
  const fetchImpl = options.fetchImpl ?? fetch;
  return {
    async append({ threadId, userId, messages }) {
      const client = options.intelligence;
      if (client) {
        for (const method of [
          "appendMessages",
          "addMessages",
          "createMessages",
        ] as const) {
          const fn = client[method];
          if (typeof fn === "function") {
            await (
              fn as (input: {
                threadId: string;
                userId: string;
                messages: UnattendedMessage[];
              }) => Promise<unknown>
            ).call(client, { threadId, userId, messages });
            return true;
          }
        }
      }
      const apiUrl = options.apiUrl?.replace(/\/$/, "");
      if (!apiUrl || !options.apiKey) return false;
      const response = await fetchImpl(
        `${apiUrl}/threads/${threadId}/messages`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${options.apiKey}`,
            "x-user-id": userId,
          },
          body: JSON.stringify({ userId, messages }),
        },
      );
      return response.ok;
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
