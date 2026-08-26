/**
 * The Intelligence thread for an unattended run — look up, wait if locked, confirm after.
 *
 * Intelligence user ids are already `org:user`. The mapping row for (acting user, channel)
 * is the source of truth for *which* thread id we attach to. A job that cannot find that
 * row is refused. A mapped id that Intelligence has not seen yet is opened through the
 * CopilotRuntime path (`getOrCreateThread` + `runner.run`) — the same first step a tab
 * `handleIntelligenceRun` takes — not refused as THREAD_NOT_FOUND.
 *
 * This file does not write. After the run, persist is true only when `getThread` /
 * `getThreadMessages` on that same mapped thread include the user prompt and the
 * assistant result. Never probe guessed append names or POST `/api/threads/:id/messages`.
 * Persist false or throw is FAILED. The job row is not a second transcript.
 */
import { identifyUserFromContext } from "./actor";

export type ThreadMapping = {
  threadId: string;
  channelId: string;
  userId: string;
  /** The exact Intelligence key (`org:user`). */
  intelligenceUserId?: string;
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
 * Reads used after `CopilotRuntime.runner.run` to confirm the mapped thread
 * now holds this turn. Mint methods are typed so a test can prove a second
 * job does not mint a *second* thread id — `getOrCreateThread` on the mapped
 * id is the open, not a new mapping.
 */
export type IntelligenceThreadClient = {
  getThread: (params: { threadId: string; userId: string }) => Promise<unknown>;
  getThreadMessages?: (params: {
    threadId: string;
    userId: string;
  }) => Promise<unknown>;
  getOrCreateThread?: (params: {
    threadId: string;
    userId: string;
    agentId: string;
  }) => Promise<unknown>;
  createThread?: (...args: never[]) => unknown;
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
 * 404 is missing: the first job opens it through Runtime rather than refusing.
 * 409, or a running shape, is busy. Anything else is rethrown so a timeout is
 * not silently treated as "go ahead and start a second run".
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

function textsFrom(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  const list = Array.isArray(record.messages)
    ? record.messages
    : Array.isArray(value)
      ? value
      : [];
  const texts: string[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const content = (item as { content?: unknown }).content;
    if (typeof content === "string" && content.trim()) texts.push(content);
  }
  return texts;
}

/**
 * After `runtime.runner.run`, confirm the mapped thread still exists and now
 * holds this turn. `getThread` is the existence read. `getThreadMessages` is
 * how this client exposes the transcript. Persist is true only when both the
 * user prompt and the assistant result are on that same thread.
 */
export function createThreadPersister(options: {
  intelligence?: IntelligenceThreadClient;
}): ThreadPersister {
  return {
    async append({ threadId, userId, messages }) {
      const client = options.intelligence;
      if (!client || typeof client.getThread !== "function") return false;
      let thread: unknown;
      try {
        thread = await client.getThread({ threadId, userId });
      } catch (error) {
        if (statusOf(error) === 404) return false;
        throw error;
      }
      const history =
        typeof client.getThreadMessages === "function"
          ? await client.getThreadMessages({ threadId, userId })
          : thread;
      const texts = [...textsFrom(thread), ...textsFrom(history)];
      const prompt = messages.find(
        (message) => message.role === "user",
      )?.content;
      const result = [...messages]
        .reverse()
        .find((message) => message.role === "assistant")?.content;
      if (!prompt?.trim() || !result?.trim()) return false;
      return (
        texts.some((text) => text.includes(prompt)) &&
        texts.some((text) => text.includes(result))
      );
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
