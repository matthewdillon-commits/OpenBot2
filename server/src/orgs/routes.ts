import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import type { AppVariables } from "../auth/guards";
import { requireOrgAdmin, requirePlatformSuperadmin } from "../auth/guards";
import type { BillingService } from "../billing/stripe";
import type { AuthConfig } from "../config";
import { PLAN_SEATS } from "./constants";
import type { OrganizationRole } from "./constants";
import { ORGANIZATION_ROLES } from "./constants";
import {
  MailNotConfiguredError,
  MailSendFailedError,
  type InviteMailer,
} from "./invite-mail";
import { SsoDomainTakenError, type OrganizationSsoStore } from "./sso";
import type { SpendStore } from "./spend";
import {
  InviteInvalidError,
  OrganizationAccessError,
  OrganizationNotFoundError,
  type OrganizationStore,
  OrganizationSuspendedError,
  SeatLimitError,
} from "./store";

function asRole(value: unknown): OrganizationRole | null {
  return typeof value === "string" &&
    (ORGANIZATION_ROLES as readonly string[]).includes(value)
    ? (value as OrganizationRole)
    : null;
}

export type OrganizationRouteOptions = {
  billing?: BillingService;
  mail?: InviteMailer;
  sso?: OrganizationSsoStore;
  spend?: SpendStore;
  auth?: AuthConfig;
  publicOrigin?: string;
};

export function createOrganizationRoutes(
  organizations: OrganizationStore,
  platformSuperadmins: readonly string[],
  requireUser: MiddlewareHandler<{ Variables: AppVariables }>,
  options: OrganizationRouteOptions = {},
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
      checkout: Boolean(options.billing),
    });
  });

  app.get("/api/orgs/current", async (context) => {
    const actor = context.var.actor;
    if (!actor.orgId) {
      return context.json({ error: "No organization is selected." }, 404);
    }
    const settings = await organizations.settings(actor.orgId);
    const org = await organizations.get(actor.orgId);
    const seats = await organizations.seatUsage(actor.orgId);
    const spend = options.spend
      ? await options.spend.usage(actor.orgId)
      : { capCents: org?.spendCapCents ?? null, usedCents: 0 };
    const sso = options.sso ? await options.sso.get(actor.orgId) : null;
    return context.json({
      organization: {
        id: actor.orgId,
        slug: actor.orgSlug,
        name: actor.orgName,
        role: actor.orgRole,
        status: "active",
        plan: org?.plan ?? "free",
        displayName: settings.displayName ?? actor.orgName,
        logoUrl: settings.logoUrl,
        defaultModel: settings.defaultModel,
        seatLimit: seats.limit,
        seatsUsed: seats.used,
        seatMembers: seats.members,
        pendingInvites: seats.pendingInvites,
        spendCapCents: spend.capCents,
        spendUsedCents: spend.usedCents,
        sso: sso
          ? {
              googleEnabled: sso.googleEnabled,
              microsoftEnabled: sso.microsoftEnabled,
              oktaEnabled: sso.oktaEnabled,
              emailEnabled: sso.emailEnabled,
              domains: sso.domains,
            }
          : null,
        checkout: Boolean(options.billing),
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
    const owned = await organizations.countOwnedBy(context.var.actor.id);
    if (owned >= 1) {
      if (!options.billing) {
        return context.json(
          {
            error:
              "Checkout is required to create another workspace. Stripe is not configured on this deployment.",
          },
          402,
        );
      }
      try {
        const session = await options.billing.client.createCheckoutSession({
          userId: context.var.actor.id,
          email: context.var.actor.email,
          orgName: name,
          orgSlug: slug,
        });
        return context.json(
          {
            error: "Checkout is required to create another workspace.",
            checkoutUrl: session.url,
          },
          402,
        );
      } catch (error) {
        return context.json(
          {
            error:
              error instanceof Error
                ? error.message
                : "Stripe checkout could not be created.",
          },
          502,
        );
      }
    }
    const organization = await organizations.create({
      name,
      slug,
      plan: "free",
      seatLimit: PLAN_SEATS.free,
    });
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

  app.post("/api/orgs/current/sso", async (context) => {
    const denied = requireOrgAdmin(context);
    if (denied) return denied;
    if (!options.sso) {
      return context.json({ error: "Per-org SSO is not available." }, 503);
    }
    const orgId = context.var.actor.orgId;
    if (!orgId) {
      return context.json({ error: "No organization is selected." }, 403);
    }
    const body = (await context.req.json().catch(() => null)) as {
      googleEnabled?: unknown;
      microsoftEnabled?: unknown;
      oktaEnabled?: unknown;
      emailEnabled?: unknown;
      domains?: unknown;
    } | null;
    try {
      const record = await options.sso.set(orgId, {
        ...(typeof body?.googleEnabled === "boolean"
          ? { googleEnabled: body.googleEnabled }
          : {}),
        ...(typeof body?.microsoftEnabled === "boolean"
          ? { microsoftEnabled: body.microsoftEnabled }
          : {}),
        ...(typeof body?.oktaEnabled === "boolean"
          ? { oktaEnabled: body.oktaEnabled }
          : {}),
        ...(typeof body?.emailEnabled === "boolean"
          ? { emailEnabled: body.emailEnabled }
          : {}),
        ...(Array.isArray(body?.domains)
          ? {
              domains: body.domains.filter(
                (item): item is string => typeof item === "string",
              ),
            }
          : {}),
      });
      return context.json({ sso: record });
    } catch (error) {
      if (error instanceof SsoDomainTakenError) {
        return context.json({ error: error.message }, 409);
      }
      throw error;
    }
  });

  app.post("/api/orgs/current/spend-cap", async (context) => {
    const denied = requireOrgAdmin(context);
    if (denied) return denied;
    const orgId = context.var.actor.orgId;
    if (!orgId) {
      return context.json({ error: "No organization is selected." }, 403);
    }
    const body = (await context.req.json().catch(() => null)) as {
      spendCapCents?: unknown;
    } | null;
    const raw = body?.spendCapCents;
    if (
      raw !== null &&
      (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0)
    ) {
      return context.json(
        { error: "spendCapCents must be a whole number of cents, or null." },
        400,
      );
    }
    const organization = await organizations.setSpendCap(
      orgId,
      raw === null ? null : raw,
    );
    return context.json({ organization });
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
      if (error instanceof SeatLimitError) {
        return context.json({ error: error.message }, 403);
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
    const organization = await organizations.create({
      name,
      slug,
      plan: "enterprise",
      seatLimit: PLAN_SEATS.enterprise,
    });
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
      const invited = await sendInvite({
        organizations,
        mail: options.mail,
        orgId,
        email,
        role,
        invitedBy: context.var.actor.id,
        requireMail: false,
      });
      return context.json({
        invite: invited.invite,
        token: invited.token,
      });
    } catch (error) {
      return inviteError(context, error);
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
    try {
      const invited = await sendInvite({
        organizations,
        mail: options.mail,
        orgId,
        email,
        role,
        invitedBy: context.var.actor.id,
        requireMail: true,
      });
      return context.json({ invite: invited.invite }, 201);
    } catch (error) {
      return inviteError(context, error);
    }
  });

  return app;
}

async function sendInvite(input: {
  organizations: OrganizationStore;
  mail?: InviteMailer;
  orgId: string;
  email: string;
  role: OrganizationRole;
  invitedBy: string;
  requireMail: boolean;
}) {
  if (input.requireMail && !input.mail?.configured()) {
    throw new MailNotConfiguredError();
  }
  const invited = await input.organizations.invite({
    orgId: input.orgId,
    email: input.email,
    role: input.role,
    invitedBy: input.invitedBy,
  });
  if (input.mail?.configured()) {
    await input.mail.send({
      to: invited.invite.email,
      orgName: invited.invite.orgName,
      role: invited.invite.role,
      token: invited.token,
      invitedBy: input.invitedBy,
    });
  }
  return invited;
}

function inviteError(
  context: {
    json: (body: unknown, status?: 400 | 403 | 404 | 409 | 503) => Response;
  },
  error: unknown,
) {
  if (error instanceof MailNotConfiguredError) {
    return context.json({ error: error.message }, 503);
  }
  if (error instanceof MailSendFailedError) {
    return context.json({ error: error.message }, 503);
  }
  if (error instanceof SeatLimitError) {
    return context.json({ error: error.message }, 403);
  }
  if (error instanceof OrganizationNotFoundError) {
    return context.json({ error: error.message }, 404);
  }
  throw error;
}
