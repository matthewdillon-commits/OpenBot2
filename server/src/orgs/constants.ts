/**
 * The organization every existing row is backfilled into, and the one a single-user
 * laptop deployment keeps using.
 *
 * Fixed id so a migration, a test and a boot seed all name the same row. Slug `local` is what
 * `/o/local` shows in development.
 */
export const LOCAL_ORGANIZATION_ID = "org_local";
export const LOCAL_ORGANIZATION_SLUG = "local";
export const LOCAL_ORGANIZATION_NAME = "Local";

export const ORGANIZATION_ROLES = ["owner", "admin", "member"] as const;
export type OrganizationRole = (typeof ORGANIZATION_ROLES)[number];

export const ORGANIZATION_STATUSES = ["active", "suspended"] as const;
export type OrganizationStatus = (typeof ORGANIZATION_STATUSES)[number];

/** Owner and admin are the people who may change this org. Mapped to the existing `admin` role. */
export function openBotRoleFor(orgRole: OrganizationRole): "admin" | "user" {
  return orgRole === "member" ? "user" : "admin";
}

export function isOrgAdmin(orgRole: OrganizationRole | undefined): boolean {
  return orgRole === "owner" || orgRole === "admin";
}

/**
 * Which org a query should run against.
 *
 * Tests and older callers that never heard of orgs land in the backfilled one. An empty string is
 * treated as missing so an anonymous actor does not invent a fourth state.
 */
export function orgIdOf(actor: { orgId?: string | null }): string {
  const orgId = actor.orgId?.trim();
  return orgId ? orgId : LOCAL_ORGANIZATION_ID;
}

export function intelligenceUserId(orgId: string, userId: string): string {
  return `${orgId}:${userId}`;
}

/**
 * The computer the supervisor and snapshot table name this Bot by.
 *
 * The backfilled local org keeps the bare agent id so existing snapshots and the
 * laptop's one browser still resolve. Every other org is namespaced so two
 * companies cannot share a Chromium or a cookie jar.
 */
export function computerIdFor(orgId: string, agentId: string): string {
  return orgId === LOCAL_ORGANIZATION_ID ? agentId : `${orgId}__${agentId}`;
}

/**
 * A globally unique row id for a tenant resource that still has a global PK.
 *
 * Local keeps the human id (`github`, `standup`) so existing rows and tests
 * stay put. Other orgs prefix, so two companies can add the same catalogue
 * server or skill slug without colliding.
 */
export function scopedResourceId(orgId: string, localId: string): string {
  return orgId === LOCAL_ORGANIZATION_ID ? localId : `${orgId}__${localId}`;
}

export function unscopedResourceId(orgId: string, storedId: string): string {
  const prefix = `${orgId}__`;
  return storedId.startsWith(prefix) ? storedId.slice(prefix.length) : storedId;
}

export function orgIdFromComputerId(computerId: string): string {
  const separator = computerId.indexOf("__");
  if (separator <= 0) return LOCAL_ORGANIZATION_ID;
  return computerId.slice(0, separator);
}

export function slugifyOrganizationName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "org";
}
