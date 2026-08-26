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
import { isConfiguredAdmin, type OpenBotRole } from "./roles";

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
  /**
   * Deployment-wide `/admin`. Distinct from org owner: `role` is admin for an
   * org owner, but this is only true for PLATFORM_SUPERADMINS,
   * INITIAL_ADMIN_EMAILS, or a user_roles administrator.
   */
  deploymentAdmin?: boolean;
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
  options?: {
    autoJoinSoleOrganization?: boolean;
    initialAdminEmails?: readonly string[];
  },
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
    const initialAdminEmails = options?.initialAdminEmails ?? [];
    const platformSuperadmin = isPlatformSuperadminEmail(
      session.user.email,
      platformSuperadmins,
    );
    const deploymentAdmin =
      fallbackRole === "admin" ||
      isConfiguredAdmin(session.user.email, initialAdminEmails) ||
      platformSuperadmin;

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
      platformSuperadmin,
      deploymentAdmin,
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

/**
 * Deployment-wide `/admin`. Org owner is not enough: that person is `role`
 * admin via the org mapping, and must not open settings that apply to everybody
 * in this deployment.
 */
export function canOpenDeploymentAdmin(actor: {
  platformSuperadmin?: boolean | null;
  deploymentAdmin?: boolean | null;
}): boolean {
  return actor.platformSuperadmin === true || actor.deploymentAdmin === true;
}

export function requireDeploymentAdmin(
  context: Context<{ Variables: AppVariables }>,
) {
  if (canOpenDeploymentAdmin(context.var.actor)) {
    return undefined;
  }
  return context.json(
    { error: "Platform administrator access required." },
    403,
  );
}

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
