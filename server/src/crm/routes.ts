import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import type { AppVariables, AuthenticatedActor } from "../auth/guards";
import type {
  CrmCampaignInput,
  CrmCompanyInput,
  CrmConversationInput,
  CrmCreatedBy,
  CrmListQuery,
  CrmOpportunityInput,
  CrmPersonInput,
  CrmStore,
} from "./store";

/**
 * The signed-in person's CRM writes, as HTTP.
 *
 * Bot writes do not come through here. They go through the gateway so every call is resolved,
 * decided, audited, and only then acted on. This surface is a person at a table, already
 * authenticated, writing a row they can see.
 */
export function createCrmRoutes(
  store: CrmStore,
  requireUser: MiddlewareHandler<{ Variables: AppVariables }>,
) {
  const routes = new Hono<{ Variables: AppVariables }>();

  routes.get("/people", requireUser, async (context) => {
    const page = await store.listPeople(listQuery(context.req.url));
    return context.json({
      people: page.items,
      nextCursor: page.nextCursor,
      total: page.total,
    });
  });
  routes.get("/people/:id", requireUser, async (context) => {
    const person = await store.getPerson(context.req.param("id"));
    if (!person)
      return context.json({ error: "That person is not here." }, 404);
    return context.json({ person });
  });
  routes.post("/people", requireUser, async (context) => {
    const parsed = parsePersonInput(await context.req.json().catch(() => null));
    if (!parsed.ok) return context.json({ error: parsed.error }, 400);
    try {
      const person = await store.createPerson(
        parsed.value,
        createdByFromActor(context.var.actor),
      );
      return context.json({ person }, 201);
    } catch (error) {
      return context.json({ error: messageOf(error) }, 400);
    }
  });
  routes.patch("/people/:id", requireUser, async (context) => {
    const parsed = parsePersonPatch(await context.req.json().catch(() => null));
    if (!parsed.ok) return context.json({ error: parsed.error }, 400);
    try {
      const person = await store.updatePerson(
        context.req.param("id"),
        parsed.value,
      );
      if (!person)
        return context.json({ error: "That person is not here." }, 404);
      return context.json({ person });
    } catch (error) {
      return context.json({ error: messageOf(error) }, 400);
    }
  });

  routes.get("/companies", requireUser, async (context) => {
    const page = await store.listCompanies(listQuery(context.req.url));
    return context.json({
      companies: page.items,
      nextCursor: page.nextCursor,
      total: page.total,
    });
  });
  routes.get("/companies/:id", requireUser, async (context) => {
    const company = await store.getCompany(context.req.param("id"));
    if (!company)
      return context.json({ error: "That company is not here." }, 404);
    return context.json({ company });
  });
  routes.post("/companies", requireUser, async (context) => {
    const parsed = parseCompanyInput(
      await context.req.json().catch(() => null),
    );
    if (!parsed.ok) return context.json({ error: parsed.error }, 400);
    try {
      const company = await store.createCompany(
        parsed.value,
        createdByFromActor(context.var.actor),
      );
      return context.json({ company }, 201);
    } catch (error) {
      return context.json({ error: messageOf(error) }, 400);
    }
  });
  routes.patch("/companies/:id", requireUser, async (context) => {
    const parsed = parseCompanyPatch(
      await context.req.json().catch(() => null),
    );
    if (!parsed.ok) return context.json({ error: parsed.error }, 400);
    try {
      const company = await store.updateCompany(
        context.req.param("id"),
        parsed.value,
      );
      if (!company)
        return context.json({ error: "That company is not here." }, 404);
      return context.json({ company });
    } catch (error) {
      return context.json({ error: messageOf(error) }, 400);
    }
  });

  routes.get("/opportunities", requireUser, async (context) => {
    const page = await store.listOpportunities(listQuery(context.req.url));
    return context.json({
      opportunities: page.items,
      nextCursor: page.nextCursor,
      total: page.total,
    });
  });
  routes.get("/opportunities/:id", requireUser, async (context) => {
    const opportunity = await store.getOpportunity(context.req.param("id"));
    if (!opportunity)
      return context.json({ error: "That opportunity is not here." }, 404);
    return context.json({ opportunity });
  });
  routes.post("/opportunities", requireUser, async (context) => {
    const parsed = parseOpportunityInput(
      await context.req.json().catch(() => null),
    );
    if (!parsed.ok) return context.json({ error: parsed.error }, 400);
    try {
      const opportunity = await store.createOpportunity(
        parsed.value,
        createdByFromActor(context.var.actor),
      );
      return context.json({ opportunity }, 201);
    } catch (error) {
      return context.json({ error: messageOf(error) }, 400);
    }
  });
  routes.patch("/opportunities/:id", requireUser, async (context) => {
    const parsed = parseOpportunityPatch(
      await context.req.json().catch(() => null),
    );
    if (!parsed.ok) return context.json({ error: parsed.error }, 400);
    try {
      const opportunity = await store.updateOpportunity(
        context.req.param("id"),
        parsed.value,
      );
      if (!opportunity)
        return context.json({ error: "That opportunity is not here." }, 404);
      return context.json({ opportunity });
    } catch (error) {
      return context.json({ error: messageOf(error) }, 400);
    }
  });

  routes.get("/campaigns", requireUser, async (context) => {
    const page = await store.listCampaigns(listQuery(context.req.url));
    return context.json({
      campaigns: page.items,
      nextCursor: page.nextCursor,
      total: page.total,
    });
  });
  routes.get("/campaigns/:id", requireUser, async (context) => {
    const campaign = await store.getCampaign(context.req.param("id"));
    if (!campaign)
      return context.json({ error: "That campaign is not here." }, 404);
    return context.json({ campaign });
  });
  routes.post("/campaigns", requireUser, async (context) => {
    const parsed = parseCampaignInput(
      await context.req.json().catch(() => null),
    );
    if (!parsed.ok) return context.json({ error: parsed.error }, 400);
    try {
      const campaign = await store.createCampaign(
        parsed.value,
        createdByFromActor(context.var.actor),
      );
      return context.json({ campaign }, 201);
    } catch (error) {
      return context.json({ error: messageOf(error) }, 400);
    }
  });
  routes.patch("/campaigns/:id", requireUser, async (context) => {
    const parsed = parseCampaignPatch(
      await context.req.json().catch(() => null),
    );
    if (!parsed.ok) return context.json({ error: parsed.error }, 400);
    try {
      const campaign = await store.updateCampaign(
        context.req.param("id"),
        parsed.value,
      );
      if (!campaign)
        return context.json({ error: "That campaign is not here." }, 404);
      return context.json({ campaign });
    } catch (error) {
      return context.json({ error: messageOf(error) }, 400);
    }
  });

  routes.get("/conversations", requireUser, async (context) => {
    const page = await store.listConversations(listQuery(context.req.url));
    return context.json({
      conversations: page.items,
      nextCursor: page.nextCursor,
      total: page.total,
    });
  });
  routes.get("/conversations/:id", requireUser, async (context) => {
    const conversation = await store.getConversation(context.req.param("id"));
    if (!conversation)
      return context.json({ error: "That conversation is not here." }, 404);
    return context.json({ conversation });
  });
  routes.post("/conversations", requireUser, async (context) => {
    const parsed = parseConversationInput(
      await context.req.json().catch(() => null),
    );
    if (!parsed.ok) return context.json({ error: parsed.error }, 400);
    try {
      const conversation = await store.createConversation(
        parsed.value,
        createdByFromActor(context.var.actor),
      );
      return context.json({ conversation }, 201);
    } catch (error) {
      return context.json({ error: messageOf(error) }, 400);
    }
  });
  routes.patch("/conversations/:id", requireUser, async (context) => {
    const parsed = parseConversationPatch(
      await context.req.json().catch(() => null),
    );
    if (!parsed.ok) return context.json({ error: parsed.error }, 400);
    try {
      const conversation = await store.updateConversation(
        context.req.param("id"),
        parsed.value,
      );
      if (!conversation)
        return context.json({ error: "That conversation is not here." }, 404);
      return context.json({ conversation });
    } catch (error) {
      return context.json({ error: messageOf(error) }, 400);
    }
  });

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
  return {
    ...(parsed.searchParams.get("search")
      ? { search: parsed.searchParams.get("search") as string }
      : {}),
    ...(parsed.searchParams.get("cursor")
      ? { cursor: parsed.searchParams.get("cursor") as string }
      : {}),
    ...(Number.isFinite(limit) ? { limit } : {}),
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "That write could not be saved.";
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
  return {
    ok: true,
    value: {
      name: name.value,
      ...(emails.value ? { emails: emails.value } : {}),
      ...(phones.value ? { phones: phones.value } : {}),
      ...(jobTitle.value !== undefined ? { jobTitle: jobTitle.value } : {}),
      ...(companyId.value !== undefined ? { companyId: companyId.value } : {}),
      ...(notes.value !== undefined ? { notes: notes.value } : {}),
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
  return {
    ok: true,
    value: {
      ...(typeof body.name === "string" ? { name: body.name } : {}),
      ...(emails.value ? { emails: emails.value } : {}),
      ...(phones.value ? { phones: phones.value } : {}),
      ...(jobTitle.value !== undefined ? { jobTitle: jobTitle.value } : {}),
      ...(companyId.value !== undefined ? { companyId: companyId.value } : {}),
      ...(notes.value !== undefined ? { notes: notes.value } : {}),
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
