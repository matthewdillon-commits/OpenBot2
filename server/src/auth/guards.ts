import { eq } from "drizzle-orm";
import type { Context, MiddlewareHandler } from "hono";
import type { Database } from "../db/client";
import { userRoles } from "../db/schema";
import {
  isOrgAdmin,
  type OrganizationRole,
  openBotRoleFor,
} from "../orgs/constants";
import type { OrganizationStore } from "../orgs/store";
import type { OpenBotRole } from "./roles";

export type AuthenticatedActor = {
  id: string;
  email: string;
  name?: string | null;
  image?: string | null;
  role: OpenBotRole;
  orgId?: string;
  orgSlug?: string;
  orgName?: string;
  orgRole?: OrganizationRole;
  platformSuperadmin?: boolean;
};

export type AuthService = {
  handler: (request: Request) => Response | Promise<Response>;
  api: {
    getSession: (input: {
      headers: Headers;
      query: { disableCookieCache: boolean };
    }) => Promise<{
      user: {
        id: string;
        email: string;
        name?: string | null;
        image?: string | null;
      };
    } | null>;
  };
};

export type RoleRepository = {
  rolesForUser: (userId: string) => Promise<OpenBotRole[]>;
};

export type AppVariables = {
  actor: AuthenticatedActor;
};

export function createRoleRepository(database: Database): RoleRepository {
  return {
    rolesForUser: async (userId) => {
      const records = await database
        .select({ role: userRoles.role })
        .from(userRoles)
        .where(eq(userRoles.userId, userId));

      return records.map((record) => record.role);
    },
  };
}

function isPlatformSuperadminEmail(
  email: string,
  allowlist: readonly string[],
) {
  const normalized = email.trim().toLowerCase();
  return allowlist.some(
    (allowed) => allowed.trim().toLowerCase() === normalized,
  );
}

export function createRequireUser(
  auth: AuthService,
  roleRepository: RoleRepository,
  organizations?: OrganizationStore,
  platformSuperadmins: readonly string[] = [],
  /**
   * Appliance behaviour: a membership-less user joins the sole organization.
   *
   * Off when this deployment offers email sign-up, because that person is about to
   * create their own organization rather than land in the backfilled local one.
   */
  options?: { autoJoinSoleOrganization?: boolean },
): MiddlewareHandler<{ Variables: AppVariables }> {
  return async (context, next) => {
    const session = await auth.api.getSession({
      headers: context.req.raw.headers,
      query: { disableCookieCache: true },
    });

    if (!session) {
      return context.json({ error: "Authentication required." }, 401);
    }

    const roles = await roleRepository.rolesForUser(session.user.id);
    const fallbackRole = roles.includes("admin")
      ? "admin"
      : roles.includes("user")
        ? "user"
        : undefined;

    if (!fallbackRole) {
      return context.json({ error: "Authorization required." }, 403);
    }

    const autoJoin = options?.autoJoinSoleOrganization !== false;
    const membership = organizations
      ? ((await organizations.resolveActive(session.user.id)) ??
        (autoJoin
          ? await organizations.joinIfSoleOrganization(session.user.id)
          : null))
      : null;

    const orgRole = membership?.role;
    const role = orgRole ? openBotRoleFor(orgRole) : fallbackRole;

    context.set("actor", {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      image: session.user.image,
      role,
      ...(membership
        ? {
            orgId: membership.id,
            orgSlug: membership.slug,
            orgName: membership.name,
            orgRole: membership.role,
          }
        : {}),
      platformSuperadmin: isPlatformSuperadminEmail(
        session.user.email,
        platformSuperadmins,
      ),
    });
    await next();
  };
}

/**
 * Tenant data needs a selected organization, not only a signed-in person.
 *
 * `/api/me`, the org picker and invite accept still work without one. Everything that lists
 * channels, credentials or people must not fall through to the backfilled local org.
 */
export function requireActiveOrganization(
  context: Context<{ Variables: AppVariables }>,
) {
  if (!context.var.actor.orgId) {
    return context.json({ error: "An organization is required." }, 403);
  }
  return undefined;
}

export function requireAdmin(context: Context<{ Variables: AppVariables }>) {
  if (
    context.var.actor.role !== "admin" &&
    !isOrgAdmin(context.var.actor.orgRole)
  ) {
    return context.json({ error: "Administrator access required." }, 403);
  }

  return undefined;
}

/** Owner or admin of the current organization. Same bar as {@link requireAdmin}. */
export const requireOrgAdmin = requireAdmin;

export function requirePlatformSuperadmin(
  context: Context<{ Variables: AppVariables }>,
  allowlist: readonly string[] = [],
) {
  const actor = context.var.actor;
  if (
    actor.platformSuperadmin ||
    isPlatformSuperadminEmail(actor.email, allowlist)
  ) {
    return undefined;
  }
  return context.json(
    { error: "Platform administrator access required." },
    403,
  );
}
