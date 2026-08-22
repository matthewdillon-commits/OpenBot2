/**
 * Coworker tables: bots, skills, routines, bot-to-bot handoff.
 *
 * Split by owner so two people can add tables all day without touching the same lines. Add tables
 * here; never edit core.ts or computer.ts to do it.
 */
import {
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { agents, channels, users } from "./core";

const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

export const agentVisibility = pgEnum("agent_visibility", [
  "public",
  "private",
]);

export const agentProfiles = pgTable(
  "agent_profiles",
  {
    agentId: text("agent_id")
      .primaryKey()
      .references(() => agents.id, { onDelete: "cascade" }),
    ownerUserId: text("owner_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    title: text("title").notNull(),
    roleDescription: text("role_description").notNull(),
    avatarSeed: text("avatar_seed").notNull(),
    visibility: agentVisibility("visibility").notNull(),
    /*
     * The credential this Bot's agent presents when it calls a tool back.
     *
     * A hash, never the token. We issue it, the agent's owner holds it, and this side only ever needs
     * to check one: storing the token itself would mean a database dump is a set of working
     * credentials for every registered agent.
     *
     * Null means the agent has not been issued one and may not call tools back, which is the right
     * default: a URL somebody pasted gets no capability until an administrator hands it one.
     */
    callbackTokenHash: text("callback_token_hash"),
    callbackTokenIssuedAt: timestamp("callback_token_issued_at", {
      withTimezone: true,
    }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("agent_profiles_visibility_deleted_idx").on(
      table.visibility,
      table.deletedAt,
    ),
  ],
);

export const agentPreferences = pgTable(
  "agent_preferences",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    hiddenAt: timestamp("hidden_at", { withTimezone: true }),
  },
  (table) => [primaryKey({ columns: [table.userId, table.agentId] })],
);

/**
 * A message a Bot posted to a channel, including 1:1 DMs it opened with another Bot.
 *
 * Human turns still live on the Intelligence thread. These rows are what a Bot wrote when it
 * messaged a coworker or a room: the wake runner and the transcript both read them, and they
 * exist without Intelligence so a send can be tested and audited on this side.
 */
export const channelMessages = pgTable(
  "channel_messages",
  {
    id: text("id").primaryKey(),
    channelId: text("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    senderAgentId: text("sender_agent_id").references(() => agents.id, {
      onDelete: "set null",
    }),
    body: text("body").notNull(),
    /**
     * Distance from a human-started send. A Bot's own tool call is 1; each real wake reply
     * increments. Empty acknowledgements are never stored. A long unattended chain stops at
     * `MAX_MESSAGE_HOP` so two Bots cannot bounce forever.
     */
    hop: integer("hop").notNull().default(0),
    createdAt: createdAt(),
  },
  (table) => [
    index("channel_messages_channel_created_idx").on(
      table.channelId,
      table.createdAt,
    ),
  ],
);

export const subagentStatus = pgEnum("subagent_status", [
  "queued",
  "running",
  "completed",
  "blocked",
  "failed",
]);

/**
 * A finite background run a Bot started, not a coworker.
 *
 * The parent stays a coworker. This row is the chunk of work: the brief, the status, and the
 * result that wakes the parent when the child is done. There is no second agent directory and
 * no composer. The task channel named here holds the brief and the report so the existing
 * wake path can deliver the result; it is hidden from the roster.
 */
export const subagentRuns = pgTable(
  "subagent_runs",
  {
    id: text("id").primaryKey(),
    parentAgentId: text("parent_agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    actorUserId: text("actor_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    channelId: text("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    goal: text("goal").notNull(),
    successCriteria: text("success_criteria").notNull(),
    reportBack: text("report_back").notNull(),
    /** Latest correction from the parent. Same worker; not a new run. */
    followUp: text("follow_up"),
    followUpAt: timestamp("follow_up_at", { withTimezone: true }),
    status: subagentStatus("status").notNull().default("queued"),
    result: text("result"),
    hop: integer("hop").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    index("subagent_runs_parent_created_idx").on(
      table.parentAgentId,
      table.createdAt,
    ),
    index("subagent_runs_channel_idx").on(table.channelId),
  ],
);
