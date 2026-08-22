import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import type { AppVariables } from "../auth/guards";
import { requireOrgAdmin, requirePlatformSuperadmin } from "../auth/guards";
import type { OrganizationRole } from "./constants";
import { ORGANIZATION_ROLES } from "./constants";
import {
  InviteInvalidError,
  OrganizationAccessError,
  OrganizationNotFoundError,
  type OrganizationStore,
  OrganizationSuspendedError,
} from "./store";

function asRole(value: unknown): OrganizationRole | null {
  return typeof value === "string" &&
    (ORGANIZATION_ROLES as readonly string[]).includes(value)
    ? (value as OrganizationRole)
    : null;
}

export function createOrganizationRoutes(
  organizations: OrganizationStore,
  platformSuperadmins: readonly string[],
  requireUser: MiddlewareHandler<{ Variables: AppVariables }>,
) {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use("/api/orgs/*", requireUser);
  app.use("/api/platform/*", requireUser);

  app.get("/api/orgs", async (context) => {
    const actor = context.var.actor;
    const orgs = await organizations.listForUser(actor.id);
    const current = await organizations.resolveActive(actor.id);
    return context.json({
      organizations: orgs,
      current,
      platformSuperadmin: actor.platformSuperadmin === true,
    });
  });

  app.get("/api/orgs/current", async (context) => {
    const actor = context.var.actor;
    if (!actor.orgId) {
      return context.json({ error: "No organization is selected." }, 404);
    }
    const settings = await organizations.settings(actor.orgId);
    return context.json({
      organization: {
        id: actor.orgId,
        slug: actor.orgSlug,
        name: actor.orgName,
        role: actor.orgRole,
        status: "active",
        displayName: settings.displayName ?? actor.orgName,
        logoUrl: settings.logoUrl,
        defaultModel: settings.defaultModel,
      },
    });
  });

  app.post("/api/orgs", async (context) => {
    const body = (await context.req.json().catch(() => null)) as {
      name?: unknown;
      slug?: unknown;
    } | null;
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    if (!name) {
      return context.json({ error: "An organization needs a name." }, 400);
    }
    const slug = typeof body?.slug === "string" ? body.slug.trim() : undefined;
    const organization = await organizations.create({ name, slug });
    await organizations.ensureMembership({
      orgId: organization.id,
      userId: context.var.actor.id,
      role: "owner",
    });
    const current = await organizations.setActive(
      context.var.actor.id,
      organization.id,
    );
    return context.json({ organization: current }, 201);
  });

  app.post("/api/orgs/current", async (context) => {
    const body = (await context.req.json().catch(() => null)) as {
      slug?: unknown;
      orgId?: unknown;
    } | null;
    const slug = typeof body?.slug === "string" ? body.slug.trim() : "";
    const orgId = typeof body?.orgId === "string" ? body.orgId.trim() : "";
    const target = slug
      ? await organizations.getBySlug(slug)
      : orgId
        ? await organizations.get(orgId)
        : null;
    if (!target) {
      return context.json({ error: "Organization was not found." }, 404);
    }
    try {
      const current = await organizations.setActive(
        context.var.actor.id,
        target.id,
      );
      return context.json({ organization: current });
    } catch (error) {
      if (error instanceof OrganizationSuspendedError) {
        return context.json({ error: error.message }, 403);
      }
      if (error instanceof OrganizationAccessError) {
        return context.json({ error: error.message }, 403);
      }
      throw error;
    }
  });

  app.post("/api/orgs/invites/:token/accept", async (context) => {
    const token = context.req.param("token");
    try {
      const organization = await organizations.acceptInvite(token, {
        id: context.var.actor.id,
        email: context.var.actor.email,
      });
      return context.json({ organization });
    } catch (error) {
      if (error instanceof InviteInvalidError) {
        return context.json({ error: error.message }, 400);
      }
      throw error;
    }
  });

  app.get("/api/platform/organizations", async (context) => {
    const denied = requirePlatformSuperadmin(context, platformSuperadmins);
    if (denied) return denied;
    return context.json({
      organizations: await organizations.listAll(),
    });
  });

  app.post("/api/platform/organizations", async (context) => {
    const denied = requirePlatformSuperadmin(context, platformSuperadmins);
    if (denied) return denied;
    const body = (await context.req.json().catch(() => null)) as {
      name?: unknown;
      slug?: unknown;
    } | null;
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    if (!name) {
      return context.json({ error: "An organization needs a name." }, 400);
    }
    const slug = typeof body?.slug === "string" ? body.slug.trim() : undefined;
    const organization = await organizations.create({ name, slug });
    return context.json({ organization }, 201);
  });

  app.post("/api/platform/organizations/:orgId/invites", async (context) => {
    const denied = requirePlatformSuperadmin(context, platformSuperadmins);
    if (denied) return denied;
    const orgId = context.req.param("orgId");
    const body = (await context.req.json().catch(() => null)) as {
      email?: unknown;
      role?: unknown;
    } | null;
    const email = typeof body?.email === "string" ? body.email.trim() : "";
    const role = asRole(body?.role) ?? "owner";
    if (!email) {
      return context.json({ error: "An invite needs an email address." }, 400);
    }
    try {
      const invited = await organizations.invite({
        orgId,
        email,
        role,
        invitedBy: context.var.actor.id,
      });
      return context.json({
        invite: invited.invite,
        token: invited.token,
      });
    } catch (error) {
      if (error instanceof OrganizationNotFoundError) {
        return context.json({ error: error.message }, 404);
      }
      throw error;
    }
  });

  app.post("/api/platform/organizations/:orgId/status", async (context) => {
    const denied = requirePlatformSuperadmin(context, platformSuperadmins);
    if (denied) return denied;
    const body = (await context.req.json().catch(() => null)) as {
      status?: unknown;
    } | null;
    if (body?.status !== "active" && body?.status !== "suspended") {
      return context.json(
        { error: 'status must be "active" or "suspended".' },
        400,
      );
    }
    try {
      const organization = await organizations.setStatus(
        context.req.param("orgId"),
        body.status,
      );
      return context.json({ organization });
    } catch (error) {
      if (error instanceof OrganizationNotFoundError) {
        return context.json({ error: error.message }, 404);
      }
      throw error;
    }
  });

  app.post("/api/orgs/invites", async (context) => {
    const denied = requireOrgAdmin(context);
    if (denied) return denied;
    const orgId = context.var.actor.orgId;
    if (!orgId) {
      return context.json({ error: "No organization is selected." }, 403);
    }
    const body = (await context.req.json().catch(() => null)) as {
      email?: unknown;
      role?: unknown;
    } | null;
    const email = typeof body?.email === "string" ? body.email.trim() : "";
    const role = asRole(body?.role) ?? "member";
    if (!email) {
      return context.json({ error: "An invite needs an email address." }, 400);
    }
    if (role === "owner" && context.var.actor.orgRole !== "owner") {
      return context.json(
        { error: "Only an owner may invite another owner." },
        403,
      );
    }
    const invited = await organizations.invite({
      orgId,
      email,
      role,
      invitedBy: context.var.actor.id,
    });
    return context.json({ invite: invited.invite, token: invited.token }, 201);
  });

  return app;
}
