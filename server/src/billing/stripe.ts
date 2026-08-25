/**
 * Stripe Checkout and webhooks for plan and seats.
 *
 * Secrets come from env (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
 * `STRIPE_PRICE_ID`). Checkout session state lives at Stripe; we persist the
 * result on `organizations` so replica B sees the same plan and seat limit.
 * No in-process Map.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { StripeConfig } from "../config";
import { PLAN_SEATS, type BillingPlan } from "../orgs/constants";
import type { OrganizationRecord, OrganizationStore } from "../orgs/store";

export type { StripeConfig };

export type CheckoutSession = {
  id: string;
  url: string;
};

export type StripeClient = {
  createCheckoutSession: (input: {
    userId: string;
    email: string;
    orgName: string;
    orgSlug?: string;
    plan?: BillingPlan;
  }) => Promise<CheckoutSession>;
};

export type BillingService = {
  configured: true;
  client: StripeClient;
  applyEvent: (
    organizations: OrganizationStore,
    event: StripeEvent,
  ) => Promise<OrganizationRecord | null>;
};

export type StripeEvent = {
  type: string;
  data: { object: Record<string, unknown> };
};

const API = "https://api.stripe.com/v1";

export function planFromQuantity(quantity: number): BillingPlan {
  if (quantity >= PLAN_SEATS.enterprise) return "enterprise";
  if (quantity >= PLAN_SEATS.growth) return "growth";
  if (quantity >= PLAN_SEATS.starter) return "starter";
  return "free";
}

export function createStripeClient(
  config: StripeConfig,
  fetchImpl: typeof fetch = fetch,
): StripeClient {
  return {
    async createCheckoutSession(input) {
      const plan = input.plan && input.plan !== "free" ? input.plan : "starter";
      const quantity = PLAN_SEATS[plan];
      const body = new URLSearchParams();
      body.set("mode", "subscription");
      body.set("success_url", config.successUrl);
      body.set("cancel_url", config.cancelUrl);
      body.set("client_reference_id", input.userId);
      body.set("customer_email", input.email);
      body.set("line_items[0][price]", config.priceId);
      body.set("line_items[0][quantity]", String(quantity));
      body.set("metadata[userId]", input.userId);
      body.set("metadata[orgName]", input.orgName);
      if (input.orgSlug) body.set("metadata[orgSlug]", input.orgSlug);
      body.set("metadata[plan]", plan);
      body.set("subscription_data[metadata][userId]", input.userId);
      body.set("subscription_data[metadata][plan]", plan);
      body.set("subscription_data[metadata][orgName]", input.orgName);

      const response = await fetchImpl(`${API}/checkout/sessions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${config.secretKey}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body,
      });
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(
          text
            ? `Stripe checkout could not be created. ${text}`
            : "Stripe checkout could not be created.",
        );
      }
      const session = (await response.json()) as {
        id?: unknown;
        url?: unknown;
      };
      if (typeof session.id !== "string" || typeof session.url !== "string") {
        throw new Error("Stripe checkout did not return a session URL.");
      }
      return { id: session.id, url: session.url };
    },
  };
}

export function verifyStripeSignature(
  payload: string,
  header: string,
  secret: string,
  nowMs = Date.now(),
): boolean {
  const parts = Object.fromEntries(
    header.split(",").map((item) => {
      const [key, ...rest] = item.split("=");
      return [key?.trim() ?? "", rest.join("=")];
    }),
  );
  const timestamp = parts.t;
  const signature = parts.v1;
  if (!timestamp || !signature) return false;
  const ageMs = Math.abs(nowMs - Number(timestamp) * 1000);
  if (!Number.isFinite(ageMs) || ageMs > 5 * 60 * 1000) return false;
  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${payload}`)
    .digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function stringField(
  object: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = object[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function metadataOf(object: Record<string, unknown>): Record<string, string> {
  const raw = object.metadata;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string") result[key] = value;
  }
  return result;
}

function quantityOf(object: Record<string, unknown>): number | undefined {
  const items = object.items;
  if (items && typeof items === "object" && "data" in items) {
    const data = (items as { data?: unknown }).data;
    if (Array.isArray(data) && data[0] && typeof data[0] === "object") {
      const quantity = (data[0] as { quantity?: unknown }).quantity;
      if (typeof quantity === "number" && quantity > 0) return quantity;
    }
  }
  const quantity = object.quantity;
  if (typeof quantity === "number" && quantity > 0) return quantity;
  return undefined;
}

export async function applyStripeEvent(
  organizations: OrganizationStore,
  event: StripeEvent,
): Promise<OrganizationRecord | null> {
  const object = event.data.object;
  const metadata = metadataOf(object);

  if (event.type === "checkout.session.completed") {
    const userId =
      metadata.userId ?? stringField(object, "client_reference_id");
    const orgName = metadata.orgName;
    if (!userId || !orgName) return null;
    const plan = (metadata.plan as BillingPlan | undefined) ?? "starter";
    const seatLimit = PLAN_SEATS[plan] ?? PLAN_SEATS.starter;
    const customerId =
      typeof object.customer === "string" ? object.customer : undefined;
    const subscriptionId =
      typeof object.subscription === "string" ? object.subscription : undefined;
    const organization = await organizations.create({
      name: orgName,
      slug: metadata.orgSlug,
      plan,
      seatLimit,
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscriptionId,
    });
    await organizations.ensureMembership({
      orgId: organization.id,
      userId,
      role: "owner",
    });
    await organizations.setActive(userId, organization.id);
    return organization;
  }

  if (
    event.type === "customer.subscription.updated" ||
    event.type === "customer.subscription.created"
  ) {
    const subscriptionId = stringField(object, "id");
    if (!subscriptionId) return null;
    const quantity = quantityOf(object);
    const plan =
      (metadata.plan as BillingPlan | undefined) ??
      (quantity ? planFromQuantity(quantity) : "starter");
    const seatLimit = quantity ?? PLAN_SEATS[plan] ?? PLAN_SEATS.starter;
    const customerId =
      typeof object.customer === "string" ? object.customer : undefined;
    const existing =
      await organizations.getByStripeSubscription(subscriptionId);
    if (!existing) return null;
    return organizations.applyBilling({
      orgId: existing.id,
      plan,
      seatLimit,
      stripeCustomerId: customerId ?? existing.stripeCustomerId ?? undefined,
      stripeSubscriptionId: subscriptionId,
    });
  }

  if (event.type === "customer.subscription.deleted") {
    const subscriptionId = stringField(object, "id");
    if (!subscriptionId) return null;
    const existing =
      await organizations.getByStripeSubscription(subscriptionId);
    if (!existing) return null;
    return organizations.applyBilling({
      orgId: existing.id,
      plan: "free",
      seatLimit: PLAN_SEATS.free,
      stripeSubscriptionId: null,
    });
  }

  return null;
}

export function createBillingService(
  config: StripeConfig,
  fetchImpl: typeof fetch = fetch,
): BillingService {
  return {
    configured: true,
    client: createStripeClient(config, fetchImpl),
    applyEvent: (organizations, event) =>
      applyStripeEvent(organizations, event),
  };
}
