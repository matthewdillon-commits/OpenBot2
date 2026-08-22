import { eq } from "drizzle-orm";
import type { Database } from "../db/client";
import { organizationMemberships } from "../db/schema";
import { LOCAL_ORGANIZATION_ID } from "./constants";
import type { OrganizationStore } from "./store";

/**
 * Make sure the backfilled org exists.
 *
 * A single-user laptop is its owner. Everybody else who already had a row when
 * organizations landed was backfilled by the migration. New people on a
 * one-org appliance join that org on first request (`joinIfSoleOrganization`).
 * A deployment that already has a second org is sales-led: nobody is added to
 * `local` just because they signed in.
 */
export async function bootstrapOrganizations(
  _database: Database,
  organizations: OrganizationStore,
  input: {
    singleUser: boolean;
    devUserId?: string;
    name?: string;
    slug?: string;
  },
) {
  const org = await organizations.ensureLocal({
    name: input.name,
    slug: input.slug,
  });

  if (input.singleUser && input.devUserId) {
    await organizations.ensureMembership({
      orgId: org.id,
      userId: input.devUserId,
      role: "owner",
    });
  }

  return org;
}

export async function localMembershipCount(database: Database) {
  const rows = await database
    .select({ userId: organizationMemberships.userId })
    .from(organizationMemberships)
    .where(eq(organizationMemberships.orgId, LOCAL_ORGANIZATION_ID));
  return rows.length;
}
