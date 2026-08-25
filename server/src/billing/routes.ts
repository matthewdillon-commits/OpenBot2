/**
 * Self-serve checkout and Stripe webhooks.
 *
 * `/platform` remains for superadmins. This is the owner path: Checkout creates
 * the paid workspace when the webhook lands. Shared state is Stripe + Postgres;
 * replica B applies the same webhook to the same row. Nothing is fanned to a
 * browser except the Checkout URL Stripe returned.
 */
import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import type { AppVariables } from "../auth/guards";
import type { OrganizationStore } from "../orgs/store";
import {
  type BillingService,
  type StripeConfig,
  verifyStripeSignature,
} from "./stripe";

export function createBillingRoutes(input: {
  billing: BillingService;
  stripe: StripeConfig;
  organizations: OrganizationStore;
  requireUser: MiddlewareHandler<{ Variables: AppVariables }>;
}) {
  const app = new Hono<{ Variables: AppVariables }>();

  app.post("/api/billing/checkout", input.requireUser, async (context) => {
    const body = (await context.req.json().catch(() => null)) as {
      name?: unknown;
      slug?: unknown;
    } | null;
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    if (!name) {
      return context.json({ error: "An organization needs a name." }, 400);
    }
    const slug = typeof body?.slug === "string" ? body.slug.trim() : undefined;
    try {
      const session = await input.billing.client.createCheckoutSession({
        userId: context.var.actor.id,
        email: context.var.actor.email,
        orgName: name,
        orgSlug: slug,
      });
      return context.json({ checkoutUrl: session.url, sessionId: session.id });
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
  });

  app.post("/api/billing/webhook", async (context) => {
    const payload = await context.req.text();
    const header = context.req.header("stripe-signature") ?? "";
    if (!verifyStripeSignature(payload, header, input.stripe.webhookSecret)) {
      return context.json({ error: "Stripe signature was not valid." }, 400);
    }
    let event: { type?: unknown; data?: { object?: unknown } };
    try {
      event = JSON.parse(payload) as {
        type?: unknown;
        data?: { object?: unknown };
      };
    } catch {
      return context.json({ error: "Stripe event was not JSON." }, 400);
    }
    if (typeof event.type !== "string" || !event.data?.object) {
      return context.json({ error: "Stripe event was incomplete." }, 400);
    }
    const object = event.data.object;
    if (!object || typeof object !== "object" || Array.isArray(object)) {
      return context.json({ error: "Stripe event was incomplete." }, 400);
    }
    const organization = await input.billing.applyEvent(input.organizations, {
      type: event.type,
      data: { object: object as Record<string, unknown> },
    });
    return context.json({ received: true, organization });
  });

  return app;
}
