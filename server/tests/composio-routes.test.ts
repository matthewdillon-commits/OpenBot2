import { describe, expect, test } from "bun:test";
import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import type { AppVariables } from "../src/auth/guards";
import { createComposioRoutes } from "../src/composio/routes";

const USER = {
  id: "member-1",
  email: "member@openbot.test",
  name: "A Member",
};

function appWith(options?: {
  apiKey?: string;
  orgId?: string | null;
  fetchImpl?: typeof fetch;
}): {
  request: (path: string, init?: RequestInit) => Promise<Response>;
} {
  const requireUser: MiddlewareHandler<{ Variables: AppVariables }> = async (
    context,
    next,
  ) => {
    context.set("actor", {
      id: USER.id,
      email: USER.email,
      name: USER.name,
      role: "user",
      ...(options?.orgId === null
        ? {}
        : { orgId: options?.orgId ?? "org_acme" }),
    });
    await next();
  };

  const app = new Hono();
  app.route(
    "/api/composio",
    createComposioRoutes(options?.apiKey, requireUser, options?.fetchImpl),
  );

  return {
    request: (path, init) => app.request(`http://openbot.test${path}`, init),
  };
}

describe("Composio HTTP routes", () => {
  test("returns an empty catalogue when no key is configured", async () => {
    const { request } = appWith();
    const response = await request("/api/composio/catalog");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      configured: false,
      plugins: [],
      categories: [],
    });
  });

  test("refuses the catalogue without an organisation", async () => {
    const { request } = appWith({ orgId: null, apiKey: "ak_secret" });
    expect((await request("/api/composio/catalog")).status).toBe(403);
  });

  test("connects as the organisation id", async () => {
    const seen: unknown[] = [];
    const { request } = appWith({
      apiKey: "ak_secret",
      fetchImpl: async (url, init) => {
        const parsed = String(init?.body ?? "");
        seen.push({
          url: String(url),
          body: parsed ? JSON.parse(parsed) : null,
        });
        const path = String(url);
        if (path.includes("/connected_accounts?") && !path.includes("/link")) {
          return Response.json({ items: [] });
        }
        if (path.includes("/auth_configs?") && init?.method !== "POST") {
          return Response.json({
            items: [{ id: "ac_1", toolkit: { slug: "gmail" } }],
          });
        }
        if (path.endsWith("/connected_accounts/link")) {
          return Response.json({
            redirect_url: "https://connect.composio.dev/x",
          });
        }
        return new Response("unused", { status: 500 });
      },
    });

    const response = await request("/api/composio/connect", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        slug: "gmail",
        callbackUrl: "http://localhost:3010/plugins",
      }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { redirectUrl: string };
    expect(body.redirectUrl).toBe("https://connect.composio.dev/x");
    const link = seen.find((entry) =>
      JSON.stringify(entry).includes("/connected_accounts/link"),
    ) as { body: { user_id: string } };
    expect(link.body.user_id).toBe("org_acme");
    expect(link.body.user_id).not.toBe(USER.id);
  });
});
