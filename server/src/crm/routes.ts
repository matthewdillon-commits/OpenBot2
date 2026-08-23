import type { Context, MiddlewareHandler } from "hono";
import { Hono } from "hono";
import {
  type AppVariables,
  type AuthenticatedActor,
  requireActiveOrganization,
} from "../auth/guards";
import { orgIdOf } from "../orgs/constants";
import { deliverSend, trackingOrigin } from "./deliver";
import { CONTACT_STAGE_DEFS, DEAL_STAGE_DEFS } from "./stages";
import type {
  CrmCampaignInput,
  CrmCampaignListInput,
  CrmCompanyInput,
  CrmConversationInput,
  CrmCreatedBy,
  CrmListQuery,
  CrmOpportunityInput,
  CrmPersonInput,
  CrmSendInput,
  CrmSendKind,
  CrmStore,
} from "./store";

const PIXEL = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==",
  "base64",
);

/**
 * The signed-in person's CRM writes, as HTTP.
 *
 * Bot writes do not come through here. They go through the gateway so every call is resolved,
 * decided, audited, and only then acted on. Tracking pixels are unauthenticated on purpose: the
 * token is the capability.
 */
export function createCrmRoutes(
  store: CrmStore,
  requireUser: MiddlewareHandler<{ Variables: AppVariables }>,
) {
  const routes = new Hono<{ Variables: AppVariables }>();

  routes.get("/track/open/:token", async (context) => {
    const token = context.req.param("token").replace(/\.gif$/i, "");
    const send = await store.findSendByTrackingToken(token);
    if (send) {
      await store.recordSendEvent({ sendId: send.id, eventType: "opened" });
    }
    return new Response(PIXEL, {
      status: 200,
      headers: {
        "content-type": "image/gif",
        "cache-control": "no-store, no-cache, must-revalidate, max-age=0",
      },
    });
  });

  routes.get("/track/click/:token", async (context) => {
    const token = context.req.param("token");
    const target = context.req.query("u") ?? "";
    const send = await store.findSendByTrackingToken(token);
    if (!send || !isHttpUrl(target)) {
      return context.json({ error: "That link is not here." }, 400);
    }
    await store.recordSendEvent({
      sendId: send.id,
      eventType: "clicked",
      linkUrl: target,
    });
    return context.redirect(target, 302);
  });

  const withOrg = async (
    context: Context<{ Variables: AppVariables }>,
    run: (orgId: string) => Promise<Response>,
  ) => {
    const denied = requireActiveOrganization(context);
    if (denied) return denied;
    return run(orgIdOf(context.var.actor));
  };

  routes.get("/stages", requireUser, async (context) =>
    withOrg(context, async () =>
      context.json({
        people: CONTACT_STAGE_DEFS,
        opportunities: DEAL_STAGE_DEFS,
      }),
    ),
  );

  routes.get("/threads", requireUser, async (context) =>
    withOrg(context, async (orgId) => {
      const page = await store.listThreads({
        ...listQuery(context.req.url),
        orgId,
      });
      return context.json({
        threads: page.items,
        nextCursor: page.nextCursor,
        total: page.total,
      });
    }),
  );

  routes.get("/people", requireUser, async (context) =>
    withOrg(context, async (orgId) => {
      const page = await store.listPeople({
        ...listQuery(context.req.url),
        orgId,
      });
      return context.json({
        people: page.items,
        nextCursor: page.nextCursor,
        total: page.total,
        stageCounts: page.stageCounts ?? {},
        totalAllStages: page.totalAllStages ?? page.total,
      });
    }),
  );
  routes.get("/people/:id", requireUser, async (context) =>
    withOrg(context, async (orgId) => {
      const person = await store.getPerson(orgId, context.req.param("id"));
      if (!person)
        return context.json({ error: "That person is not here." }, 404);
      return context.json({ person });
    }),
  );
  routes.post("/people", requireUser, async (context) =>
    withOrg(context, async (orgId) => {
      const parsed = parsePersonInput(
        await context.req.json().catch(() => null),
      );
      if (!parsed.ok) return context.json({ error: parsed.error }, 400);
      try {
        const person = await store.createPerson(
          orgId,
          parsed.value,
          createdByFromActor(context.var.actor),
        );
        return context.json({ person }, 201);
      } catch (error) {
        return context.json({ error: messageOf(error) }, 400);
      }
    }),
  );
  routes.patch("/people/:id", requireUser, async (context) =>
    withOrg(context, async (orgId) => {
      const parsed = parsePersonPatch(
        await context.req.json().catch(() => null),
      );
      if (!parsed.ok) return context.json({ error: parsed.error }, 400);
      try {
        const person = await store.updatePerson(
          orgId,
          context.req.param("id"),
          parsed.value,
        );
        if (!person)
          return context.json({ error: "That person is not here." }, 404);
        return context.json({ person });
      } catch (error) {
        return context.json({ error: messageOf(error) }, 400);
      }
    }),
  );

  routes.get("/companies", requireUser, async (context) =>
    withOrg(context, async (orgId) => {
      const page = await store.listCompanies({
        ...listQuery(context.req.url),
        orgId,
      });
      return context.json({
        companies: page.items,
        nextCursor: page.nextCursor,
        total: page.total,
      });
    }),
  );
  routes.get("/companies/:id", requireUser, async (context) =>
    withOrg(context, async (orgId) => {
      const company = await store.getCompany(orgId, context.req.param("id"));
      if (!company)
        return context.json({ error: "That company is not here." }, 404);
      return context.json({ company });
    }),
  );
  routes.post("/companies", requireUser, async (context) =>
    withOrg(context, async (orgId) => {
      const parsed = parseCompanyInput(
        await context.req.json().catch(() => null),
      );
      if (!parsed.ok) return context.json({ error: parsed.error }, 400);
      try {
        const company = await store.createCompany(
          orgId,
          parsed.value,
          createdByFromActor(context.var.actor),
        );
        return context.json({ company }, 201);
      } catch (error) {
        return context.json({ error: messageOf(error) }, 400);
      }
    }),
  );
  routes.patch("/companies/:id", requireUser, async (context) =>
    withOrg(context, async (orgId) => {
      const parsed = parseCompanyPatch(
        await context.req.json().catch(() => null),
      );
      if (!parsed.ok) return context.json({ error: parsed.error }, 400);
      try {
        const company = await store.updateCompany(
          orgId,
          context.req.param("id"),
          parsed.value,
        );
        if (!company)
          return context.json({ error: "That company is not here." }, 404);
        return context.json({ company });
      } catch (error) {
        return context.json({ error: messageOf(error) }, 400);
      }
    }),
  );

  routes.get("/opportunities", requireUser, async (context) =>
    withOrg(context, async (orgId) => {
      const page = await store.listOpportunities({
        ...listQuery(context.req.url),
        orgId,
      });
      return context.json({
        opportunities: page.items,
        nextCursor: page.nextCursor,
        total: page.total,
      });
    }),
  );
  routes.get("/opportunities/:id", requireUser, async (context) =>
    withOrg(context, async (orgId) => {
      const opportunity = await store.getOpportunity(
        orgId,
        context.req.param("id"),
      );
      if (!opportunity)
        return context.json({ error: "That opportunity is not here." }, 404);
      return context.json({ opportunity });
    }),
  );
  routes.post("/opportunities", requireUser, async (context) =>
    withOrg(context, async (orgId) => {
      const parsed = parseOpportunityInput(
        await context.req.json().catch(() => null),
      );
      if (!parsed.ok) return context.json({ error: parsed.error }, 400);
      try {
        const opportunity = await store.createOpportunity(
          orgId,
          parsed.value,
          createdByFromActor(context.var.actor),
        );
        return context.json({ opportunity }, 201);
      } catch (error) {
        return context.json({ error: messageOf(error) }, 400);
      }
    }),
  );
  routes.patch("/opportunities/:id", requireUser, async (context) =>
    withOrg(context, async (orgId) => {
      const parsed = parseOpportunityPatch(
        await context.req.json().catch(() => null),
      );
      if (!parsed.ok) return context.json({ error: parsed.error }, 400);
      try {
        const opportunity = await store.updateOpportunity(
          orgId,
          context.req.param("id"),
          parsed.value,
        );
        if (!opportunity)
          return context.json({ error: "That opportunity is not here." }, 404);
        return context.json({ opportunity });
      } catch (error) {
        return context.json({ error: messageOf(error) }, 400);
      }
    }),
  );

  routes.get("/campaigns", requireUser, async (context) =>
    withOrg(context, async (orgId) => {
      const page = await store.listCampaigns({
        ...listQuery(context.req.url),
        orgId,
      });
      return context.json({
        campaigns: page.items,
        nextCursor: page.nextCursor,
        total: page.total,
      });
    }),
  );
  routes.get("/campaigns/:id", requireUser, async (context) =>
    withOrg(context, async (orgId) => {
      const campaign = await store.getCampaign(orgId, context.req.param("id"));
      if (!campaign)
        return context.json({ error: "That campaign is not here." }, 404);
      const lists = await store.listCampaignLists(orgId, campaign.id);
      return context.json({ campaign, lists });
    }),
  );
  routes.get("/campaigns/:id/lists", requireUser, async (context) =>
    withOrg(context, async (orgId) => {
      const campaign = await store.getCampaign(orgId, context.req.param("id"));
      if (!campaign)
        return context.json({ error: "That campaign is not here." }, 404);
      const lists = await store.listCampaignLists(orgId, campaign.id);
      return context.json({ lists });
    }),
  );
  routes.post("/campaigns/:id/lists", requireUser, async (context) =>
    withOrg(context, async (orgId) => {
      const parsed = parseCampaignListInput(
        await context.req.json().catch(() => null),
      );
      if (!parsed.ok) return context.json({ error: parsed.error }, 400);
      try {
        const list = await store.createCampaignList(
          orgId,
          context.req.param("id"),
          parsed.value,
        );
        return context.json({ list }, 201);
      } catch (error) {
        return context.json({ error: messageOf(error) }, 400);
      }
    }),
  );
  routes.get("/lists/:id/members", requireUser, async (context) =>
    withOrg(context, async (orgId) => {
      const page = await store.listCampaignListMembers(
        orgId,
        context.req.param("id"),
      );
      return context.json({
        people: page.items,
        contacts: page.items,
        total: page.total,
      });
    }),
  );
  routes.post("/lists/:id/members", requireUser, async (context) =>
    withOrg(context, async (orgId) => {
      const ids = personIdsFrom(await context.req.json().catch(() => null));
      if (!ids.ok) return context.json({ error: ids.error }, 400);
      try {
        const result = await store.addCampaignListMembers(
          orgId,
          context.req.param("id"),
          ids.value,
        );
        return context.json(result);
      } catch (error) {
        return context.json({ error: messageOf(error) }, 400);
      }
    }),
  );
  routes.delete("/lists/:id/members", requireUser, async (context) =>
    withOrg(context, async (orgId) => {
      const ids = personIdsFrom(await context.req.json().catch(() => null));
      if (!ids.ok) return context.json({ error: ids.error }, 400);
      try {
        const result = await store.removeCampaignListMembers(
          orgId,
          context.req.param("id"),
          ids.value,
        );
        return context.json(result);
      } catch (error) {
        return context.json({ error: messageOf(error) }, 400);
      }
    }),
  );
  routes.post("/campaigns", requireUser, async (context) =>
    withOrg(context, async (orgId) => {
      const parsed = parseCampaignInput(
        await context.req.json().catch(() => null),
      );
      if (!parsed.ok) return context.json({ error: parsed.error }, 400);
      try {
        const campaign = await store.createCampaign(
          orgId,
          parsed.value,
          createdByFromActor(context.var.actor),
        );
        return context.json({ campaign }, 201);
      } catch (error) {
        return context.json({ error: messageOf(error) }, 400);
      }
    }),
  );
  routes.patch("/campaigns/:id", requireUser, async (context) =>
    withOrg(context, async (orgId) => {
      const parsed = parseCampaignPatch(
        await context.req.json().catch(() => null),
      );
      if (!parsed.ok) return context.json({ error: parsed.error }, 400);
      try {
        const campaign = await store.updateCampaign(
          orgId,
          context.req.param("id"),
          parsed.value,
        );
        if (!campaign)
          return context.json({ error: "That campaign is not here." }, 404);
        return context.json({ campaign });
      } catch (error) {
        return context.json({ error: messageOf(error) }, 400);
      }
    }),
  );

  routes.get("/conversations", requireUser, async (context) =>
    withOrg(context, async (orgId) => {
      const page = await store.listConversations({
        ...listQuery(context.req.url),
        orgId,
      });
      return context.json({
        conversations: page.items,
        nextCursor: page.nextCursor,
        total: page.total,
      });
    }),
  );
  routes.get("/conversations/:id", requireUser, async (context) =>
    withOrg(context, async (orgId) => {
      const conversation = await store.getConversation(
        orgId,
        context.req.param("id"),
      );
      if (!conversation)
        return context.json({ error: "That conversation is not here." }, 404);
      return context.json({ conversation });
    }),
  );
  routes.post("/conversations", requireUser, async (context) =>
    withOrg(context, async (orgId) => {
      const parsed = parseConversationInput(
        await context.req.json().catch(() => null),
      );
      if (!parsed.ok) return context.json({ error: parsed.error }, 400);
      try {
        const conversation = await store.createConversation(
          orgId,
          parsed.value,
          createdByFromActor(context.var.actor),
        );
        return context.json({ conversation }, 201);
      } catch (error) {
        return context.json({ error: messageOf(error) }, 400);
      }
    }),
  );
  routes.patch("/conversations/:id", requireUser, async (context) =>
    withOrg(context, async (orgId) => {
      const parsed = parseConversationPatch(
        await context.req.json().catch(() => null),
      );
      if (!parsed.ok) return context.json({ error: parsed.error }, 400);
      try {
        const conversation = await store.updateConversation(
          orgId,
          context.req.param("id"),
          parsed.value,
        );
        if (!conversation)
          return context.json({ error: "That conversation is not here." }, 404);
        return context.json({ conversation });
      } catch (error) {
        return context.json({ error: messageOf(error) }, 400);
      }
    }),
  );

  routes.get("/sends", requireUser, async (context) =>
    withOrg(context, async (orgId) => {
      const page = await store.listSends({
        ...listQuery(context.req.url),
        orgId,
      });
      return context.json({
        sends: page.items,
        nextCursor: page.nextCursor,
        total: page.total,
      });
    }),
  );
  routes.get("/sends/:id", requireUser, async (context) =>
    withOrg(context, async (orgId) => {
      const send = await store.getSend(orgId, context.req.param("id"));
      if (!send) return context.json({ error: "That send is not here." }, 404);
      const events = await store.listSendEvents(orgId, send.id);
      return context.json({ send, events });
    }),
  );
  routes.post("/sends", requireUser, async (context) =>
    withOrg(context, async (orgId) => {
      const parsed = parseSendInput(await context.req.json().catch(() => null));
      if (!parsed.ok) return context.json({ error: parsed.error }, 400);
      try {
        const created = await store.createSend(
          orgId,
          parsed.value,
          createdByFromActor(context.var.actor),
        );
        const send = await deliverSend({
          store,
          orgId,
          send: created,
          publicOrigin: trackingOrigin(context.req.url),
        });
        return context.json({ send }, 201);
      } catch (error) {
        return context.json({ error: messageOf(error) }, 400);
      }
    }),
  );

  return routes;
}

export function createdByFromActor(actor: AuthenticatedActor): CrmCreatedBy {
  return {
    kind: "user",
    id: actor.id,
    name: actor.name?.trim() || actor.email,
  };
}

function listQuery(url: string): CrmListQuery {
  const parsed = new URL(url);
  const limit = Number.parseInt(parsed.searchParams.get("limit") ?? "", 10);
  const kind = parsed.searchParams.get("kind");
  return {
    ...(parsed.searchParams.get("search")
      ? { search: parsed.searchParams.get("search") as string }
      : {}),
    ...(parsed.searchParams.get("cursor")
      ? { cursor: parsed.searchParams.get("cursor") as string }
      : {}),
    ...(parsed.searchParams.get("campaignId")
      ? { campaignId: parsed.searchParams.get("campaignId") as string }
      : {}),
    ...(parsed.searchParams.get("personId")
      ? { personId: parsed.searchParams.get("personId") as string }
      : {}),
    ...(kind === "email" || kind === "sms" || kind === "call" ? { kind } : {}),
    ...(parsed.searchParams.get("stage")
      ? { stage: parsed.searchParams.get("stage") as string }
      : {}),
    ...(Number.isFinite(limit) ? { limit } : {}),
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "That write could not be saved.";
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function optionalString(
  value: unknown,
):
  | { ok: true; value: string | null | undefined }
  | { ok: false; error: string } {
  if (value === undefined) return { ok: true, value: undefined };
  if (value === null) return { ok: true, value: null };
  if (typeof value !== "string")
    return { ok: false, error: "Expected a string." };
  return { ok: true, value };
}

function optionalBoolean(
  value: unknown,
): { ok: true; value: boolean | undefined } | { ok: false; error: string } {
  if (value === undefined) return { ok: true, value: undefined };
  if (typeof value !== "boolean")
    return { ok: false, error: "Expected a boolean." };
  return { ok: true, value };
}

function optionalStringList(
  value: unknown,
): { ok: true; value: string[] | undefined } | { ok: false; error: string } {
  if (value === undefined) return { ok: true, value: undefined };
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== "string")
  ) {
    return { ok: false, error: "Expected a list of strings." };
  }
  return { ok: true, value };
}

function requiredName(body: Record<string, unknown>): ParseResult<string> {
  if (typeof body.name !== "string" || !body.name.trim()) {
    return { ok: false, error: "A name is required." };
  }
  return { ok: true, value: body.name };
}

function parsePersonExtras(
  body: Record<string, unknown>,
): ParseResult<
  Pick<CrmPersonInput, "linkedinUrl" | "location" | "timezone" | "source">
> {
  const linkedinUrl = optionalString(body.linkedinUrl);
  if (!linkedinUrl.ok)
    return { ok: false, error: "linkedinUrl must be a string." };
  const location = optionalString(body.location);
  if (!location.ok) return { ok: false, error: "location must be a string." };
  const timezone = optionalString(body.timezone);
  if (!timezone.ok) return { ok: false, error: "timezone must be a string." };
  const source = optionalString(body.source);
  if (!source.ok) return { ok: false, error: "source must be a string." };
  return {
    ok: true,
    value: {
      ...(linkedinUrl.value !== undefined
        ? { linkedinUrl: linkedinUrl.value }
        : {}),
      ...(location.value !== undefined ? { location: location.value } : {}),
      ...(timezone.value !== undefined ? { timezone: timezone.value } : {}),
      ...(source.value !== undefined ? { source: source.value } : {}),
    },
  };
}

function parseCampaignListInput(
  value: unknown,
): ParseResult<CrmCampaignListInput> {
  const body = asObject(value);
  if (!body) return { ok: false, error: "List input must be a JSON object." };
  const name = requiredName(body);
  if (!name.ok) return name;
  const description = optionalString(body.description);
  if (!description.ok)
    return { ok: false, error: "description must be a string." };
  return {
    ok: true,
    value: {
      name: name.value,
      ...(description.value !== undefined
        ? { description: description.value }
        : {}),
    },
  };
}

function personIdsFrom(value: unknown): ParseResult<string[]> {
  const body = asObject(value);
  if (!body) return { ok: false, error: "Member input must be a JSON object." };
  const raw = body.personIds ?? body.contactIds;
  const single = body.personId ?? body.contactId;
  const ids = Array.isArray(raw)
    ? raw
    : typeof single === "string"
      ? [single]
      : [];
  if (ids.length === 0 || ids.some((id) => typeof id !== "string" || !id)) {
    return { ok: false, error: "personIds required" };
  }
  return { ok: true, value: ids as string[] };
}

export function parsePersonInput(value: unknown): ParseResult<CrmPersonInput> {
  const body = asObject(value);
  if (!body) return { ok: false, error: "Person input must be a JSON object." };
  const name = requiredName(body);
  if (!name.ok) return name;
  const emails = optionalStringList(body.emails);
  if (!emails.ok) return emails;
  const phones = optionalStringList(body.phones);
  if (!phones.ok) return phones;
  const jobTitle = optionalString(body.jobTitle);
  if (!jobTitle.ok) return { ok: false, error: "jobTitle must be a string." };
  const companyId = optionalString(body.companyId);
  if (!companyId.ok) return { ok: false, error: "companyId must be a string." };
  const notes = optionalString(body.notes);
  if (!notes.ok) return { ok: false, error: "notes must be a string." };
  const stageKey = optionalString(body.stageKey ?? body.stage);
  if (!stageKey.ok) return { ok: false, error: "stageKey must be a string." };
  const doNotContact = optionalBoolean(body.doNotContact);
  if (!doNotContact.ok)
    return { ok: false, error: "doNotContact must be a boolean." };
  const extras = parsePersonExtras(body);
  if (!extras.ok) return extras;
  return {
    ok: true,
    value: {
      name: name.value,
      ...(emails.value ? { emails: emails.value } : {}),
      ...(phones.value ? { phones: phones.value } : {}),
      ...(jobTitle.value !== undefined ? { jobTitle: jobTitle.value } : {}),
      ...(companyId.value !== undefined ? { companyId: companyId.value } : {}),
      ...(stageKey.value ? { stageKey: stageKey.value } : {}),
      ...(doNotContact.value !== undefined
        ? { doNotContact: doNotContact.value }
        : {}),
      ...(notes.value !== undefined ? { notes: notes.value } : {}),
      ...extras.value,
    },
  };
}

export function parsePersonPatch(
  value: unknown,
): ParseResult<Partial<CrmPersonInput>> {
  const body = asObject(value);
  if (!body) return { ok: false, error: "Person input must be a JSON object." };
  if (
    body.name !== undefined &&
    (typeof body.name !== "string" || !body.name.trim())
  ) {
    return { ok: false, error: "A name is required." };
  }
  const emails = optionalStringList(body.emails);
  if (!emails.ok) return emails;
  const phones = optionalStringList(body.phones);
  if (!phones.ok) return phones;
  const jobTitle = optionalString(body.jobTitle);
  if (!jobTitle.ok) return { ok: false, error: "jobTitle must be a string." };
  const companyId = optionalString(body.companyId);
  if (!companyId.ok) return { ok: false, error: "companyId must be a string." };
  const notes = optionalString(body.notes);
  if (!notes.ok) return { ok: false, error: "notes must be a string." };
  const stageKey = optionalString(body.stageKey ?? body.stage);
  if (!stageKey.ok) return { ok: false, error: "stageKey must be a string." };
  const doNotContact = optionalBoolean(body.doNotContact);
  if (!doNotContact.ok)
    return { ok: false, error: "doNotContact must be a boolean." };
  const extras = parsePersonExtras(body);
  if (!extras.ok) return extras;
  return {
    ok: true,
    value: {
      ...(typeof body.name === "string" ? { name: body.name } : {}),
      ...(emails.value ? { emails: emails.value } : {}),
      ...(phones.value ? { phones: phones.value } : {}),
      ...(jobTitle.value !== undefined ? { jobTitle: jobTitle.value } : {}),
      ...(companyId.value !== undefined ? { companyId: companyId.value } : {}),
      ...(stageKey.value !== undefined && stageKey.value !== null
        ? { stageKey: stageKey.value }
        : {}),
      ...(doNotContact.value !== undefined
        ? { doNotContact: doNotContact.value }
        : {}),
      ...(notes.value !== undefined ? { notes: notes.value } : {}),
      ...extras.value,
    },
  };
}

export function parseCompanyInput(
  value: unknown,
): ParseResult<CrmCompanyInput> {
  const body = asObject(value);
  if (!body)
    return { ok: false, error: "Company input must be a JSON object." };
  const name = requiredName(body);
  if (!name.ok) return name;
  const domain = optionalString(body.domain);
  if (!domain.ok) return { ok: false, error: "domain must be a string." };
  const website = optionalString(body.website);
  if (!website.ok) return { ok: false, error: "website must be a string." };
  const industry = optionalString(body.industry);
  if (!industry.ok) return { ok: false, error: "industry must be a string." };
  const phone = optionalString(body.phone);
  if (!phone.ok) return { ok: false, error: "phone must be a string." };
  const location = optionalString(body.location);
  if (!location.ok) return { ok: false, error: "location must be a string." };
  const notes = optionalString(body.notes);
  if (!notes.ok) return { ok: false, error: "notes must be a string." };
  return {
    ok: true,
    value: {
      name: name.value,
      ...(domain.value !== undefined ? { domain: domain.value } : {}),
      ...(website.value !== undefined ? { website: website.value } : {}),
      ...(industry.value !== undefined ? { industry: industry.value } : {}),
      ...(phone.value !== undefined ? { phone: phone.value } : {}),
      ...(location.value !== undefined ? { location: location.value } : {}),
      ...(notes.value !== undefined ? { notes: notes.value } : {}),
    },
  };
}

export function parseCompanyPatch(
  value: unknown,
): ParseResult<Partial<CrmCompanyInput>> {
  const parsed = parseCompanyInput({
    name: "placeholder",
    ...(asObject(value) ?? {}),
  });
  if (!parsed.ok) return parsed;
  const body = asObject(value);
  if (!body)
    return { ok: false, error: "Company input must be a JSON object." };
  if (
    body.name !== undefined &&
    (typeof body.name !== "string" || !body.name.trim())
  ) {
    return { ok: false, error: "A name is required." };
  }
  const { name: _name, ...rest } = parsed.value;
  return {
    ok: true,
    value: {
      ...(typeof body.name === "string" ? { name: body.name } : {}),
      ...rest,
    },
  };
}

export function parseOpportunityInput(
  value: unknown,
): ParseResult<CrmOpportunityInput> {
  const body = asObject(value);
  if (!body)
    return { ok: false, error: "Opportunity input must be a JSON object." };
  const name = requiredName(body);
  if (!name.ok) return name;
  if (
    body.amountCents !== undefined &&
    body.amountCents !== null &&
    (typeof body.amountCents !== "number" || !Number.isFinite(body.amountCents))
  ) {
    return { ok: false, error: "amountCents must be a number." };
  }
  const stage = optionalString(body.stage);
  if (!stage.ok) return { ok: false, error: "stage must be a string." };
  if (
    body.position !== undefined &&
    body.position !== null &&
    (typeof body.position !== "number" || !Number.isFinite(body.position))
  ) {
    return { ok: false, error: "position must be a number." };
  }
  const currency = optionalString(body.currency);
  if (!currency.ok) return { ok: false, error: "currency must be a string." };
  const companyId = optionalString(body.companyId);
  if (!companyId.ok) return { ok: false, error: "companyId must be a string." };
  const personId = optionalString(body.personId);
  if (!personId.ok) return { ok: false, error: "personId must be a string." };
  const expectedCloseAt = optionalString(body.expectedCloseAt);
  if (!expectedCloseAt.ok)
    return { ok: false, error: "expectedCloseAt must be a string." };
  const notes = optionalString(body.notes);
  if (!notes.ok) return { ok: false, error: "notes must be a string." };
  return {
    ok: true,
    value: {
      name: name.value,
      ...(stage.value ? { stage: stage.value } : {}),
      ...(typeof body.position === "number" ? { position: body.position } : {}),
      ...(body.amountCents !== undefined
        ? { amountCents: body.amountCents as number | null }
        : {}),
      ...(currency.value ? { currency: currency.value } : {}),
      ...(companyId.value !== undefined ? { companyId: companyId.value } : {}),
      ...(personId.value !== undefined ? { personId: personId.value } : {}),
      ...(expectedCloseAt.value !== undefined
        ? { expectedCloseAt: expectedCloseAt.value }
        : {}),
      ...(notes.value !== undefined ? { notes: notes.value } : {}),
    },
  };
}

export function parseOpportunityPatch(
  value: unknown,
): ParseResult<Partial<CrmOpportunityInput>> {
  const body = asObject(value);
  if (!body)
    return { ok: false, error: "Opportunity input must be a JSON object." };
  const parsed = parseOpportunityInput({ name: "placeholder", ...body });
  if (!parsed.ok) return parsed;
  if (
    body.name !== undefined &&
    (typeof body.name !== "string" || !body.name.trim())
  ) {
    return { ok: false, error: "A name is required." };
  }
  const { name: _name, ...rest } = parsed.value;
  return {
    ok: true,
    value: {
      ...(typeof body.name === "string" ? { name: body.name } : {}),
      ...rest,
    },
  };
}

export function parseCampaignInput(
  value: unknown,
): ParseResult<CrmCampaignInput> {
  const body = asObject(value);
  if (!body)
    return { ok: false, error: "Campaign input must be a JSON object." };
  const name = requiredName(body);
  if (!name.ok) return name;
  const status = optionalString(body.status);
  if (!status.ok) return { ok: false, error: "status must be a string." };
  const description = optionalString(body.description);
  if (!description.ok)
    return { ok: false, error: "description must be a string." };
  const startedAt = optionalString(body.startedAt);
  if (!startedAt.ok) return { ok: false, error: "startedAt must be a string." };
  const endedAt = optionalString(body.endedAt);
  if (!endedAt.ok) return { ok: false, error: "endedAt must be a string." };
  const notes = optionalString(body.notes);
  if (!notes.ok) return { ok: false, error: "notes must be a string." };
  return {
    ok: true,
    value: {
      name: name.value,
      ...(status.value ? { status: status.value } : {}),
      ...(description.value !== undefined
        ? { description: description.value }
        : {}),
      ...(startedAt.value !== undefined ? { startedAt: startedAt.value } : {}),
      ...(endedAt.value !== undefined ? { endedAt: endedAt.value } : {}),
      ...(notes.value !== undefined ? { notes: notes.value } : {}),
    },
  };
}

export function parseCampaignPatch(
  value: unknown,
): ParseResult<Partial<CrmCampaignInput>> {
  const body = asObject(value);
  if (!body)
    return { ok: false, error: "Campaign input must be a JSON object." };
  const parsed = parseCampaignInput({ name: "placeholder", ...body });
  if (!parsed.ok) return parsed;
  if (
    body.name !== undefined &&
    (typeof body.name !== "string" || !body.name.trim())
  ) {
    return { ok: false, error: "A name is required." };
  }
  const { name: _name, ...rest } = parsed.value;
  return {
    ok: true,
    value: {
      ...(typeof body.name === "string" ? { name: body.name } : {}),
      ...rest,
    },
  };
}

export function parseConversationInput(
  value: unknown,
): ParseResult<CrmConversationInput> {
  const body = asObject(value);
  if (!body)
    return { ok: false, error: "Conversation input must be a JSON object." };
  if (typeof body.subject !== "string" || !body.subject.trim()) {
    return { ok: false, error: "A subject is required." };
  }
  const channel = optionalString(body.channel);
  if (!channel.ok) return { ok: false, error: "channel must be a string." };
  const conversationBody = optionalString(body.body);
  if (!conversationBody.ok)
    return { ok: false, error: "body must be a string." };
  const personId = optionalString(body.personId);
  if (!personId.ok) return { ok: false, error: "personId must be a string." };
  const companyId = optionalString(body.companyId);
  if (!companyId.ok) return { ok: false, error: "companyId must be a string." };
  const occurredAt = optionalString(body.occurredAt);
  if (!occurredAt.ok)
    return { ok: false, error: "occurredAt must be a string." };
  return {
    ok: true,
    value: {
      subject: body.subject,
      ...(channel.value ? { channel: channel.value } : {}),
      ...(conversationBody.value !== undefined
        ? { body: conversationBody.value }
        : {}),
      ...(personId.value !== undefined ? { personId: personId.value } : {}),
      ...(companyId.value !== undefined ? { companyId: companyId.value } : {}),
      ...(occurredAt.value !== undefined
        ? { occurredAt: occurredAt.value }
        : {}),
    },
  };
}

export function parseConversationPatch(
  value: unknown,
): ParseResult<Partial<CrmConversationInput>> {
  const body = asObject(value);
  if (!body)
    return { ok: false, error: "Conversation input must be a JSON object." };
  const parsed = parseConversationInput({ subject: "placeholder", ...body });
  if (!parsed.ok) return parsed;
  if (
    body.subject !== undefined &&
    (typeof body.subject !== "string" || !body.subject.trim())
  ) {
    return { ok: false, error: "A subject is required." };
  }
  const { subject: _subject, ...rest } = parsed.value;
  return {
    ok: true,
    value: {
      ...(typeof body.subject === "string" ? { subject: body.subject } : {}),
      ...rest,
    },
  };
}

export function parseSendInput(value: unknown): ParseResult<CrmSendInput> {
  const body = asObject(value);
  if (!body) return { ok: false, error: "Send input must be a JSON object." };
  if (body.kind !== "email" && body.kind !== "sms" && body.kind !== "call") {
    return { ok: false, error: "kind must be email, sms, or call." };
  }
  if (typeof body.toAddress !== "string" || !body.toAddress.trim()) {
    return { ok: false, error: "A to address or number is required." };
  }
  const subject = optionalString(body.subject);
  if (!subject.ok) return { ok: false, error: "subject must be a string." };
  const sendBody = optionalString(body.body);
  if (!sendBody.ok) return { ok: false, error: "body must be a string." };
  const personId = optionalString(body.personId);
  if (!personId.ok) return { ok: false, error: "personId must be a string." };
  const companyId = optionalString(body.companyId);
  if (!companyId.ok) return { ok: false, error: "companyId must be a string." };
  const campaignId = optionalString(body.campaignId);
  if (!campaignId.ok)
    return { ok: false, error: "campaignId must be a string." };
  return {
    ok: true,
    value: {
      kind: body.kind as CrmSendKind,
      toAddress: body.toAddress,
      ...(subject.value !== undefined ? { subject: subject.value } : {}),
      ...(sendBody.value !== undefined ? { body: sendBody.value } : {}),
      ...(personId.value !== undefined ? { personId: personId.value } : {}),
      ...(companyId.value !== undefined ? { companyId: companyId.value } : {}),
      ...(campaignId.value !== undefined
        ? { campaignId: campaignId.value }
        : {}),
    },
  };
}
