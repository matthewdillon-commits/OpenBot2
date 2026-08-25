/**
 * First organization to use a shared Chromium claims it.
 *
 * One Chromium for the whole image is acceptable for one trusted team. It is
 * not a boundary between customers. The claim lives in Postgres so two replicas
 * cannot each let a different org through.
 */
import { eq } from "drizzle-orm";
import type { Database } from "../db/client";
import {
  SHARED_COMPUTER_CLAIM_ID,
  sharedComputerClaim,
} from "../db/schema/computer";
import { orgIdOf } from "../orgs/constants";

export const SHARED_COMPUTER_SECOND_ORG =
  "A second organization cannot share this computer. Set COMPUTER_SUPERVISOR_URL so computers are made one per org×bot.";

export class SharedComputerIsolationError extends Error {
  constructor(message = SHARED_COMPUTER_SECOND_ORG) {
    super(message);
    this.name = "SharedComputerIsolationError";
  }
}

export type SharedComputerClaim = {
  /**
   * Record this org as the owner if nobody has claimed yet.
   * Refuse when another org already owns the shared computer.
   */
  ensure(
    orgId: string,
  ): Promise<{ allowed: true } | { allowed: false; ownerOrgId: string }>;
};

export function createInMemorySharedComputerClaim(): SharedComputerClaim {
  let owner: string | undefined;
  return {
    async ensure(orgId) {
      const scoped = orgIdOf({ orgId });
      if (!owner) owner = scoped;
      return owner === scoped
        ? { allowed: true }
        : { allowed: false, ownerOrgId: owner };
    },
  };
}

export function createSharedComputerClaimStore(
  database: Database,
): SharedComputerClaim {
  return {
    async ensure(orgId) {
      const scoped = orgIdOf({ orgId });
      await database
        .insert(sharedComputerClaim)
        .values({
          id: SHARED_COMPUTER_CLAIM_ID,
          orgId: scoped,
        })
        .onConflictDoNothing();
      const [row] = await database
        .select()
        .from(sharedComputerClaim)
        .where(eq(sharedComputerClaim.id, SHARED_COMPUTER_CLAIM_ID));
      if (!row) return { allowed: true };
      return row.orgId === scoped
        ? { allowed: true }
        : { allowed: false, ownerOrgId: row.orgId };
    },
  };
}
