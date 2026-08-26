import { describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { loadConfig } from "../src/config";
import type { OrganizationStore } from "../src/orgs/store";
import { testEnvironment } from "./support/environment";

const config = loadConfig({
  ...testEnvironment(),
});

const noSessionAuth = {
  handler: () => new Response(null, { status: 204 }),
  api: {
    getSession: async () => null,
  },
};

function authenticatedAs(
  userId: string,
  email = "member@openbot.test",
  name = "OpenBot Member",
  image = "https://example.test/member.png",
) {
  return {
    handler: () => new Response(null, { status: 204 }),
    api: {
      getSession: async () => ({ user: { id: userId, email, name, image } }),
    },
  };
}

function unusedOrganizationStore(): OrganizationStore {
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
    create: async () => {
      throw new Error("unused");
    },
    setStatus: async () => {
      throw new Error("unused");
    },
    listAll: async () => [],
    countOwnedBy: async () => 0,
    seatUsage: async () => ({
      members: 0,
      pendingInvites: 0,
      used: 0,
      limit: 1,
    }),
    applyBilling: async () => {
      throw new Error("unused");
    },
    getByStripeSubscription: async () => null,
    setSpendCap: async () => {
      throw new Error("unused");
    },
    invite: async () => {
      throw new Error("unused");
    },
    acceptInvite: async () => {
      throw new Error("unused");
    },
    settings: async () => ({
      displayName: null,
      logoUrl: null,
      defaultModel: null,
      featureFlags: {},
    }),
  };
}

function orgOwnerStore(userId: string): OrganizationStore {
  const membership = {
    id: "org_acme",
    slug: "acme",
    name: "Acme",
    status: "active" as const,
    plan: "free",
    seatLimit: 1,
    spendCapCents: null,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    role: "owner" as const,
  };
  return {
    ...unusedOrganizationStore(),
    listForUser: async (id) => (id === userId ? [membership] : []),
    membership: async (id, orgId) =>
      id === userId && orgId === membership.id ? membership : null,
    resolveActive: async (id) => (id === userId ? membership : null),
  };
}

describe("server authorization", () => {
  test("returns 401 when a protected route has no session", async () => {
    const app = createApp(config, noSessionAuth, {
      rolesForUser: async () => [],
    });

    const response = await app.request("http://openbot.local/api/me");

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Authentication required.",
    });
  });

  test("denies a signed-in user from an administrator route", async () => {
    const app = createApp(config, authenticatedAs("member"), {
      rolesForUser: async () => ["user"],
    });

    const response = await app.request("http://openbot.local/api/admin/status");

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Platform administrator access required.",
    });
  });

  test("returns the authenticated user actor", async () => {
    const app = createApp(config, authenticatedAs("member"), {
      rolesForUser: async () => ["user"],
    });

    const response = await app.request("http://openbot.local/api/me");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      user: {
        id: "member",
        email: "member@openbot.test",
        name: "OpenBot Member",
        image: "https://example.test/member.png",
        role: "user",
        platformSuperadmin: false,
        deploymentAdmin: false,
        canSeeTheWork: false,
        canOpenDeploymentAdmin: false,
      },
      organizations: [],
    });
  });

  test("allows an administrator to reach an administrator route", async () => {
    const app = createApp(config, authenticatedAs("admin"), {
      rolesForUser: async () => ["admin"],
    });

    const response = await app.request("http://openbot.local/api/admin/status");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });

  test("denies an org owner who is not a platform or initial admin from /admin", async () => {
    const app = createApp(
      config,
      authenticatedAs("owner-1", "owner@acme.test", "Acme Owner"),
      { rolesForUser: async () => ["user"] },
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      orgOwnerStore("owner-1"),
    );

    const me = await app.request("http://openbot.local/api/me");
    expect(me.status).toBe(200);
    const body = (await me.json()) as {
      user: {
        role: string;
        orgRole?: string;
        deploymentAdmin?: boolean;
        canOpenDeploymentAdmin?: boolean;
        canSeeTheWork?: boolean;
      };
    };
    expect(body.user.role).toBe("admin");
    expect(body.user.orgRole).toBe("owner");
    expect(body.user.canSeeTheWork).toBe(true);
    expect(body.user.deploymentAdmin).toBe(false);
    expect(body.user.canOpenDeploymentAdmin).toBe(false);

    const response = await app.request("http://openbot.local/api/admin/status");
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Platform administrator access required.",
    });
  });

  test("allows INITIAL_ADMIN_EMAILS to open /admin even as org owner", async () => {
    const app = createApp(
      config,
      authenticatedAs("admin", "admin@openbot.test", "Initial Admin"),
      { rolesForUser: async () => ["user"] },
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      orgOwnerStore("admin"),
    );

    const response = await app.request("http://openbot.local/api/admin/status");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });

  test("allows PLATFORM_SUPERADMINS to open /admin as an org owner", async () => {
    const platformConfig = loadConfig({
      ...testEnvironment({ PLATFORM_SUPERADMINS: "plat@acme.test" }),
    });
    const app = createApp(
      platformConfig,
      authenticatedAs("plat-1", "plat@acme.test", "Platform"),
      { rolesForUser: async () => ["user"] },
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      orgOwnerStore("plat-1"),
    );

    const response = await app.request("http://openbot.local/api/admin/status");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });

  test("refuses tenant admin data when the caller has no organization", async () => {
    const organizations = unusedOrganizationStore();

    const app = createApp(
      config,
      authenticatedAs("admin"),
      { rolesForUser: async () => ["admin"] },
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      organizations,
    );

    const me = await app.request("http://openbot.local/api/me");
    expect(me.status).toBe(200);

    const people = await app.request("http://openbot.local/api/admin/people");
    expect(people.status).toBe(403);
    await expect(people.json()).resolves.toEqual({
      error: "An organization is required.",
    });
  });
});
