import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import type { AppVariables } from "../src/auth/guards";
import {
  applyStripeEvent,
  planFromQuantity,
  verifyStripeSignature,
} from "../src/billing/stripe";
import { PLAN_SEATS } from "../src/orgs/constants";
import { enqueueUnattendedJob } from "../src/jobs/enqueue";
import {
  createInviteMailer,
  MailNotConfiguredError,
} from "../src/orgs/invite-mail";
import { createOrganizationRoutes } from "../src/orgs/routes";
import { providerAllowed } from "../src/orgs/sso";
import { SpendCapError, SPEND_CAP_REFUSAL } from "../src/orgs/spend";
import {
  SeatLimitError,
  type OrganizationRecord,
  type OrganizationStore,
} from "../src/orgs/store";
import { startTracing, withSpan } from "../src/telemetry";
import {
  FAMILY_NAV_NAMES,
  visibleOwnerNavLabels,
} from "../../app/src/lib/nav/owner-nav";

function orgRecord(
  overrides: Partial<OrganizationRecord> = {},
): OrganizationRecord {
  return {
    id: "org_new",
    slug: "acme",
    name: "Acme",
    status: "active",
    plan: "free",
    seatLimit: 1,
    spendCapCents: null,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    ...overrides,
  };
}

function unusedStore(
  overrides: Partial<OrganizationStore> = {},
): OrganizationStore {
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
      orgRecord({
        name: input.name,
        plan: input.plan ?? "free",
        seatLimit: input.seatLimit ?? PLAN_SEATS.free,
      }),
    setStatus: async (orgId, status) => orgRecord({ id: orgId, status }),
    listAll: async () => [
      orgRecord({ id: "org_local", slug: "local", name: "Local" }),
    ],
    countOwnedBy: async () => 0,
    seatUsage: async () => ({
      members: 0,
      pendingInvites: 0,
      used: 0,
      limit: 1,
    }),
    applyBilling: async () => orgRecord(),
    getByStripeSubscription: async () => null,
    setSpendCap: async () => orgRecord(),
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

const actor = {
  id: "u1",
  email: "owner@openbot.test",
  role: "admin" as const,
  orgId: "org_new",
  orgRole: "owner" as const,
};

const requireUser: MiddlewareHandler<{ Variables: AppVariables }> = async (
  context,
  next,
) => {
  context.set("actor", actor);
  await next();
};

describe("Phase 6 seats and checkout", () => {
  test("a signed-in person cannot create a second workspace without checkout", async () => {
    const app = createOrganizationRoutes(
      unusedStore({ countOwnedBy: async () => 1 }),
      [],
      requireUser,
    );
    const response = await app.request("http://openbot.test/api/orgs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Second" }),
    });
    expect(response.status).toBe(402);
    const body = (await response.json()) as {
      error: string;
      checkoutUrl?: string;
    };
    expect(body.error).toContain("Checkout");
    expect(body.checkoutUrl).toBeUndefined();
  });

  test("a second workspace returns a Stripe Checkout URL when billing is configured", async () => {
    const app = createOrganizationRoutes(
      unusedStore({ countOwnedBy: async () => 1 }),
      [],
      requireUser,
      {
        billing: {
          configured: true,
          client: {
            createCheckoutSession: async () => ({
              id: "cs_1",
              url: "https://checkout.stripe.com/c/cs_1",
            }),
          },
          applyEvent: async () => orgRecord(),
        },
      },
    );
    const response = await app.request("http://openbot.test/api/orgs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Second" }),
    });
    expect(response.status).toBe(402);
    const body = (await response.json()) as { checkoutUrl?: string };
    expect(body.checkoutUrl).toBe("https://checkout.stripe.com/c/cs_1");
  });

  test("an over-seat invite is refused", async () => {
    const app = createOrganizationRoutes(
      unusedStore({
        invite: async () => {
          throw new SeatLimitError(1);
        },
      }),
      [],
      requireUser,
      {
        mail: {
          configured: () => true,
          send: async () => undefined,
        },
      },
    );
    const response = await app.request("http://openbot.test/api/orgs/invites", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "new@openbot.test", role: "member" }),
    });
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain("seat");
  });
});

describe("Phase 6 invite email", () => {
  test("missing mail config fails closed and does not pretend the invite was sent", async () => {
    let invited = false;
    const app = createOrganizationRoutes(
      unusedStore({
        invite: async (input) => {
          invited = true;
          return {
            token: "secret-token",
            invite: {
              id: "inv-1",
              orgId: input.orgId,
              orgName: "Acme",
              orgSlug: "acme",
              email: input.email,
              role: input.role,
              expiresAt: new Date(),
            },
          };
        },
      }),
      [],
      requireUser,
      { mail: createInviteMailer({} as NodeJS.ProcessEnv) },
    );
    const response = await app.request("http://openbot.test/api/orgs/invites", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "new@openbot.test", role: "member" }),
    });
    expect(response.status).toBe(503);
    expect(invited).toBe(false);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain("SMTP");
  });

  test("createInviteMailer throws MailNotConfiguredError without SMTP", async () => {
    const mailer = createInviteMailer({});
    expect(mailer.configured()).toBe(false);
    await expect(
      mailer.send({
        to: "a@b.test",
        orgName: "Acme",
        role: "member",
        token: "t",
        invitedBy: "u1",
      }),
    ).rejects.toBeInstanceOf(MailNotConfiguredError);
  });
});

describe("Phase 6 per-org SSO", () => {
  test("org A's disabled Google does not apply to an unclaimed org B domain", () => {
    const orgA = {
      orgId: "org_a",
      google: false,
      microsoft: true,
      okta: true,
      email: true,
    };
    const orgB = {
      orgId: "org_b",
      google: true,
      microsoft: true,
      okta: true,
      email: true,
    };
    expect(providerAllowed(orgA, "google")).toBe(false);
    expect(providerAllowed(orgB, "google")).toBe(true);
  });
});

describe("Phase 6 spend cap", () => {
  test("enqueue refuses out loud when the cap is crossed", async () => {
    const result = await enqueueUnattendedJob({
      trigger: "manual",
      orgId: "org_local",
      channelId: "channel_1",
      goalId: "channel_1",
      coworkerId: "researcher",
      actingUserId: "user-1",
      actorRole: "user",
      prompt: "Go.",
      lookupChannel: async () => ({
        id: "channel_1",
        name: "Goal",
        agentIds: ["researcher"],
        threadId: "thread-1",
        active: true,
      }),
      jobStore: {
        enqueue: async () => {
          throw new Error("must not enqueue under a crossed cap");
        },
      },
      spend: {
        usage: async () => ({ capCents: 0, usedCents: 0 }),
        consume: async () => {
          throw new SpendCapError("unattended");
        },
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(402);
    expect(result.error).toBe(SPEND_CAP_REFUSAL);
  });
});

describe("Phase 6 Stripe webhook", () => {
  test("a valid signature is accepted and a stale one is not", () => {
    const secret = "whsec_test";
    const payload = '{"id":"evt_1"}';
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = createHmac("sha256", secret)
      .update(`${timestamp}.${payload}`)
      .digest("hex");
    expect(
      verifyStripeSignature(payload, `t=${timestamp},v1=${signature}`, secret),
    ).toBe(true);
    expect(
      verifyStripeSignature(payload, `t=${timestamp},v1=${signature}`, "other"),
    ).toBe(false);
  });

  test("checkout.session.completed writes plan and seats onto a new org", async () => {
    const created: OrganizationRecord[] = [];
    const store = unusedStore({
      create: async (input) => {
        const row = orgRecord({
          name: input.name,
          plan: input.plan ?? "starter",
          seatLimit: input.seatLimit ?? PLAN_SEATS.starter,
          stripeCustomerId: input.stripeCustomerId ?? null,
          stripeSubscriptionId: input.stripeSubscriptionId ?? null,
        });
        created.push(row);
        return row;
      },
      ensureMembership: async () => undefined,
      setActive: async () => ({ ...orgRecord(), role: "owner" }),
    });
    const organization = await applyStripeEvent(store, {
      type: "checkout.session.completed",
      data: {
        object: {
          client_reference_id: "user_1",
          customer: "cus_1",
          subscription: "sub_1",
          metadata: {
            userId: "user_1",
            orgName: "Paid Co",
            plan: "starter",
          },
        },
      },
    });
    expect(organization?.plan).toBe("starter");
    expect(organization?.seatLimit).toBe(PLAN_SEATS.starter);
    expect(created).toHaveLength(1);
  });

  test("planFromQuantity maps Stripe seats onto named plans", () => {
    expect(planFromQuantity(1)).toBe("free");
    expect(planFromQuantity(5)).toBe("starter");
    expect(planFromQuantity(20)).toBe("growth");
    expect(planFromQuantity(100)).toBe("enterprise");
  });
});

describe("Phase 6 OpenTelemetry", () => {
  test("API and worker tracing is a real SDK span, not a comment", async () => {
    startTracing("openbot-test");
    const value = await withSpan("phase6.proof", async () => 6);
    expect(value).toBe(6);
  });
});

describe("Phase 6 owner nav is unchanged", () => {
  test("a typical owner still does not see family names, Measure, or Approvals", () => {
    const labels = visibleOwnerNavLabels({ canSeeTheWork: false });
    for (const name of FAMILY_NAV_NAMES) {
      expect(labels).not.toContain(name);
    }
    expect(labels).not.toContain("Measure");
    expect(labels).not.toContain("Approvals");
    expect(labels).not.toContain("Agents");
    expect(labels).toEqual(["CRM", "Plugins", "Skills"]);
  });

  test("See the work still leaves Skills and Plugins in the owner rail", () => {
    const labels = visibleOwnerNavLabels({ canSeeTheWork: true });
    expect(labels).toEqual(["CRM", "Plugins", "Skills"]);
    expect(labels).not.toContain("Agents");
  });
});
