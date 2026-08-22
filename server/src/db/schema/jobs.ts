/**
 * Standing work that outlives a chat turn: cron schedules and inbound triggers.
 *
 * Its own file so this track can add tables without touching coworker.ts, which messaging
 * and sub-agents already own. Inbound email fires these rows through fireInbound; the
 * mailbox and the seen-cursor live in the email module.
 */
import {
  boolean,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { agents, channels, users } from "./core";

const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

export const scheduledJobKind = pgEnum("scheduled_job_kind", [
  "cron",
  "webhook",
  "email",
]);

export const scheduledJobStatus = pgEnum("scheduled_job_status", [
  "active",
  "paused",
]);

export const jobRunStatus = pgEnum("job_run_status", [
  "queued",
  "running",
  "succeeded",
  "failed",
]);

export const jobRunTrigger = pgEnum("job_run_trigger", [
  "cron",
  "webhook",
  "email",
]);

/**
 * A standing job: what to run, which coworker, on a schedule or an inbound event.
 *
 * `next_run_at` is the durable due time. An in-process poller claims rows that are due;
 * a restart still sees them because the time lives here, not in memory.
 */
export const scheduledJobs = pgTable(
  "scheduled_jobs",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    kind: scheduledJobKind("kind").notNull(),
    /** Five-field cron. Null on inbound-only jobs. */
    cronExpr: text("cron_expr"),
    /**
     * Skip Saturday and Sunday unless the record says otherwise.
     *
     * Default true: standing office work is weekday-bounded. A job that must run on a
     * weekend sets this false rather than encoding the exception in the cron string.
     */
    weekdayBounded: boolean("weekday_bounded").notNull().default(true),
    /** IANA timezone the cron is evaluated in. */
    timezone: text("timezone").notNull(),
    brief: text("brief").notNull(),
    status: scheduledJobStatus("status").notNull().default("active"),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }),
    /**
     * Hash of the webhook secret, never the secret.
     *
     * Null on cron-only and email-only jobs. A dump of this table must not be a working
     * credential for firing work.
     */
    webhookSecretHash: text("webhook_secret_hash"),
    /**
     * Hidden task channel that holds the brief and the coworker's reply.
     *
     * Created on first fire so a job that is never due does not leave a channel behind.
     */
    channelId: text("channel_id").references(() => channels.id, {
      onDelete: "set null",
    }),
    createdByUserId: text("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    /**
     * Optional inbound-email match. Empty means every new message.
     *
     * Case-insensitive substring on from / to / subject. The poller applies
     * these; they are not a second job system.
     */
    matchFrom: text("match_from"),
    matchTo: text("match_to"),
    matchSubject: text("match_subject"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("scheduled_jobs_due_idx").on(table.status, table.nextRunAt),
    index("scheduled_jobs_agent_idx").on(table.agentId),
  ],
);

/**
 * One firing of a scheduled job.
 *
 * The job row is what to run next; this row is what happened. Status and result survive
 * a restart so an operator can see a run that was queued when the process died.
 */
export const jobRuns = pgTable(
  "job_runs",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id")
      .notNull()
      .references(() => scheduledJobs.id, { onDelete: "cascade" }),
    status: jobRunStatus("status").notNull().default("queued"),
    trigger: jobRunTrigger("trigger").notNull(),
    result: text("result"),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [
    index("job_runs_job_created_idx").on(table.jobId, table.createdAt),
    index("job_runs_status_idx").on(table.status),
  ],
);
