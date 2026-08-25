/**
 * Unattended coworker jobs: work that starts from a channel and finishes after the tab closes.
 *
 * Isolation is `org_id`, the same way CRM is. The API inserts a `queued` row; a worker claims it
 * with `FOR UPDATE SKIP LOCKED` and runs it. Holding the run in an in-process Map on the replica
 * that accepted the click would mean a second replica never sees the job, and a restart drops it.
 */

import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { agents, channels, organizationIdColumn, users } from "./core";
import { jsonb } from "./json";

const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

export const jobStatus = pgEnum("job_status", [
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
]);

export const jobs = pgTable(
  "jobs",
  {
    id: text("id").primaryKey(),
    orgId: organizationIdColumn(),
    channelId: text("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    /**
     * The owner-facing unit is a goal. In this tree a goal is the existing channel plus its
     * Intelligence thread — the same conversation, not a second transcript. Stored so
     * startUnattendedRun can take goalId without inventing a Goals table this phase.
     */
    goalId: text("goal_id").notNull(),
    /**
     * The coworker that should speak this job. Named on the row so a room of several does not
     * guess, and so a later audit read can say which Bot ran without joining the channel.
     */
    coworkerId: text("coworker_id")
      .notNull()
      .references(() => agents.id, { onDelete: "restrict" }),
    actingUserId: text("acting_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    /** Phase 1 is explicit Send-and-go. Cron / webhook / email arrive later. */
    trigger: text("trigger").notNull().default("manual"),
    payload: jsonb("payload").notNull(),
    status: jobStatus("status").notNull().default("queued"),
    /**
     * The Intelligence thread already mapped for (acting user, channel). Never minted here.
     */
    threadId: text("thread_id").notNull(),
    /**
     * Phase 2: the coworker is waiting on a person. Unused in Phase 1; the column exists so a
     * later migration does not have to add it under a running worker.
     */
    needsYou: boolean("needs_you").notNull().default(false),
    error: text("error"),
    /**
     * Skinny measure written when the job finishes. Status is not enough: a later read needs
     * who ran, which channel, a one-sentence summary, and any CRM ids the write already
     * returned. Not an approval card.
     */
    outcome: jsonb("outcome"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("jobs_org_status_created_idx").on(
      table.orgId,
      table.status,
      table.createdAt,
    ),
    index("jobs_org_channel_idx").on(table.orgId, table.channelId),
    /**
     * One running job per thread. SKIP LOCKED picks a row; this index is what stops two workers
     * that both passed the subquery from actually running the same conversation.
     */
    uniqueIndex("jobs_one_running_per_thread")
      .on(table.threadId)
      .where(sql`${table.status} = 'running'`),
  ],
);
