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
  integer,
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
    /** How the job was asked for: `manual` (Send-and-go), `cron`, `webhook`, or `email`. */
    trigger: text("trigger").notNull().default("manual"),
    payload: jsonb("payload").notNull(),
    status: jobStatus("status").notNull().default("queued"),
    /**
     * The Intelligence thread already mapped for (acting user, channel). Never minted here.
     */
    threadId: text("thread_id").notNull(),
    /**
     * The coworker is waiting on a person (login, 2FA, a secret). Set by server
     * computer_request_help / computer_request_secret. The job stays running; the
     * skinny outcome is Needs you.
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

export const jobTriggerKind = pgEnum("job_trigger_kind", [
  "cron",
  "webhook",
  "email",
]);

/**
 * Standing config that enqueues the same `jobs` row Phase 1 already runs.
 *
 * Cron, webhook, and inbound email are not a second runner. Each row names the
 * actor, org, goal/channel, thread, coworker, and prompt. When the trigger
 * fires it inserts through `jobStore.enqueue`; the worker still claims with
 * `FOR UPDATE SKIP LOCKED`. A missing mapping or thread is a refuse — this
 * table does not mint an Intelligence thread.
 */
export const jobTriggers = pgTable(
  "job_triggers",
  {
    id: text("id").primaryKey(),
    orgId: organizationIdColumn(),
    kind: jobTriggerKind("kind").notNull(),
    channelId: text("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    /**
     * In this tree a goal is the existing channel. Stored so a fire can pass
     * `goalId` into `startUnattendedRun` without a Goals table.
     */
    goalId: text("goal_id").notNull(),
    /**
     * The Intelligence thread already mapped for (acting user, channel).
     * Rechecked at fire; a mismatch or a missing live mapping is a refuse.
     */
    threadId: text("thread_id").notNull(),
    coworkerId: text("coworker_id")
      .notNull()
      .references(() => agents.id, { onDelete: "restrict" }),
    /**
     * Who the job runs as. Cron / webhook / email have no cookie Request;
     * this is the actor, resolved the same way the worker reloads a job row.
     */
    actingUserId: text("acting_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    prompt: text("prompt").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    /** Cron only: seconds between fires. Null on webhook and email rows. */
    everySeconds: integer("every_seconds"),
    /** Cron only: when this row is next due. Advanced under SKIP LOCKED. */
    nextRunAt: timestamp("next_run_at", { withTimezone: true }),
    /**
     * Webhook and email: SHA-256 of the org-scoped secret. The plaintext is
     * returned once at create and never stored.
     */
    secretHash: text("secret_hash"),
    /**
     * Email only: the mailbox address this maps to. Looked up when a message
     * arrives; unknown addresses are a refuse.
     */
    mailbox: text("mailbox"),
    lastEnqueuedAt: timestamp("last_enqueued_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("job_triggers_org_kind_idx").on(table.orgId, table.kind),
    index("job_triggers_cron_due_idx").on(
      table.kind,
      table.enabled,
      table.nextRunAt,
    ),
    uniqueIndex("job_triggers_mailbox_unique")
      .on(table.mailbox)
      .where(sql`${table.mailbox} is not null`),
  ],
);
