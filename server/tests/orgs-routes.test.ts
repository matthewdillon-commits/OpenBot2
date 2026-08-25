import { describe, expect, test } from "bun:test";
import type { MiddlewareHandler } from "hono";
import type { AppVariables } from "../src/auth/guards";
import { createOrganizationRoutes } from "../src/orgs/routes";
import type { OrganizationStore } from "../src/orgs/store";

const actor = {
  id: "plat-1",
  email: "owner@openbot.test",
  role: "admin" as const,
  platformSuperadmin: true,
};

const requireUser: MiddlewareHandler<{ Variables: AppVariables }> = async (
  context,
  next,
) => {
  context.set("actor", actor);
  await next();
};

function org(
  overrides: Partial<{
    id: string;
    slug: string;
    name: string;
    status: "active" | "suspended";
    plan: string;
    seatLimit: number;
    spendCapCents: number | null;
    stripeCustomerId: string | null;
    stripeSubscriptionId: string | null;
    role: "owner" | "admin" | "member";
  }> = {},
) {
  return {
    id: "org_new",
    slug: "acme",
    name: "Acme",
    status: "active" as const,
    plan: "free",
    seatLimit: 1,
    spendCapCents: null,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    ...overrides,
  };
}

function store(overrides: Partial<OrganizationStore> = {}): OrganizationStore {
  return {
    get: async () => null,
    getBySlug: async () => null,
    listForUser: async () => [],
    membership: async () => null,
    resolveActive: async () => null,
    setActive: async () => {
      throw new Error("unused");
    },
    ensureLocal: async () => {
      throw new Error("unused");
    },
    ensureMembership: async () => undefined,
    joinIfSoleOrganization: async () => null,
    create: async (input) =>
      org({
        name: input.name,
        plan: input.plan ?? "free",
        seatLimit: input.seatLimit ?? 1,
      }),
    setStatus: async (orgId, status) =>
      org({ id: orgId, status, plan: "enterprise", seatLimit: 100 }),
    listAll: async () => [
      org({
        id: "org_local",
        slug: "local",
        name: "Local",
        plan: "enterprise",
        seatLimit: 100,
      }),
    ],
    countOwnedBy: async () => 0,
    seatUsage: async () => ({
      members: 0,
      pendingInvites: 0,
      used: 0,
      limit: 1,
    }),
    applyBilling: async () => org(),
    getByStripeSubscription: async () => null,
    setSpendCap: async () => org(),
    invite: async (input) => ({
      token: "invite-token",
      invite: {
        id: "inv-1",
        orgId: input.orgId,
        orgName: "Acme",
        orgSlug: "acme",
        email: input.email,
        role: input.role,
        expiresAt: new Date(),
      },
    }),
    acceptInvite: async () => {
      throw new Error("unused");
    },
    settings: async () => ({
      displayName: null,
      logoUrl: null,
      defaultModel: null,
      featureFlags: {},
    }),
    ...overrides,
  };
}

describe("platform organization routes", () => {
  test("a platform superadmin can create an organization", async () => {
    const app = createOrganizationRoutes(
      store(),
      ["owner@openbot.test"],
      requireUser,
    );
    const response = await app.request(
      "http://openbot.test/api/platform/organizations",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Acme" }),
      },
    );
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      organization: {
        id: "org_new",
        slug: "acme",
        name: "Acme",
        status: "active",
        plan: "enterprise",
        seatLimit: 100,
        spendCapCents: null,
        stripeCustomerId: null,
        stripeSubscriptionId: null,
      },
    });
  });

  test("a signed-in person can create an organization they own", async () => {
    const member: MiddlewareHandler<{ Variables: AppVariables }> = async (
      context,
      next,
    ) => {
      context.set("actor", {
        id: "u1",
        email: "member@openbot.test",
        role: "user",
      });
      await next();
    };
    let membership: { orgId: string; userId: string; role: string } | null =
      null;
    let active: string | null = null;
    const app = createOrganizationRoutes(
      store({
        ensureMembership: async (input) => {
          membership = input;
        },
        setActive: async (_userId, orgId) => {
          active = orgId;
          return {
            id: orgId,
            slug: "acme",
            name: "Acme",
            status: "active",
            plan: "free",
            seatLimit: 1,
            spendCapCents: null,
            stripeCustomerId: null,
            stripeSubscriptionId: null,
            role: "owner",
          };
        },
      }),
      ["owner@openbot.test"],
      member,
    );
    const response = await app.request("http://openbot.test/api/orgs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Acme" }),
    });
    expect(response.status).toBe(201);
    expect(membership).toEqual({
      orgId: "org_new",
      userId: "u1",
      role: "owner",
    });
    expect(active).toBe("org_new");
    expect(await response.json()).toEqual({
      organization: {
        id: "org_new",
        slug: "acme",
        name: "Acme",
        status: "active",
        plan: "free",
        seatLimit: 1,
        spendCapCents: null,
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        role: "owner",
      },
    });
  });

  test("creating an organization requires a name", async () => {
    const app = createOrganizationRoutes(
      store(),
      ["owner@openbot.test"],
      requireUser,
    );
    const response = await app.request("http://openbot.test/api/orgs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(400);
  });

  test("a member cannot provision organizations", async () => {
    const member: MiddlewareHandler<{ Variables: AppVariables }> = async (
      context,
      next,
    ) => {
      context.set("actor", {
        id: "u1",
        email: "member@openbot.test",
        role: "user",
        orgRole: "member",
      });
      await next();
    };
    const app = createOrganizationRoutes(
      store(),
      ["owner@openbot.test"],
      member,
    );
    const response = await app.request(
      "http://openbot.test/api/platform/organizations",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Acme" }),
      },
    );
    expect(response.status).toBe(403);
  });
});
