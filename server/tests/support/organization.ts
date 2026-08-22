import type { Database } from "../../src/db/client";
import { organizationMemberships, organizations } from "../../src/db/schema";
import {
  LOCAL_ORGANIZATION_ID,
  LOCAL_ORGANIZATION_NAME,
  LOCAL_ORGANIZATION_SLUG,
  type OrganizationRole,
} from "../../src/orgs/constants";
import { createOrganizationStore } from "../../src/orgs/store";

export async function ensureLocalOrganization(database: Database) {
  const store = createOrganizationStore(database);
  return store.ensureLocal({
    name: LOCAL_ORGANIZATION_NAME,
    slug: LOCAL_ORGANIZATION_SLUG,
  });
}

export async function seedMembership(
  database: Database,
  userId: string,
  role: OrganizationRole = "member",
  orgId = LOCAL_ORGANIZATION_ID,
) {
  await ensureLocalOrganization(database);
  await database
    .insert(organizationMemberships)
    .values({ orgId, userId, role })
    .onConflictDoUpdate({
      target: [organizationMemberships.orgId, organizationMemberships.userId],
      set: { role },
    });
}

export async function createTestOrganization(
  database: Database,
  input: { id: string; slug: string; name: string },
) {
  await database
    .insert(organizations)
    .values({
      id: input.id,
      slug: input.slug,
      name: input.name,
      status: "active",
      plan: "enterprise",
    })
    .onConflictDoNothing();
  return input;
}
