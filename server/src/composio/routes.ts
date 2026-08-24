/**
 * The Composio catalogue as HTTP: list, connect, disconnect.
 *
 * Connections are always scoped to the signed-in organisation. Composio's `user_id` is this
 * organisation's id, not a person and not a shared project-wide user, so two tenants on one
 * deployment cannot read or revoke each other's grants.
 */

import type { Context, MiddlewareHandler } from "hono";
import { Hono } from "hono";
import { type AppVariables, requireActiveOrganization } from "../auth/guards";
import { orgIdOf } from "../orgs/constants";
import { composioClient } from "./client";

export function createComposioRoutes(
  apiKey: string | undefined,
  requireUser: MiddlewareHandler<{ Variables: AppVariables }>,
  fetchImpl: typeof fetch = fetch,
  gmailAuthConfigId?: string,
) {
  const routes = new Hono<{ Variables: AppVariables }>();
  const client = apiKey
    ? composioClient(apiKey, fetchImpl, { gmailAuthConfigId })
    : null;

  const withOrg = async (
    context: Context<{ Variables: AppVariables }>,
    run: (orgId: string) => Promise<Response>,
  ) => {
    const denied = requireActiveOrganization(context);
    if (denied) return denied;
    return run(orgIdOf(context.var.actor));
  };

  routes.get("/catalog", requireUser, async (context) =>
    withOrg(context, async (orgId) => {
      if (!client) {
        return context.json({ configured: false, plugins: [] });
      }
      try {
        return context.json(await client.catalog(orgId));
      } catch (error) {
        return context.json(
          {
            error:
              error instanceof Error
                ? error.message
                : "The plugin catalogue could not be loaded.",
          },
          502,
        );
      }
    }),
  );

  routes.post("/connect", requireUser, async (context) =>
    withOrg(context, async (orgId) => {
      if (!client) {
        return context.json(
          { error: "Composio is not configured. Set COMPOSIO_API_KEY." },
          503,
        );
      }
      const body = (await context.req.json().catch(() => null)) as {
        slug?: unknown;
        callbackUrl?: unknown;
      } | null;
      const slug = typeof body?.slug === "string" ? body.slug.trim() : "";
      const callbackUrl =
        typeof body?.callbackUrl === "string" ? body.callbackUrl.trim() : "";
      if (!slug) {
        return context.json({ error: "A plugin slug is required." }, 400);
      }
      if (!callbackUrl) {
        return context.json({ error: "A callback URL is required." }, 400);
      }
      try {
        const result = await client.connect(orgId, slug, callbackUrl);
        return context.json(result);
      } catch (error) {
        return context.json(
          {
            error:
              error instanceof Error
                ? error.message
                : "That plugin could not be connected.",
          },
          502,
        );
      }
    }),
  );

  routes.delete("/connections/:id", requireUser, async (context) =>
    withOrg(context, async (orgId) => {
      if (!client) {
        return context.json(
          { error: "Composio is not configured. Set COMPOSIO_API_KEY." },
          503,
        );
      }
      const id = context.req.param("id");
      try {
        await client.disconnect(orgId, id);
        return context.json({ ok: true });
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "That plugin could not be disconnected.";
        const status = message.includes("not this organisation") ? 404 : 502;
        return context.json({ error: message }, status);
      }
    }),
  );

  return routes;
}
