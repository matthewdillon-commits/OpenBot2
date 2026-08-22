/**
 * Inbox state that outlives a request: the IMAP cursor.
 *
 * Its own file so the mailbox tools and the inbound poller can share it without
 * putting mailboxes on the jobs schema. One row per mailbox (host, port, user).
 * UIDVALIDITY changing resets the last UID; the poller seeds without firing so
 * an existing inbox is not dumped onto a coworker.
 */
import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

export const emailInboxCursors = pgTable("email_inbox_cursors", {
  mailboxKey: text("mailbox_key").primaryKey(),
  uidValidity: integer("uid_validity").notNull(),
  lastUid: integer("last_uid").notNull(),
  updatedAt: updatedAt(),
});
