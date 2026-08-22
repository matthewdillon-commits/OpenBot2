import { eq } from "drizzle-orm";
import type { Database } from "../db/client";
import { emailInboxCursors } from "../db/schema";
import type { EmailMailbox } from "./mailbox";

export type InboxCursor = {
  mailboxKey: string;
  uidValidity: number;
  lastUid: number;
};

export type InboxCursorStore = {
  get(mailboxKey: string): Promise<InboxCursor | null>;
  save(cursor: InboxCursor): Promise<void>;
};

/**
 * A stable key for one IMAP mailbox.
 *
 * Host, port and user, never the password. Rotating the mailbox (a different
 * host or user) is a new cursor so we seed rather than fire someone else's
 * leftover UIDs.
 */
export function mailboxKey(
  mailbox: Pick<EmailMailbox, "host" | "port" | "user">,
): string {
  return `imap:${mailbox.host}:${mailbox.port}:${mailbox.user}`;
}

export function createInboxCursorStore(database: Database): InboxCursorStore {
  return {
    async get(key) {
      const [row] = await database
        .select()
        .from(emailInboxCursors)
        .where(eq(emailInboxCursors.mailboxKey, key));
      if (!row) return null;
      return {
        mailboxKey: row.mailboxKey,
        uidValidity: row.uidValidity,
        lastUid: row.lastUid,
      };
    },

    async save(cursor) {
      await database
        .insert(emailInboxCursors)
        .values({
          mailboxKey: cursor.mailboxKey,
          uidValidity: cursor.uidValidity,
          lastUid: cursor.lastUid,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: emailInboxCursors.mailboxKey,
          set: {
            uidValidity: cursor.uidValidity,
            lastUid: cursor.lastUid,
            updatedAt: new Date(),
          },
        });
    },
  };
}

export function memoryInboxCursorStore(): InboxCursorStore & {
  rows: Map<string, InboxCursor>;
} {
  const rows = new Map<string, InboxCursor>();
  return {
    rows,
    async get(key) {
      return rows.get(key) ?? null;
    },
    async save(cursor) {
      rows.set(cursor.mailboxKey, { ...cursor });
    },
  };
}
