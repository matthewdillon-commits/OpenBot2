import { and, eq } from "drizzle-orm";
import type { Database } from "../db/client";
import { channels } from "../db/schema";
import { orgIdOf } from "../orgs/constants";
import { asGoalLoop } from "./parse";
import { emptyGoalLoop, type GoalLoop } from "./types";

export type GoalLoopStore = {
  get: (orgId: string, goalId: string) => Promise<GoalLoop>;
  save: (orgId: string, goalId: string, loop: GoalLoop) => Promise<void>;
};

function loopKey(orgId: string, goalId: string) {
  return `${orgId}:${goalId}`;
}

/** Tests that do not open Postgres. Production uses the channel row. */
export function createMemoryGoalLoopStore(
  seed: Iterable<[string, string, GoalLoop]> = [],
): GoalLoopStore {
  const loops = new Map<string, GoalLoop>();
  for (const [orgId, goalId, loop] of seed) {
    loops.set(loopKey(orgId, goalId), loop);
  }
  return {
    async get(orgId, goalId) {
      return loops.get(loopKey(orgId, goalId)) ?? emptyGoalLoop();
    },
    async save(orgId, goalId, loop) {
      loops.set(loopKey(orgId, goalId), loop);
    },
  };
}

/**
 * Persist the loop on the existing channel. Isolation is `org_id`, the same
 * way CRM is. A second replica reads the same jsonb.
 */
export function createGoalLoopStore(database: Database): GoalLoopStore {
  return {
    async get(orgId, goalId) {
      const [row] = await database
        .select({ loop: channels.loop })
        .from(channels)
        .where(
          and(eq(channels.id, goalId), eq(channels.orgId, orgIdOf({ orgId }))),
        )
        .limit(1);
      return asGoalLoop(row?.loop);
    },
    async save(orgId, goalId, loop) {
      await database
        .update(channels)
        .set({
          loop: loop as unknown as Record<string, unknown>,
          updatedAt: new Date(),
        })
        .where(
          and(eq(channels.id, goalId), eq(channels.orgId, orgIdOf({ orgId }))),
        );
    },
  };
}
