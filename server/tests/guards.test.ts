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
      error: "Administrator access required.",
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

  test("refuses tenant admin data when the caller has no organization", async () => {
    const organizations: OrganizationStore = {
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
