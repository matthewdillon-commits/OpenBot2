/**
 * Open the mapped Intelligence thread the same way a tab `handleIntelligenceRun` does.
 *
 * CopilotKit's run path calls `CopilotKitIntelligence.getOrCreateThread` with the
 * caller's thread id and `identifyUser` id, then `runtime.runner.run` writes AG-UI
 * events. That is how a thread that exists only as a row in our mapping becomes a
 * real Intelligence transcript. This file is that first step: open *this* mapped
 * id under the exact `org:user` key Intelligence already uses. It does not mint a
 * second id, and it does not guess `appendMessages` / HTTP POST `/messages`.
 *
 * `getOrCreateThread` GETs, then POSTs `/api/threads` on 404. A wrapper that
 * returns the mapped id without that POST leaves `GET /api/threads/:id` as
 * `known:true` in our app while Intelligence still 404s — and `runner.run`
 * then waits forever on Phoenix join. After open, `getThread` must succeed
 * on the platform. If it still 404s, this POSTs `createThread` and confirms
 * again. Still missing is a refuse, not a hang.
 */
import { threadIdFromCopilotRequest } from "./run-context";

export type OpenThreadParams = {
  threadId: string;
  userId: string;
  agentId: string;
};

export type OpenedThread = {
  threadId: string;
  userId: string;
  agentId: string;
  created: boolean;
};

export type IntelligenceThreadOpener = {
  getOrCreateThread: (params: OpenThreadParams) => Promise<unknown>;
  /**
   * Existence read after mint. Persist and `GET /api/threads/:id` use the same
   * call. Required on the production client; optional only so a mapping stub
   * can still compile. Missing at runtime is a refuse.
   */
  getThread?: (params: {
    threadId: string;
    userId: string;
  }) => Promise<unknown>;
  /**
   * Explicit `POST /api/threads` when getOrCreate returned an id the platform
   * still 404s. CopilotKitIntelligence implements this.
   */
  createThread?: (params: OpenThreadParams) => Promise<unknown>;
};

export const THREAD_NOT_ON_PLATFORM =
  "Intelligence does not have this thread. The first job must POST /api/threads after the get 404; it will not wait on a runner join.";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function threadIdOf(value: unknown, fallback: string): string {
  const record = asRecord(value);
  if (!record) return fallback;
  const nested = asRecord(record.thread);
  const candidates = [record.threadId, record.id, nested?.id, nested?.threadId];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return fallback;
}

function createdOf(value: unknown): boolean {
  const record = asRecord(value);
  if (!record) return false;
  if (record.created === true) return true;
  const nested = asRecord(record.thread);
  return nested?.created === true;
}

function statusOf(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
}

export function isThreadNotFound(error: unknown): boolean {
  return statusOf(error) === 404;
}

function isConflict(error: unknown): boolean {
  return statusOf(error) === 409;
}

function notOnPlatform(): Error & { status: number } {
  const error = new Error(THREAD_NOT_ON_PLATFORM) as Error & { status: number };
  error.status = 404;
  return error;
}

/**
 * `getThread` must return this mapped id. An empty object, a missing method,
 * or a 404 is the live "known:true wrapper" — not a thread Intelligence has.
 */
export async function requireIntelligenceThread(
  intelligence: IntelligenceThreadOpener,
  params: { threadId: string; userId: string },
): Promise<unknown> {
  if (typeof intelligence.getThread !== "function") {
    throw new Error(
      "Intelligence getThread is required to confirm the mapped thread exists.",
    );
  }
  let thread: unknown;
  try {
    thread = await intelligence.getThread(params);
  } catch (error) {
    if (isThreadNotFound(error)) throw notOnPlatform();
    throw error;
  }
  const id = threadIdOf(thread, "");
  if (!id || id !== params.threadId) {
    throw notOnPlatform();
  }
  return thread;
}

async function createAndConfirm(
  intelligence: IntelligenceThreadOpener,
  params: OpenThreadParams,
): Promise<void> {
  if (typeof intelligence.createThread === "function") {
    try {
      await intelligence.createThread(params);
    } catch (error) {
      if (isThreadNotFound(error)) throw notOnPlatform();
      if (!isConflict(error)) throw error;
    }
  }
  await requireIntelligenceThread(intelligence, params);
}

/**
 * Open the mapped thread id in Intelligence. A second call with the same
 * `(threadId, userId)` attaches; it does not mint a second thread.
 */
export async function openIntelligenceThread(
  intelligence: IntelligenceThreadOpener,
  params: OpenThreadParams,
): Promise<OpenedThread> {
  const threadId = params.threadId.trim();
  const userId = params.userId.trim();
  const agentId = params.agentId.trim();
  if (!threadId) {
    throw new Error("A mapped Intelligence thread id is required.");
  }
  if (!userId) {
    throw new Error("An Intelligence user id is required.");
  }
  const result = await intelligence.getOrCreateThread({
    threadId,
    userId,
    agentId,
  });
  const openedId = threadIdOf(result, threadId);
  if (openedId !== threadId) {
    throw new Error(
      "Intelligence opened a different thread than the one mapped to this goal.",
    );
  }
  try {
    await requireIntelligenceThread(intelligence, {
      threadId: openedId,
      userId,
    });
  } catch (error) {
    if (!isThreadNotFound(error)) throw error;
    await createAndConfirm(intelligence, { threadId, userId, agentId });
  }
  return {
    threadId: openedId,
    userId,
    agentId,
    created: createdOf(result),
  };
}

const AGENT_CONTACT = /\/agent\/([^/]+)\/(connect|run)\/?$/i;
const THREAD_MESSAGES = /\/threads\/([^/]+)\/messages\/?$/i;

/**
 * The first CopilotKit contact that must find a real Intelligence thread:
 * connect (composer join), run (tab turn), or messages (history restore).
 */
export function firstContactFromRequest(request: Request): {
  threadId: string | null;
  agentId: string | null;
  kind: "connect" | "run" | "messages" | null;
} {
  let path = request.url;
  try {
    path = new URL(request.url).pathname;
  } catch {
    // Relative paths still match the agent / thread suffixes below.
  }
  const agent = path.match(AGENT_CONTACT);
  if (agent?.[1] && agent[2]) {
    const kind = agent[2].toLowerCase() as "connect" | "run";
    return {
      threadId: threadIdFromCopilotRequest(null, request.url),
      agentId: decodeURIComponent(agent[1]),
      kind,
    };
  }
  const messages = path.match(THREAD_MESSAGES);
  if (messages?.[1]) {
    let agentId: string | null = null;
    try {
      agentId = new URL(request.url).searchParams.get("agentId");
    } catch {
      agentId = null;
    }
    return {
      threadId: decodeURIComponent(messages[1]),
      agentId,
      kind: "messages",
    };
  }
  return { threadId: null, agentId: null, kind: null };
}

/**
 * Open the mapped thread before CopilotKit connect/run/messages can 404.
 *
 * `handleIntelligenceConnect` calls `ɵconnectThread` and forwards a platform
 * 404 as "Not Found". `handleIntelligenceRun` already get-or-creates; doing
 * the same here on connect (and on a messages GET for a new goal) is what
 * lets the first composer send run instead of locking the input.
 */
export async function openThreadForFirstContact(input: {
  intelligence: IntelligenceThreadOpener;
  request: Request;
  userId: string;
  body?: unknown;
}): Promise<OpenedThread | null> {
  const contact = firstContactFromRequest(input.request);
  const threadId =
    contact.threadId ??
    threadIdFromCopilotRequest(input.body, input.request.url);
  const agentId = contact.agentId;
  if (!threadId || !agentId || !input.userId.trim() || !contact.kind) {
    return null;
  }
  return openIntelligenceThread(input.intelligence, {
    threadId,
    userId: input.userId,
    agentId,
  });
}
