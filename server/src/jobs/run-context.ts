/**
 * Which goal a CopilotKit turn is on, so a specialist can join that room.
 *
 * The client already sends the Intelligence thread id on the run. The server
 * looks the mapping up and refuses if there is none — it does not mint a
 * second id. A mapped id Intelligence has not seen is opened on first contact.
 */
export type ToolRunContext = {
  channelId: string;
  threadId: string;
  goalId: string;
};

export function threadIdFromCopilotRequest(
  body: unknown,
  url?: string,
): string | null {
  if (typeof url === "string") {
    try {
      const parsed = new URL(url, "http://openbot.local");
      const query =
        parsed.searchParams.get("threadId") ??
        parsed.searchParams.get("thread_id");
      if (query?.trim()) return query.trim();
    } catch {
      // A relative path still parses against the base above.
    }
  }
  return findThreadId(body);
}

function findThreadId(value: unknown, depth = 0): string | null {
  if (depth > 6 || value == null) return null;
  if (typeof value === "string") return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findThreadId(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  for (const key of ["threadId", "thread_id"]) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  if (record.thread && typeof record.thread === "object") {
    const id = (record.thread as { id?: unknown }).id;
    if (typeof id === "string" && id.trim()) return id.trim();
  }
  for (const nested of Object.values(record)) {
    const found = findThreadId(nested, depth + 1);
    if (found) return found;
  }
  return null;
}
