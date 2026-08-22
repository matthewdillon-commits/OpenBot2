import { eq } from "drizzle-orm";
import type { Database } from "../db/client";
import { organizationMemberships, userRoles, users } from "../db/schema";
import {
  LOCAL_ORGANIZATION_ID,
  type OrganizationRole,
} from "./constants";
import type { OrganizationStore } from "./store";

/**
 * Make sure the backfilled org exists, and that everybody already in the database
 * belongs to it.
 *
 * A single-user laptop is the owner. Everybody else keeps the role `user_roles`
 * already gave them: admin becomes owner, user becomes member.
 */
export async function bootstrapOrganizations(
  database: Database,
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

  const people = await database
    .select({
      id: users.id,
      role: userRoles.role,
    })
    .from(users)
    .leftJoin(userRoles, eq(userRoles.userId, users.id));

  const roleByUser = new Map<string, OrganizationRole>();
  for (const person of people) {
    const next: OrganizationRole =
      input.singleUser && person.id === input.devUserId
        ? "owner"
        : person.role === "admin"
          ? "owner"
          : "member";
    const already = roleByUser.get(person.id);
    if (already === "owner") continue;
    roleByUser.set(person.id, next);
  }

  for (const [userId, role] of roleByUser) {
    await organizations.ensureMembership({
      orgId: org.id,
      userId,
      role,
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
