import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import type { Database } from "../db/client";
import {
  organizationInvites,
  organizationMemberships,
  organizationSettings,
  organizations,
  userPreferences,
  users,
} from "../db/schema";
import {
  LOCAL_ORGANIZATION_ID,
  LOCAL_ORGANIZATION_NAME,
  LOCAL_ORGANIZATION_SLUG,
  type OrganizationRole,
  type OrganizationStatus,
  openBotRoleFor,
  slugifyOrganizationName,
} from "./constants";

export type OrganizationRecord = {
  id: string;
  slug: string;
  name: string;
  status: OrganizationStatus;
  plan: string;
};

export type MembershipRecord = OrganizationRecord & {
  role: OrganizationRole;
};

export type OrganizationInviteRecord = {
  id: string;
  orgId: string;
  orgName: string;
  orgSlug: string;
  email: string;
  role: OrganizationRole;
  expiresAt: Date;
};

function newOrganizationId() {
  return `org_${crypto.randomUUID()}`;
}

function hashInviteToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function mintInviteToken() {
  return randomBytes(24).toString("base64url");
}

export type OrganizationStore = {
  get: (orgId: string) => Promise<OrganizationRecord | null>;
  getBySlug: (slug: string) => Promise<OrganizationRecord | null>;
  listForUser: (userId: string) => Promise<MembershipRecord[]>;
  membership: (
    userId: string,
    orgId: string,
  ) => Promise<MembershipRecord | null>;
  resolveActive: (userId: string) => Promise<MembershipRecord | null>;
  setActive: (userId: string, orgId: string) => Promise<MembershipRecord>;
  ensureLocal: (input?: {
    name?: string;
    slug?: string;
  }) => Promise<OrganizationRecord>;
  ensureMembership: (input: {
    orgId: string;
    userId: string;
    role: OrganizationRole;
  }) => Promise<void>;
  create: (input: {
    name: string;
    slug?: string;
    plan?: string;
  }) => Promise<OrganizationRecord>;
  setStatus: (
    orgId: string,
    status: OrganizationStatus,
  ) => Promise<OrganizationRecord>;
  listAll: () => Promise<OrganizationRecord[]>;
  invite: (input: {
    orgId: string;
    email: string;
    role: OrganizationRole;
    invitedBy: string;
  }) => Promise<{ invite: OrganizationInviteRecord; token: string }>;
  acceptInvite: (
    token: string,
    user: { id: string; email: string },
  ) => Promise<MembershipRecord>;
  settings: (orgId: string) => Promise<{
    displayName: string | null;
    logoUrl: string | null;
    defaultModel: string | null;
    featureFlags: Record<string, unknown>;
  }>;
};

function mapOrg(row: {
  id: string;
  slug: string;
  name: string;
  status: OrganizationStatus;
  plan: string;
}): OrganizationRecord {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    status: row.status,
    plan: row.plan,
  };
}

export function createOrganizationStore(database: Database): OrganizationStore {
  async function get(orgId: string) {
    const [row] = await database
      .select()
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1);
    return row ? mapOrg(row) : null;
  }

  async function membership(
    userId: string,
    orgId: string,
  ): Promise<MembershipRecord | null> {
    const [row] = await database
      .select({
        id: organizations.id,
        slug: organizations.slug,
        name: organizations.name,
        status: organizations.status,
        plan: organizations.plan,
        role: organizationMemberships.role,
      })
      .from(organizationMemberships)
      .innerJoin(
        organizations,
        eq(organizations.id, organizationMemberships.orgId),
      )
      .where(
        and(
          eq(organizationMemberships.userId, userId),
          eq(organizationMemberships.orgId, orgId),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  return {
    get,

    async getBySlug(slug) {
      const [row] = await database
        .select()
        .from(organizations)
        .where(eq(organizations.slug, slug))
        .limit(1);
      return row ? mapOrg(row) : null;
    },

    async listForUser(userId) {
      return database
        .select({
          id: organizations.id,
          slug: organizations.slug,
          name: organizations.name,
          status: organizations.status,
          plan: organizations.plan,
          role: organizationMemberships.role,
        })
        .from(organizationMemberships)
        .innerJoin(
          organizations,
          eq(organizations.id, organizationMemberships.orgId),
        )
        .where(eq(organizationMemberships.userId, userId));
    },

    membership,

    async resolveActive(userId) {
      const [preference] = await database
        .select({ activeOrgId: userPreferences.activeOrgId })
        .from(userPreferences)
        .where(eq(userPreferences.userId, userId))
        .limit(1);
      if (preference?.activeOrgId) {
        const active = await membership(userId, preference.activeOrgId);
        if (active && active.status === "active") return active;
      }
      const memberships = await database
        .select({
          id: organizations.id,
          slug: organizations.slug,
          name: organizations.name,
          status: organizations.status,
          plan: organizations.plan,
          role: organizationMemberships.role,
        })
        .from(organizationMemberships)
        .innerJoin(
          organizations,
          eq(organizations.id, organizationMemberships.orgId),
        )
        .where(
          and(
            eq(organizationMemberships.userId, userId),
            eq(organizations.status, "active"),
          ),
        );
      return memberships[0] ?? null;
    },

    async setActive(userId, orgId) {
      const next = await membership(userId, orgId);
      if (!next) {
        throw new OrganizationAccessError(orgId);
      }
      if (next.status === "suspended") {
        throw new OrganizationSuspendedError(orgId);
      }
      await database
        .insert(userPreferences)
        .values({ userId, activeOrgId: orgId, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: userPreferences.userId,
          set: { activeOrgId: orgId, updatedAt: new Date() },
        });
      return next;
    },

    async ensureLocal(input = {}) {
      const [row] = await database
        .insert(organizations)
        .values({
          id: LOCAL_ORGANIZATION_ID,
          slug: input.slug ?? LOCAL_ORGANIZATION_SLUG,
          name: input.name ?? LOCAL_ORGANIZATION_NAME,
          status: "active",
          plan: "enterprise",
        })
        .onConflictDoUpdate({
          target: organizations.id,
          set: {
            name: input.name ?? LOCAL_ORGANIZATION_NAME,
            updatedAt: new Date(),
          },
        })
        .returning();
      if (!row) throw new Error("The local organization could not be created.");
      await database
        .insert(organizationSettings)
        .values({ orgId: row.id, featureFlags: {} })
        .onConflictDoNothing();
      return mapOrg(row);
    },

    async ensureMembership({ orgId, userId, role }) {
      await database
        .insert(organizationMemberships)
        .values({ orgId, userId, role })
        .onConflictDoUpdate({
          target: [
            organizationMemberships.orgId,
            organizationMemberships.userId,
          ],
          set: { role },
        });
    },

    async create(input) {
      const id = newOrganizationId();
      const base = slugifyOrganizationName(input.slug ?? input.name);
      let slug = base;
      for (let attempt = 0; attempt < 8; attempt += 1) {
        try {
          const [row] = await database
            .insert(organizations)
            .values({
              id,
              slug,
              name: input.name.trim(),
              status: "active",
              plan: input.plan ?? "enterprise",
            })
            .returning();
          if (!row) throw new Error("The organization could not be created.");
          await database
            .insert(organizationSettings)
            .values({ orgId: row.id, displayName: row.name, featureFlags: {} });
          return mapOrg(row);
        } catch (error) {
          if (
            error instanceof Error &&
            /organization_slug|organizations_slug/i.test(error.message)
          ) {
            slug = `${base}-${attempt + 2}`;
            continue;
          }
          throw error;
        }
      }
      throw new Error("Could not allocate an organization slug.");
    },

    async setStatus(orgId, status) {
      const [row] = await database
        .update(organizations)
        .set({ status, updatedAt: new Date() })
        .where(eq(organizations.id, orgId))
        .returning();
      if (!row) throw new OrganizationNotFoundError(orgId);
      return mapOrg(row);
    },

    async listAll() {
      const rows = await database.select().from(organizations);
      return rows.map(mapOrg);
    },

    async invite(input) {
      const org = await get(input.orgId);
      if (!org) throw new OrganizationNotFoundError(input.orgId);
      const email = input.email.trim().toLowerCase();
      const token = mintInviteToken();
      const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
      const [row] = await database
        .insert(organizationInvites)
        .values({
          orgId: input.orgId,
          email,
          role: input.role,
          tokenHash: hashInviteToken(token),
          expiresAt,
          invitedBy: input.invitedBy,
        })
        .returning();
      if (!row) throw new Error("The invite could not be created.");
      return {
        token,
        invite: {
          id: row.id,
          orgId: org.id,
          orgName: org.name,
          orgSlug: org.slug,
          email,
          role: input.role,
          expiresAt,
        },
      };
    },

    async acceptInvite(token, user) {
      const tokenHash = hashInviteToken(token);
      const [row] = await database
        .select({
          id: organizationInvites.id,
          orgId: organizationInvites.orgId,
          email: organizationInvites.email,
          role: organizationInvites.role,
          expiresAt: organizationInvites.expiresAt,
          acceptedAt: organizationInvites.acceptedAt,
        })
        .from(organizationInvites)
        .where(eq(organizationInvites.tokenHash, tokenHash))
        .limit(1);
      if (!row || row.acceptedAt || row.expiresAt.getTime() < Date.now()) {
        throw new InviteInvalidError();
      }
      if (row.email !== user.email.trim().toLowerCase()) {
        throw new InviteInvalidError();
      }
      await database.transaction(async (transaction) => {
        await transaction
          .update(organizationInvites)
          .set({ acceptedAt: new Date() })
          .where(
            and(
              eq(organizationInvites.id, row.id),
              isNull(organizationInvites.acceptedAt),
            ),
          );
        await transaction
          .insert(organizationMemberships)
          .values({ orgId: row.orgId, userId: user.id, role: row.role })
          .onConflictDoNothing();
        await transaction
          .insert(userPreferences)
          .values({
            userId: user.id,
            activeOrgId: row.orgId,
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: userPreferences.userId,
            set: { activeOrgId: row.orgId, updatedAt: new Date() },
          });
      });
      const next = await membership(user.id, row.orgId);
      if (!next) throw new OrganizationAccessError(row.orgId);
      return next;
    },

    async settings(orgId) {
      const [row] = await database
        .select()
        .from(organizationSettings)
        .where(eq(organizationSettings.orgId, orgId))
        .limit(1);
      return {
        displayName: row?.displayName ?? null,
        logoUrl: row?.logoUrl ?? null,
        defaultModel: row?.defaultModel ?? null,
        featureFlags: (row?.featureFlags ?? {}) as Record<string, unknown>,
      };
    },
  };
}

export class OrganizationNotFoundError extends Error {
  constructor(orgId: string) {
    super(`Organization ${orgId} was not found.`);
    this.name = "OrganizationNotFoundError";
  }
}

export class OrganizationAccessError extends Error {
  constructor(orgId: string) {
    super(`Not a member of organization ${orgId}.`);
    this.name = "OrganizationAccessError";
  }
}

export class OrganizationSuspendedError extends Error {
  constructor(orgId: string) {
    super(`Organization ${orgId} is suspended.`);
    this.name = "OrganizationSuspendedError";
  }
}

export class InviteInvalidError extends Error {
  constructor() {
    super("That invite is not valid.");
    this.name = "InviteInvalidError";
  }
}

export { openBotRoleFor };

export async function emailForUser(
  database: Database,
  userId: string,
): Promise<string | null> {
  const [row] = await database
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row?.email ?? null;
}
