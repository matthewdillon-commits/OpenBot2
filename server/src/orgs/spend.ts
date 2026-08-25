/**
 * Org spend caps. Crossing the cap refuses new unattended / model / computer
 * work out loud — it does not silently continue.
 *
 * The ledger is `organization_spend_events` in Postgres. Replica B sums the
 * same rows; a second replica never consults an in-process counter.
 */
import { eq, sql } from "drizzle-orm";
import type { Database } from "../db/client";
import { organizationSpendEvents, organizations } from "../db/schema";

export const SPEND_KINDS = ["unattended", "model", "computer"] as const;
export type SpendKind = (typeof SPEND_KINDS)[number];

/** Default cents recorded for one unit of each kind. */
export const SPEND_CENTS: Record<SpendKind, number> = {
  unattended: 100,
  model: 10,
  computer: 50,
};

export const SPEND_CAP_REFUSAL =
  "This organization has reached its spend cap. New unattended, model, or computer work is refused until the cap is raised.";

export class SpendCapError extends Error {
  readonly kind: SpendKind;
  constructor(kind: SpendKind, message = SPEND_CAP_REFUSAL) {
    super(message);
    this.name = "SpendCapError";
    this.kind = kind;
  }
}

export type SpendUsage = {
  capCents: number | null;
  usedCents: number;
};

export type SpendStore = {
  usage: (orgId: string) => Promise<SpendUsage>;
  /**
   * Record one unit of spend, or refuse if it would cross the cap.
   * Serialised with `FOR UPDATE` on the org row so two replicas cannot both
   * squeeze under the cap.
   */
  consume: (input: {
    orgId: string;
    kind: SpendKind;
    cents?: number;
    jobId?: string;
  }) => Promise<SpendUsage>;
};

export function createSpendStore(database: Database): SpendStore {
  async function usage(orgId: string): Promise<SpendUsage> {
    const [org] = await database
      .select({ spendCapCents: organizations.spendCapCents })
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1);
    const [sum] = await database
      .select({
        used: sql<number>`coalesce(sum(${organizationSpendEvents.cents}), 0)`,
      })
      .from(organizationSpendEvents)
      .where(eq(organizationSpendEvents.orgId, orgId));
    return {
      capCents: org?.spendCapCents ?? null,
      usedCents: Number(sum?.used ?? 0),
    };
  }

  return {
    usage,

    async consume(input) {
      const cents = input.cents ?? SPEND_CENTS[input.kind];
      return database.transaction(async (tx) => {
        const [org] = await tx
          .select({ spendCapCents: organizations.spendCapCents })
          .from(organizations)
          .where(eq(organizations.id, input.orgId))
          .for("update")
          .limit(1);
        const [sum] = await tx
          .select({
            used: sql<number>`coalesce(sum(${organizationSpendEvents.cents}), 0)`,
          })
          .from(organizationSpendEvents)
          .where(eq(organizationSpendEvents.orgId, input.orgId));
        const usedCents = Number(sum?.used ?? 0);
        const capCents = org?.spendCapCents ?? null;
        if (capCents !== null && usedCents + cents > capCents) {
          throw new SpendCapError(input.kind);
        }
        await tx.insert(organizationSpendEvents).values({
          orgId: input.orgId,
          kind: input.kind,
          cents,
          ...(input.jobId ? { jobId: input.jobId } : {}),
        });
        return { capCents, usedCents: usedCents + cents };
      });
    },
  };
}

export async function assertSpend(
  spend: SpendStore | undefined,
  orgId: string,
  kind: SpendKind,
): Promise<void> {
  if (!spend) return;
  await spend.consume({ orgId, kind });
}
