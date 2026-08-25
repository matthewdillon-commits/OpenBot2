import { and, asc, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type { Context, MiddlewareHandler } from "hono";
import { Hono } from "hono";
import {
  AgentNotFoundError,
  type AgentProfileStore,
} from "../agents/profile-store";
import type { AgentActor, AgentProfile } from "../agents/profile-types";
import type { AppVariables } from "../auth/guards";
import type { Database } from "../db/client";
import {
  agentProfiles,
  channelAgents,
  channelMemberships,
  channels,
  intelligenceChannelMappings,
} from "../db/schema";
import { jobs } from "../db/schema/jobs";
import { asJobOutcome, type GoalStatus } from "../jobs/outcome";
import { orgIdOf } from "../orgs/constants";
import {
  CHANNEL_ACTIVITY_TOPIC,
  type ChannelActivityEvent,
  type ChannelEventHub,
} from "./events";
import { upgradeWebSocket } from "./socket";
import type { ThreadIdentity } from "./thread-identity";

export type AgentChannel = {
  id: string;
  name: string;
  agentIds: string[];
  threadId: string;
  active: boolean;
};

/** A channel plus the last thing said in it, which is what a roster renders. */
export type ChannelSummary = AgentChannel & {
  lastMessage: string | null;
  lastMessageAt: Date | null;
  lastMessageAgentId: string | null;
  createdAt: Date;
  /** Phase 1 skinny goal status. Not an approval card. */
  goalStatus: GoalStatus;
  lastAction: string | null;
  lastActionAt: Date | null;
};

/** What a client that ran an agent reports back about the message it just saw. */
export type ChannelActivity = {
  text: string;
  /** The agent that said it, or null when a person did. */
  agentId: string | null;
  at: Date;
};

/** One page of somebody's channels, newest activity first. */
export type ChannelPage = {
  channels: ChannelSummary[];
  /** Where the next page starts, or null at the end. */
  nextCursor: string | null;
};

export type ChannelQuery = { cursor?: string; limit?: number };

/**
 * How many channels one page holds.
 *
 * The sidebar asked for all of them on every render, one row per channel-agent pair, and nothing
 * removes a channel: somebody who talks to their Bot daily accumulates thousands, so a query that is
 * instant in a demo returns thousands of rows on every page load for every employee, and grows
 * monotonically. A page is what a sidebar can show anyway.
 */
const DEFAULT_CHANNEL_PAGE = 50;

/** The most a caller may ask for, so the endpoint cannot be talked back into reading everything. */
const MAX_CHANNEL_PAGE = 200;

/** Where a page stopped: both halves of the sort, since two channels can share a timestamp. */
type ChannelCursor = { recency: string; id: string };

function encodeChannelCursor(cursor: ChannelCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

/** A malformed cursor reads as the first page, which is the honest answer to a stale link. */
function decodeChannelCursor(
  value: string | undefined,
): ChannelCursor | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as ChannelCursor;
    return typeof parsed?.id === "string" && typeof parsed?.recency === "string"
      ? parsed
      : undefined;
  } catch {
    return undefined;
  }
}

export type ChannelStore = {
  create(
    actor: AgentActor,
    agentIds: string[],
    options?: { name?: string },
  ): Promise<AgentChannel>;
  get(actor: AgentActor, channelId: string): Promise<AgentChannel | null>;
  getByThread(
    actor: AgentActor,
    threadId: string,
  ): Promise<AgentChannel | null>;
  list(actor: AgentActor, query?: ChannelQuery): Promise<ChannelPage>;
  recordActivity(
    actor: AgentActor,
    channelId: string,
    activity: ChannelActivity,
  ): Promise<void>;
  /**
   * Add specialists to this goal’s room. The lead (position 0) stays the
   * orchestrator. Refuses past eight members.
   */
  addAgents(
    actor: AgentActor,
    channelId: string,
    agentIds: string[],
  ): Promise<AgentChannel>;
};

const PRIVATE_AGENT_CHANNEL_DESCRIPTION = "Private agent channel.";
const MAX_CHANNEL_NAME_CODE_POINTS = 120;
const MAX_ACTIVITY_CODE_POINTS = 200;
/** Same ceiling the compose screen uses. Enforced here so the UI cap is not ornamental. */
export const MAX_CHANNEL_AGENTS = 8;

/**
 * Reduce a message to one line of plain text.
 *
 * A preview is rendered as text wherever a roster appears, so control characters have nothing to do
 * there: at best they are invisible, at worst a terminal escape somebody put in a message follows it
 * into a log. Newlines collapse to spaces because a preview is one line by definition.
 */
function previewOf(text: string) {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point.
  const flattened = text.replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ").trim();
  const collapsed = flattened.replace(/\s+/g, " ");
  const codePoints = Array.from(collapsed);
  if (codePoints.length <= MAX_ACTIVITY_CODE_POINTS) return collapsed;
  return `${codePoints.slice(0, MAX_ACTIVITY_CODE_POINTS - 1).join("")}…`;
}

function channelName(names: string[]) {
  const joined = names.join(", ");
  const codePoints = Array.from(joined);
  if (codePoints.length <= MAX_CHANNEL_NAME_CODE_POINTS) return joined;
  return `${codePoints.slice(0, MAX_CHANNEL_NAME_CODE_POINTS - 1).join("")}…`;
}

export function createChannelStore(
  database: Database,
  profileStore: AgentProfileStore,
  threadIdentity: ThreadIdentity,
): ChannelStore {
  return {
    create(actor, agentIds, options) {
      return database.transaction(
        async (transaction) => {
          // Validated on this transaction, not through `profileStore.get`: the read has to share
          // the connection this transaction already holds, and has to hold the profile so an agent
          // cannot be deleted between passing the check and being linked to the new channel.
          //
          // Locks are taken in agent-ID order. Two channels selecting the same pair of agents in
          // opposite orders would otherwise be able to deadlock against each other.
          const profilesById = new Map<string, AgentProfile>();
          for (const agentId of [...agentIds].sort()) {
            const profile = await profileStore.getWithin(
              transaction,
              actor,
              agentId,
            );
            if (!profile) throw new AgentNotFoundError(agentId);
            profilesById.set(agentId, profile);
          }

          const id = `channel_${crypto.randomUUID()}`;
          // Minted rather than a bare random id, so the thread says which deployment it belongs to
          // in a project that may hold more than one. See thread-identity.ts.
          const threadId = threadIdentity.mint(orgIdOf(actor));
          const requestedName = options?.name?.trim() ?? "";
          const name = requestedName
            ? channelName([requestedName])
            : channelName(
                agentIds.map((agentId) => {
                  const profile = profilesById.get(agentId);
                  if (!profile) throw new AgentNotFoundError(agentId);
                  return profile.name;
                }),
              );

          await transaction.insert(channels).values({
            id,
            orgId: orgIdOf(actor),
            name,
            description: PRIVATE_AGENT_CHANNEL_DESCRIPTION,
          });
          await transaction.insert(channelMemberships).values({
            orgId: orgIdOf(actor),
            channelId: id,
            userId: actor.id,
          });
          await transaction.insert(channelAgents).values(
            agentIds.map((agentId, position) => ({
              orgId: orgIdOf(actor),
              channelId: id,
              agentId,
              position,
            })),
          );
          await transaction.insert(intelligenceChannelMappings).values({
            orgId: orgIdOf(actor),
            userId: actor.id,
            channelId: id,
            threadId,
          });

          return { id, name, agentIds, threadId, active: true };
        },
        { isolationLevel: "read committed" },
      );
    },

    async get(actor, channelId) {
      const rows = await database
        .select({
          id: channels.id,
          name: channels.name,
          agentId: channelAgents.agentId,
          threadId: intelligenceChannelMappings.threadId,
          deletedAt: agentProfiles.deletedAt,
        })
        .from(channels)
        .innerJoin(
          channelMemberships,
          and(
            eq(channelMemberships.channelId, channels.id),
            eq(channelMemberships.userId, actor.id),
          ),
        )
        .innerJoin(
          intelligenceChannelMappings,
          and(
            eq(intelligenceChannelMappings.channelId, channels.id),
            eq(intelligenceChannelMappings.userId, actor.id),
          ),
        )
        .innerJoin(channelAgents, eq(channelAgents.channelId, channels.id))
        .innerJoin(
          agentProfiles,
          eq(agentProfiles.agentId, channelAgents.agentId),
        )
        .where(
          and(eq(channels.id, channelId), eq(channels.orgId, orgIdOf(actor))),
        )
        .orderBy(asc(channelAgents.position), asc(channelAgents.agentId));

      const first = rows[0];
      if (!first) return null;

      return {
        id: first.id,
        name: first.name,
        agentIds: rows.map((row) => row.agentId),
        threadId: first.threadId,
        active: rows.every((row) => row.deletedAt === null),
      };
    },

    async getByThread(actor, threadId) {
      const wanted = threadId.trim();
      if (!wanted) return null;
      const rows = await database
        .select({
          id: channels.id,
          name: channels.name,
          agentId: channelAgents.agentId,
          threadId: intelligenceChannelMappings.threadId,
          deletedAt: agentProfiles.deletedAt,
        })
        .from(channels)
        .innerJoin(
          channelMemberships,
          and(
            eq(channelMemberships.channelId, channels.id),
            eq(channelMemberships.userId, actor.id),
          ),
        )
        .innerJoin(
          intelligenceChannelMappings,
          and(
            eq(intelligenceChannelMappings.channelId, channels.id),
            eq(intelligenceChannelMappings.userId, actor.id),
            eq(intelligenceChannelMappings.threadId, wanted),
          ),
        )
        .innerJoin(channelAgents, eq(channelAgents.channelId, channels.id))
        .innerJoin(
          agentProfiles,
          eq(agentProfiles.agentId, channelAgents.agentId),
        )
        .where(eq(channels.orgId, orgIdOf(actor)))
        .orderBy(asc(channelAgents.position), asc(channelAgents.agentId));

      const first = rows[0];
      if (!first) return null;

      return {
        id: first.id,
        name: first.name,
        agentIds: rows.map((row) => row.agentId),
        threadId: first.threadId,
        active: rows.every((row) => row.deletedAt === null),
      };
    },

    async addAgents(actor, channelId, agentIds) {
      const unique = [
        ...new Set(
          agentIds.map((id) => id.trim()).filter((id) => id.length > 0),
        ),
      ];
      if (unique.length === 0) {
        const existing = await this.get(actor, channelId);
        if (!existing) throw new ChannelNotFoundError(channelId);
        return existing;
      }

      return database.transaction(
        async (transaction) => {
          const [membership] = await transaction
            .select({ channelId: channelMemberships.channelId })
            .from(channelMemberships)
            .where(
              and(
                eq(channelMemberships.channelId, channelId),
                eq(channelMemberships.userId, actor.id),
                eq(channelMemberships.orgId, orgIdOf(actor)),
              ),
            );
          if (!membership) throw new ChannelNotFoundError(channelId);

          const existing = await transaction
            .select({
              agentId: channelAgents.agentId,
              position: channelAgents.position,
            })
            .from(channelAgents)
            .where(eq(channelAgents.channelId, channelId))
            .orderBy(asc(channelAgents.position), asc(channelAgents.agentId));

          const present = new Set(existing.map((row) => row.agentId));
          const adding = unique.filter((id) => !present.has(id));
          if (existing.length + adding.length > MAX_CHANNEL_AGENTS) {
            throw new RoomFullError();
          }

          for (const agentId of [...adding].sort()) {
            const profile = await profileStore.getWithin(
              transaction,
              actor,
              agentId,
            );
            if (!profile) throw new AgentNotFoundError(agentId);
          }

          const nextPosition =
            existing.reduce((max, row) => Math.max(max, row.position), -1) + 1;
          if (adding.length > 0) {
            await transaction.insert(channelAgents).values(
              adding.map((agentId, index) => ({
                orgId: orgIdOf(actor),
                channelId,
                agentId,
                position: nextPosition + index,
              })),
            );
          }

          const rows = await transaction
            .select({
              id: channels.id,
              name: channels.name,
              agentId: channelAgents.agentId,
              threadId: intelligenceChannelMappings.threadId,
              deletedAt: agentProfiles.deletedAt,
            })
            .from(channels)
            .innerJoin(
              intelligenceChannelMappings,
              and(
                eq(intelligenceChannelMappings.channelId, channels.id),
                eq(intelligenceChannelMappings.userId, actor.id),
              ),
            )
            .innerJoin(channelAgents, eq(channelAgents.channelId, channels.id))
            .innerJoin(
              agentProfiles,
              eq(agentProfiles.agentId, channelAgents.agentId),
            )
            .where(
              and(
                eq(channels.id, channelId),
                eq(channels.orgId, orgIdOf(actor)),
              ),
            )
            .orderBy(asc(channelAgents.position), asc(channelAgents.agentId));
          const first = rows[0];
          if (!first) throw new ChannelNotFoundError(channelId);
          return {
            id: first.id,
            name: first.name,
            agentIds: rows.map((row) => row.agentId),
            threadId: first.threadId,
            active: rows.every((row) => row.deletedAt === null),
          };
        },
        { isolationLevel: "read committed" },
      );
    },

    async list(actor, query = {}) {
      const limit = Math.min(
        Math.max(query.limit ?? DEFAULT_CHANNEL_PAGE, 1),
        MAX_CHANNEL_PAGE,
      );
      const cursor = decodeChannelCursor(query.cursor);

      /*
       * The page of channels is chosen first, and the agents are joined to that page.
       *
       * The row set below is one row per channel-agent pair, so a limit on rows would cut a channel
       * in half: its second Bot would arrive on the next page as a separate entry with the same id.
       * Limiting the channels and then joining keeps a channel whole whatever it holds.
       */
      const page = await database
        .select({
          id: channels.id,
          recency: sql<Date>`coalesce(${channels.lastMessageAt}, ${channels.createdAt})`,
        })
        .from(channels)
        .innerJoin(
          channelMemberships,
          and(
            eq(channelMemberships.channelId, channels.id),
            eq(channelMemberships.userId, actor.id),
          ),
        )
        .where(
          and(
            eq(channels.orgId, orgIdOf(actor)),
            cursor
              ? sql`(coalesce(${channels.lastMessageAt}, ${channels.createdAt}), ${channels.id}) < (${cursor.recency}::timestamptz, ${cursor.id})`
              : undefined,
          ),
        )
        .orderBy(
          sql`coalesce(${channels.lastMessageAt}, ${channels.createdAt}) desc`,
          desc(channels.id),
        )
        // One more than asked for, so "is there another page" needs no second count query.
        .limit(limit + 1);

      const wanted = page.slice(0, limit);
      const last = wanted.at(-1);
      const nextCursor =
        page.length > limit && last
          ? encodeChannelCursor({
              recency: new Date(last.recency).toISOString(),
              id: last.id,
            })
          : null;

      if (wanted.length === 0) return { channels: [], nextCursor: null };

      const rows = await database
        .select({
          id: channels.id,
          name: channels.name,
          agentId: channelAgents.agentId,
          threadId: intelligenceChannelMappings.threadId,
          deletedAt: agentProfiles.deletedAt,
          lastMessage: channels.lastMessage,
          lastMessageAt: channels.lastMessageAt,
          lastMessageAgentId: channels.lastMessageAgentId,
          createdAt: channels.createdAt,
        })
        .from(channels)
        .innerJoin(
          channelMemberships,
          and(
            eq(channelMemberships.channelId, channels.id),
            eq(channelMemberships.userId, actor.id),
          ),
        )
        .innerJoin(
          intelligenceChannelMappings,
          and(
            eq(intelligenceChannelMappings.channelId, channels.id),
            eq(intelligenceChannelMappings.userId, actor.id),
          ),
        )
        .innerJoin(channelAgents, eq(channelAgents.channelId, channels.id))
        .innerJoin(
          agentProfiles,
          eq(agentProfiles.agentId, channelAgents.agentId),
        )
        // Most recent first, where starting a conversation counts as activity. A channel somebody
        // just created has nothing said in it yet, and is also the one they are about to type in, // ordering on the message alone would bury it under every channel that has one.
        //
        // The browser repeats this when the socket patches a row. Both must agree, or the list
        // reorders itself on the next event; see `byRecency` in use-channel-events.ts.
        .where(
          inArray(
            channels.id,
            wanted.map((row) => row.id),
          ),
        )
        .orderBy(
          sql`coalesce(${channels.lastMessageAt}, ${channels.createdAt}) desc`,
          desc(channels.id),
          asc(channelAgents.position),
          asc(channelAgents.agentId),
        );

      // One row per channel-agent pair; the ordering above keeps each channel's rows together and
      // its agents in the same To: order `get` returns.
      const summaries = new Map<string, ChannelSummary>();
      for (const row of rows) {
        const summary = summaries.get(row.id);
        if (summary) {
          summary.agentIds.push(row.agentId);
          summary.active &&= row.deletedAt === null;
          continue;
        }
        summaries.set(row.id, {
          id: row.id,
          name: row.name,
          agentIds: [row.agentId],
          threadId: row.threadId,
          active: row.deletedAt === null,
          lastMessage: row.lastMessage,
          lastMessageAt: row.lastMessageAt,
          lastMessageAgentId: row.lastMessageAgentId,
          createdAt: row.createdAt,
          goalStatus: "Active",
          lastAction: row.lastMessage,
          lastActionAt: row.lastMessageAt,
        });
      }

      const listed = [...summaries.values()];
      if (listed.length > 0) {
        const latestJobs = await database
          .select({
            channelId: jobs.channelId,
            outcome: jobs.outcome,
            needsYou: jobs.needsYou,
            status: jobs.status,
            updatedAt: jobs.updatedAt,
          })
          .from(jobs)
          .where(
            and(
              eq(jobs.orgId, orgIdOf(actor)),
              inArray(
                jobs.channelId,
                listed.map((channel) => channel.id),
              ),
            ),
          )
          .orderBy(desc(jobs.updatedAt));
        const byChannel = new Map<string, (typeof latestJobs)[number]>();
        for (const job of latestJobs) {
          if (!byChannel.has(job.channelId)) {
            byChannel.set(job.channelId, job);
          }
        }
        for (const summary of listed) {
          const job = byChannel.get(summary.id);
          if (!job) continue;
          const outcome = asJobOutcome(job.outcome);
          if (job.needsYou) {
            summary.goalStatus = "Needs you";
          } else if (outcome) {
            summary.goalStatus = outcome.status;
          } else if (job.status === "queued" || job.status === "running") {
            summary.goalStatus = "Active";
          } else if (job.status === "succeeded") {
            summary.goalStatus = "Done";
          } else {
            summary.goalStatus = "Needs you";
          }
          summary.lastAction = outcome?.last_action ?? summary.lastMessage;
          summary.lastActionAt = outcome?.last_action_at
            ? new Date(outcome.last_action_at)
            : (summary.lastMessageAt ?? job.updatedAt);
        }
      }

      return { channels: listed, nextCursor };
    },

    recordActivity(actor, channelId, activity) {
      return database.transaction(
        async (transaction) => {
          const [membership] = await transaction
            .select({ channelId: channelMemberships.channelId })
            .from(channelMemberships)
            .where(
              and(
                eq(channelMemberships.channelId, channelId),
                eq(channelMemberships.userId, actor.id),
                eq(channelMemberships.orgId, orgIdOf(actor)),
              ),
            );
          // Not a member, or no such channel: the same answer either way, so belonging to a channel
          // is not something an outsider can probe for.
          if (!membership) throw new ChannelNotFoundError(channelId);

          if (activity.agentId !== null) {
            const [linked] = await transaction
              .select({ agentId: channelAgents.agentId })
              .from(channelAgents)
              .where(
                and(
                  eq(channelAgents.channelId, channelId),
                  eq(channelAgents.agentId, activity.agentId),
                ),
              );
            if (!linked) throw new AgentNotFoundError(activity.agentId);
          }

          // A person's message and the agent's reply are reported separately, so they can arrive out
          // of order. Only ever move forwards.
          const lastMessage = previewOf(activity.text);
          const applied = await transaction
            .update(channels)
            .set({
              lastMessage,
              lastMessageAt: activity.at,
              lastMessageAgentId: activity.agentId,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(channels.id, channelId),
                or(
                  isNull(channels.lastMessageAt),
                  lt(channels.lastMessageAt, activity.at),
                ),
              ),
            )
            .returning({ id: channels.id });
          // Nothing changed, so there is nothing to announce: a stale report is not news.
          if (applied.length === 0) return;

          const members = await transaction
            .select({ userId: channelMemberships.userId })
            .from(channelMemberships)
            .where(eq(channelMemberships.channelId, channelId));

          // Announced inside the transaction, so it is delivered on commit and a write that rolls
          // back is never announced. The payload carries the members because the writer has already
          // resolved them; NOTIFY caps at 8000 bytes, which a 200-character preview leaves room in.
          const event: ChannelActivityEvent = {
            channelId,
            memberIds: members.map((member) => member.userId),
            lastMessage,
            lastMessageAt: activity.at.toISOString(),
            lastMessageAgentId: activity.agentId,
          };
          await transaction.execute(
            sql`select pg_notify(${CHANNEL_ACTIVITY_TOPIC}, ${JSON.stringify(event)})`,
          );
        },
        { isolationLevel: "read committed" },
      );
    },
  };
}

export class ChannelNotFoundError extends Error {
  constructor(id: string) {
    super(`Channel ${id} was not found.`);
    this.name = "ChannelNotFoundError";
  }
}

export class RoomFullError extends Error {
  constructor() {
    super("A goal room can have at most 8 coworkers.");
    this.name = "RoomFullError";
  }
}

type ChannelInputParseResult =
  | { ok: true; value: { agentIds: string[]; name?: string } }
  | { ok: false; error: string };

type ChannelInputObject = { agentIds?: unknown; name?: unknown };

export function parseChannelInput(input: unknown): ChannelInputParseResult {
  if (!isChannelInputObject(input)) {
    return { ok: false, error: "Channel input must be a JSON object." };
  }

  if (!Array.isArray(input.agentIds) || input.agentIds.length === 0) {
    return { ok: false, error: "Agent IDs must be a non-empty array." };
  }

  const agentIds: string[] = [];
  for (const agentId of input.agentIds) {
    if (typeof agentId !== "string" || agentId.trim().length === 0) {
      return { ok: false, error: "Agent IDs must be non-empty strings." };
    }
    agentIds.push(agentId.trim());
  }

  if (new Set(agentIds).size !== agentIds.length) {
    return { ok: false, error: "Agent IDs must be unique." };
  }

  if (agentIds.length > MAX_CHANNEL_AGENTS) {
    return {
      ok: false,
      error: "A channel can have at most 8 coworkers.",
    };
  }

  // Request order is To: order. Sorting would make the lead alphabetical.
  let name: string | undefined;
  if (typeof input.name === "string") {
    const trimmed = input.name.trim();
    if (trimmed) {
      const codePoints = Array.from(trimmed);
      name =
        codePoints.length <= MAX_CHANNEL_NAME_CODE_POINTS
          ? trimmed
          : `${codePoints.slice(0, MAX_CHANNEL_NAME_CODE_POINTS - 1).join("")}…`;
    }
  }
  return {
    ok: true,
    value: { agentIds, ...(name ? { name } : {}) },
  };
}

function isChannelInputObject(input: unknown): input is ChannelInputObject {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

type ActivityInputParseResult =
  | { ok: true; value: ChannelActivity }
  | { ok: false; error: string };

/**
 * Parse a reported message.
 *
 * `at` comes from the client that saw the message, because only it knows when the message arrived, * but it is never trusted as a clock: the store compares it against what is stored and only ever
 * moves forwards, so a wrong one can lose a report, not corrupt the row.
 */
export function parseActivityInput(input: unknown): ActivityInputParseResult {
  if (!isChannelInputObject(input)) {
    return { ok: false, error: "Activity must be a JSON object." };
  }
  const object = input as { text?: unknown; agentId?: unknown; at?: unknown };

  if (typeof object.text !== "string" || object.text.trim().length === 0) {
    return { ok: false, error: "Text is required." };
  }
  if (object.agentId !== null && typeof object.agentId !== "string") {
    return { ok: false, error: "Agent ID must be a string or null." };
  }
  if (typeof object.at !== "string") {
    return { ok: false, error: "Timestamp is required." };
  }
  const at = new Date(object.at);
  if (Number.isNaN(at.getTime())) {
    return { ok: false, error: "Timestamp must be an ISO-8601 date." };
  }

  return {
    ok: true,
    value: {
      agentId:
        typeof object.agentId === "string" ? object.agentId.trim() : null,
      at,
      text: object.text,
    },
  };
}

export function createChannelRoutes(
  store: ChannelStore,
  requireUser: MiddlewareHandler<{ Variables: AppVariables }>,
  /** Absent in tests and wherever live updates are not wanted; the routes still work without it. */
  events?: ChannelEventHub,
) {
  const routes = new Hono<{ Variables: AppVariables }>();

  // Before `/:channelId`, or "events" is read as a channel id.
  if (events) {
    routes.get(
      "/events",
      requireUser,
      upgradeWebSocket((context) => {
        // Resolved at upgrade, not per message: the connection belongs to whoever authenticated it,
        // and nothing it later sends can change that.
        const { id: userId } = context.var.actor;
        let detach = () => {};
        return {
          onOpen: (_event, ws) => {
            detach = events.register(userId, (payload) => ws.send(payload));
          },
          onClose: () => detach(),
          onError: () => detach(),
        };
      }),
    );
  }

  routes.post("/", requireUser, async (context) => {
    const parsed = parseChannelInput(
      await context.req.json().catch(() => null),
    );
    if (!parsed.ok) return context.json({ error: parsed.error }, 400);

    try {
      const channel = await store.create(
        context.var.actor,
        parsed.value.agentIds,
        parsed.value.name ? { name: parsed.value.name } : undefined,
      );
      return context.json({ channel: channelDto(channel) }, 201);
    } catch (error) {
      return mapStoreError(context, error);
    }
  });

  routes.get("/", requireUser, async (context) => {
    try {
      const url = new URL(context.req.url);
      const limit = Number.parseInt(url.searchParams.get("limit") ?? "", 10);
      const page = await store.list(context.var.actor, {
        ...(url.searchParams.get("cursor")
          ? { cursor: url.searchParams.get("cursor") as string }
          : {}),
        ...(Number.isFinite(limit) ? { limit } : {}),
      });

      return context.json({
        channels: page.channels.map(channelSummaryDto),
        nextCursor: page.nextCursor,
      });
    } catch (error) {
      return mapStoreError(context, error);
    }
  });

  routes.post("/:channelId/activity", requireUser, async (context) => {
    const parsed = parseActivityInput(
      await context.req.json().catch(() => null),
    );
    if (!parsed.ok) return context.json({ error: parsed.error }, 400);

    try {
      await store.recordActivity(
        context.var.actor,
        context.req.param("channelId"),
        parsed.value,
      );
      return context.body(null, 204);
    } catch (error) {
      return mapStoreError(context, error);
    }
  });

  routes.get("/:channelId", requireUser, async (context) => {
    try {
      const channel = await store.get(
        context.var.actor,
        context.req.param("channelId"),
      );
      if (!channel) {
        return context.json({ error: "Channel not found." }, 404);
      }
      return context.json({ channel: channelDto(channel) });
    } catch (error) {
      return mapStoreError(context, error);
    }
  });

  return routes;
}

function channelDto(channel: AgentChannel): AgentChannel {
  return {
    id: channel.id,
    name: channel.name,
    agentIds: channel.agentIds,
    threadId: channel.threadId,
    active: channel.active,
  };
}

function channelSummaryDto(channel: ChannelSummary) {
  return {
    ...channelDto(channel),
    lastMessage: channel.lastMessage,
    // Serialised as ISO-8601 so the browser gets a string it can sort and format.
    lastMessageAt: channel.lastMessageAt?.toISOString() ?? null,
    lastMessageAgentId: channel.lastMessageAgentId,
    createdAt: channel.createdAt.toISOString(),
    goalStatus: channel.goalStatus,
    lastAction: channel.lastAction,
    lastActionAt: channel.lastActionAt?.toISOString() ?? null,
  };
}

function mapStoreError(context: Context, error: unknown): Response {
  if (error instanceof AgentNotFoundError) {
    return context.json({ error: "Agent not found." }, 404);
  }
  if (error instanceof ChannelNotFoundError) {
    return context.json({ error: "Channel not found." }, 404);
  }
  if (error instanceof RoomFullError) {
    return context.json({ error: error.message }, 409);
  }
  throw error;
}
