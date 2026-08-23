import { randomBytes } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "../db/client";
import {
  crmCampaignListMembers,
  crmCampaignLists,
  crmCampaigns,
  crmCompanies,
  crmConversations,
  crmOpportunities,
  crmPeople,
  crmSendEvents,
  crmSends,
} from "../db/schema";
import { orgIdOf } from "../orgs/constants";
import { normalizeContactStage, normalizeDealStage } from "./stages";

/**
 * Who wrote a CRM row.
 *
 * A kind rather than a foreign key: a Bot and a signed-in person are not the same table, and a
 * system import has no row at all. The display name is stored beside the id so a later rename
 * still reads as who created it.
 */
export type CrmCreatedBy = {
  kind: "user" | "bot" | "system";
  id: string;
  name: string;
};

export type CrmCompany = {
  id: string;
  name: string;
  domain: string | null;
  website: string | null;
  industry: string | null;
  phone: string | null;
  location: string | null;
  notes: string | null;
  createdBy: CrmCreatedBy;
  createdAt: string;
  updatedAt: string;
};

export type CrmPerson = {
  id: string;
  name: string;
  emails: string[];
  phones: string[];
  jobTitle: string | null;
  companyId: string | null;
  company: { id: string; name: string; domain: string | null } | null;
  stageKey: string;
  doNotContact: boolean;
  notes: string | null;
  linkedinUrl: string | null;
  location: string | null;
  timezone: string | null;
  source: string;
  createdBy: CrmCreatedBy;
  createdAt: string;
  updatedAt: string;
};

export type CrmCampaignList = {
  id: string;
  campaignId: string;
  name: string;
  slug: string;
  description: string;
  memberCount: number;
  createdAt: string;
  updatedAt: string;
};

export type CrmOpportunity = {
  id: string;
  name: string;
  stage: string;
  position: number;
  amountCents: number | null;
  currency: string;
  companyId: string | null;
  personId: string | null;
  company: { id: string; name: string } | null;
  person: { id: string; name: string } | null;
  expectedCloseAt: string | null;
  notes: string | null;
  createdBy: CrmCreatedBy;
  createdAt: string;
  updatedAt: string;
};

export type CrmCampaign = {
  id: string;
  name: string;
  status: string;
  description: string | null;
  startedAt: string | null;
  endedAt: string | null;
  notes: string | null;
  createdBy: CrmCreatedBy;
  createdAt: string;
  updatedAt: string;
};

export type CrmConversation = {
  id: string;
  subject: string;
  channel: string;
  body: string | null;
  personId: string | null;
  companyId: string | null;
  person: { id: string; name: string } | null;
  company: { id: string; name: string } | null;
  occurredAt: string;
  createdBy: CrmCreatedBy;
  createdAt: string;
  updatedAt: string;
};

export type CrmSendKind = "email" | "sms" | "call";
export type CrmSendStatus =
  | "draft"
  | "queued"
  | "logged"
  | "sent"
  | "delivered"
  | "opened"
  | "clicked"
  | "failed"
  | "answered"
  | "no_answer";
export type CrmSendEventType =
  | "sent"
  | "delivered"
  | "opened"
  | "clicked"
  | "failed"
  | "answered"
  | "no_answer";

export type CrmSendEvent = {
  id: string;
  eventType: CrmSendEventType;
  linkUrl: string | null;
  createdAt: string;
};

export type CrmSend = {
  id: string;
  kind: CrmSendKind;
  status: CrmSendStatus;
  subject: string | null;
  body: string | null;
  toAddress: string;
  personId: string | null;
  companyId: string | null;
  campaignId: string | null;
  person: { id: string; name: string } | null;
  company: { id: string; name: string } | null;
  campaign: { id: string; name: string } | null;
  provider: string;
  sentAt: string | null;
  tracking: {
    opens: number;
    clicks: number;
    uniqueOpens: number;
    uniqueClicks: number;
    lastEventAt: string | null;
  };
  createdBy: CrmCreatedBy;
  createdAt: string;
  updatedAt: string;
};

export type CrmListQuery = {
  orgId?: string;
  search?: string;
  cursor?: string;
  limit?: number;
  kind?: CrmSendKind;
  campaignId?: string;
  personId?: string;
  /** People pipeline stage. Search still applies; this only narrows the page. */
  stage?: string;
};

export type CrmPage<T> = {
  items: T[];
  nextCursor: string | null;
  total: number;
  stageCounts?: Record<string, number>;
  totalAllStages?: number;
};

export type CrmThreadStatus =
  | "none"
  | "draft"
  | "queued"
  | "logged"
  | "sent"
  | "opened"
  | "clicked"
  | "failed"
  | "answered"
  | "no_answer";

/**
 * One row per person: the last send and how it landed.
 *
 * LimitlessAI-2 Conversations is this read, not the notes table. `/api/crm/conversations`
 * stays the notes book; `/api/crm/threads` is the outreach inbox.
 */
export type CrmThread = {
  person: CrmPerson;
  latestSend: CrmSend | null;
  outboundCount: number;
  status: CrmThreadStatus;
};

export type CrmCompanyInput = {
  name: string;
  domain?: string | null;
  website?: string | null;
  industry?: string | null;
  phone?: string | null;
  location?: string | null;
  notes?: string | null;
};

export type CrmPersonInput = {
  name: string;
  emails?: string[];
  phones?: string[];
  jobTitle?: string | null;
  companyId?: string | null;
  stageKey?: string | null;
  doNotContact?: boolean;
  notes?: string | null;
  linkedinUrl?: string | null;
  location?: string | null;
  timezone?: string | null;
  source?: string | null;
};

export type CrmCampaignListInput = {
  name: string;
  description?: string | null;
};

export type CrmOpportunityInput = {
  name: string;
  stage?: string;
  position?: number;
  amountCents?: number | null;
  currency?: string;
  companyId?: string | null;
  personId?: string | null;
  expectedCloseAt?: string | null;
  notes?: string | null;
};

export type CrmCampaignInput = {
  name: string;
  status?: string;
  description?: string | null;
  startedAt?: string | null;
  endedAt?: string | null;
  notes?: string | null;
};

export type CrmConversationInput = {
  subject: string;
  channel?: string;
  body?: string | null;
  personId?: string | null;
  companyId?: string | null;
  occurredAt?: string | null;
};

export type CrmSendInput = {
  kind: CrmSendKind;
  toAddress: string;
  subject?: string | null;
  body?: string | null;
  personId?: string | null;
  companyId?: string | null;
  campaignId?: string | null;
  status?: CrmSendStatus;
  provider?: string;
};

export type CrmStore = {
  listPeople: (query?: CrmListQuery) => Promise<CrmPage<CrmPerson>>;
  listThreads: (query?: CrmListQuery) => Promise<CrmPage<CrmThread>>;
  getPerson: (orgId: string, id: string) => Promise<CrmPerson | undefined>;
  createPerson: (
    orgId: string,
    input: CrmPersonInput,
    createdBy: CrmCreatedBy,
  ) => Promise<CrmPerson>;
  updatePerson: (
    orgId: string,
    id: string,
    input: Partial<CrmPersonInput>,
  ) => Promise<CrmPerson | undefined>;

  listCompanies: (query?: CrmListQuery) => Promise<CrmPage<CrmCompany>>;
  getCompany: (orgId: string, id: string) => Promise<CrmCompany | undefined>;
  createCompany: (
    orgId: string,
    input: CrmCompanyInput,
    createdBy: CrmCreatedBy,
  ) => Promise<CrmCompany>;
  updateCompany: (
    orgId: string,
    id: string,
    input: Partial<CrmCompanyInput>,
  ) => Promise<CrmCompany | undefined>;

  listOpportunities: (query?: CrmListQuery) => Promise<CrmPage<CrmOpportunity>>;
  getOpportunity: (
    orgId: string,
    id: string,
  ) => Promise<CrmOpportunity | undefined>;
  createOpportunity: (
    orgId: string,
    input: CrmOpportunityInput,
    createdBy: CrmCreatedBy,
  ) => Promise<CrmOpportunity>;
  updateOpportunity: (
    orgId: string,
    id: string,
    input: Partial<CrmOpportunityInput>,
  ) => Promise<CrmOpportunity | undefined>;

  listCampaigns: (query?: CrmListQuery) => Promise<CrmPage<CrmCampaign>>;
  getCampaign: (orgId: string, id: string) => Promise<CrmCampaign | undefined>;
  createCampaign: (
    orgId: string,
    input: CrmCampaignInput,
    createdBy: CrmCreatedBy,
  ) => Promise<CrmCampaign>;
  updateCampaign: (
    orgId: string,
    id: string,
    input: Partial<CrmCampaignInput>,
  ) => Promise<CrmCampaign | undefined>;
  listCampaignLists: (
    orgId: string,
    campaignId: string,
  ) => Promise<CrmCampaignList[]>;
  createCampaignList: (
    orgId: string,
    campaignId: string,
    input: CrmCampaignListInput,
  ) => Promise<CrmCampaignList>;
  listCampaignListMembers: (
    orgId: string,
    listId: string,
  ) => Promise<{ items: CrmPerson[]; total: number }>;
  addCampaignListMembers: (
    orgId: string,
    listId: string,
    personIds: string[],
  ) => Promise<{ added: number }>;
  removeCampaignListMembers: (
    orgId: string,
    listId: string,
    personIds: string[],
  ) => Promise<{ removed: number }>;

  listConversations: (
    query?: CrmListQuery,
  ) => Promise<CrmPage<CrmConversation>>;
  getConversation: (
    orgId: string,
    id: string,
  ) => Promise<CrmConversation | undefined>;
  createConversation: (
    orgId: string,
    input: CrmConversationInput,
    createdBy: CrmCreatedBy,
  ) => Promise<CrmConversation>;
  updateConversation: (
    orgId: string,
    id: string,
    input: Partial<CrmConversationInput>,
  ) => Promise<CrmConversation | undefined>;

  listSends: (query?: CrmListQuery) => Promise<CrmPage<CrmSend>>;
  getSend: (orgId: string, id: string) => Promise<CrmSend | undefined>;
  createSend: (
    orgId: string,
    input: CrmSendInput,
    createdBy: CrmCreatedBy,
  ) => Promise<CrmSend>;
  updateSend: (
    orgId: string,
    id: string,
    input: Partial<
      Pick<CrmSendInput, "status" | "provider"> & { sentAt?: string | null }
    >,
  ) => Promise<CrmSend | undefined>;
  listSendEvents: (orgId: string, sendId: string) => Promise<CrmSendEvent[]>;
  recordSendEvent: (input: {
    sendId: string;
    eventType: CrmSendEventType;
    linkUrl?: string | null;
  }) => Promise<CrmSend | undefined>;
  findSendByTrackingToken: (token: string) => Promise<
    | {
        id: string;
        orgId: string;
        kind: CrmSendKind;
        status: CrmSendStatus;
        trackingToken: string;
      }
    | undefined
  >;
  /** Delivery-only. Never part of a list payload. */
  getTrackingToken: (orgId: string, id: string) => Promise<string | undefined>;
};

const DEFAULT_PAGE = 50;
const MAX_PAGE = 200;

type Cursor = { createdAt: string; id: string };

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeCursor(value: string | undefined): Cursor | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as Cursor;
    if (typeof parsed?.id !== "string" || typeof parsed?.createdAt !== "string")
      return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function clampLimit(limit: number | undefined): number {
  return Math.min(Math.max(limit ?? DEFAULT_PAGE, 1), MAX_PAGE);
}

function createdByOf(row: {
  createdByKind: "user" | "bot" | "system";
  createdById: string;
  createdByName: string;
}): CrmCreatedBy {
  return {
    kind: row.createdByKind,
    id: row.createdById,
    name: row.createdByName,
  };
}

function createdByColumns(createdBy: CrmCreatedBy) {
  return {
    createdByKind: createdBy.kind,
    createdById: createdBy.id,
    createdByName: createdBy.name,
  };
}

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function requiredIso(value: Date | string): string {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function cleanList(values: string[] | undefined): string[] {
  if (!values) return [];
  return values
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function emptyToNull(
  value: string | null | undefined,
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function keysetAfter(createdAtCol: unknown, idCol: unknown, cursor: Cursor) {
  return sql`(
    ${createdAtCol} < ${cursor.createdAt}::timestamptz
    or (${createdAtCol} = ${cursor.createdAt}::timestamptz and ${idCol} < ${cursor.id})
  )`;
}

function newTrackingToken(): string {
  return randomBytes(24).toString("hex");
}

function scopedOrg(query?: CrmListQuery): string {
  return orgIdOf({ orgId: query?.orgId });
}

export function createCrmStore(database: Database): CrmStore {
  async function listPeople(
    query: CrmListQuery = {},
  ): Promise<CrmPage<CrmPerson>> {
    const orgId = scopedOrg(query);
    const limit = clampLimit(query.limit);
    const cursor = decodeCursor(query.cursor);
    const search = query.search?.trim();
    const stage = query.stage?.trim();
    const filters = [eq(crmPeople.orgId, orgId)];
    if (search) {
      const pattern = `%${escapeLike(search)}%`;
      filters.push(
        sql`(
          ${crmPeople.name} ilike ${pattern} escape '\\'
          or coalesce(${crmPeople.jobTitle}, '') ilike ${pattern} escape '\\'
          or exists (
            select 1 from unnest(${crmPeople.emails}) as email
            where email ilike ${pattern} escape '\\'
          )
        )`,
      );
    }
    const searchFilters = filters.slice();
    if (stage && stage !== "all") {
      filters.push(eq(crmPeople.stageKey, stage));
    }
    const listFilters = filters.slice();
    if (cursor) {
      filters.push(keysetAfter(crmPeople.createdAt, crmPeople.id, cursor));
    }
    const [{ total: counted }] = await database
      .select({ total: sql<number>`cast(count(*) as int)` })
      .from(crmPeople)
      .where(and(...listFilters));
    const [{ total: totalAllStages }] = await database
      .select({ total: sql<number>`cast(count(*) as int)` })
      .from(crmPeople)
      .where(and(...searchFilters));
    const stageRows = await database
      .select({
        stageKey: crmPeople.stageKey,
        count: sql<number>`cast(count(*) as int)`,
      })
      .from(crmPeople)
      .where(and(...searchFilters))
      .groupBy(crmPeople.stageKey);
    const stageCounts: Record<string, number> = {};
    for (const row of stageRows) {
      stageCounts[row.stageKey] = row.count;
    }

    const rows = await database
      .select(personSelect())
      .from(crmPeople)
      .leftJoin(crmCompanies, eq(crmCompanies.id, crmPeople.companyId))
      .where(and(...filters))
      .orderBy(desc(crmPeople.createdAt), desc(crmPeople.id))
      .limit(limit + 1);

    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      items: page.map(mapPerson),
      nextCursor:
        rows.length > limit && last
          ? encodeCursor({
              createdAt: requiredIso(last.createdAt),
              id: last.id,
            })
          : null,
      total: counted,
      stageCounts,
      totalAllStages,
    };
  }

  async function getPerson(
    orgId: string,
    id: string,
  ): Promise<CrmPerson | undefined> {
    const [row] = await database
      .select(personSelect())
      .from(crmPeople)
      .leftJoin(crmCompanies, eq(crmCompanies.id, crmPeople.companyId))
      .where(and(eq(crmPeople.id, id), eq(crmPeople.orgId, orgId)))
      .limit(1);
    return row ? mapPerson(row) : undefined;
  }

  async function createPerson(
    orgId: string,
    input: CrmPersonInput,
    createdBy: CrmCreatedBy,
  ): Promise<CrmPerson> {
    const name = input.name.trim();
    if (!name) throw new Error("A person needs a name.");
    await assertCompany(orgId, input.companyId);
    const stageKey = normalizeContactStage(input.stageKey);
    const doNotContact = input.doNotContact ?? stageKey === "dnc";
    const [row] = await database
      .insert(crmPeople)
      .values({
        orgId,
        name,
        emails: cleanList(input.emails),
        phones: cleanList(input.phones),
        jobTitle: emptyToNull(input.jobTitle) ?? null,
        companyId: emptyToNull(input.companyId) ?? null,
        stageKey,
        doNotContact: doNotContact || stageKey === "dnc",
        notes: emptyToNull(input.notes) ?? null,
        linkedinUrl: emptyToNull(input.linkedinUrl) ?? null,
        location: emptyToNull(input.location) ?? null,
        timezone: emptyToNull(input.timezone) ?? null,
        source: emptyToNull(input.source) ?? "manual",
        ...createdByColumns(createdBy),
      })
      .returning({ id: crmPeople.id });
    const created = await getPerson(orgId, row.id);
    if (!created) throw new Error("The person could not be read back.");
    return created;
  }

  async function updatePerson(
    orgId: string,
    id: string,
    input: Partial<CrmPersonInput>,
  ): Promise<CrmPerson | undefined> {
    const existing = await getPerson(orgId, id);
    if (!existing) return undefined;
    if (input.companyId !== undefined)
      await assertCompany(orgId, input.companyId);
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name) throw new Error("A person needs a name.");
      patch.name = name;
    }
    if (input.emails !== undefined) patch.emails = cleanList(input.emails);
    if (input.phones !== undefined) patch.phones = cleanList(input.phones);
    if (input.jobTitle !== undefined)
      patch.jobTitle = emptyToNull(input.jobTitle);
    if (input.companyId !== undefined)
      patch.companyId = emptyToNull(input.companyId);
    if (input.stageKey !== undefined) {
      const stageKey = normalizeContactStage(input.stageKey);
      patch.stageKey = stageKey;
      if (stageKey === "dnc") patch.doNotContact = true;
    }
    if (input.doNotContact !== undefined) {
      patch.doNotContact = input.doNotContact;
      if (input.doNotContact) patch.stageKey = "dnc";
    }
    if (input.notes !== undefined) patch.notes = emptyToNull(input.notes);
    if (input.linkedinUrl !== undefined)
      patch.linkedinUrl = emptyToNull(input.linkedinUrl);
    if (input.location !== undefined)
      patch.location = emptyToNull(input.location);
    if (input.timezone !== undefined)
      patch.timezone = emptyToNull(input.timezone);
    if (input.source !== undefined)
      patch.source = emptyToNull(input.source) ?? "manual";
    await database
      .update(crmPeople)
      .set(patch)
      .where(and(eq(crmPeople.id, id), eq(crmPeople.orgId, orgId)));
    return getPerson(orgId, id);
  }

  async function listCompanies(
    query: CrmListQuery = {},
  ): Promise<CrmPage<CrmCompany>> {
    const orgId = scopedOrg(query);
    const limit = clampLimit(query.limit);
    const cursor = decodeCursor(query.cursor);
    const search = query.search?.trim();
    const filters = [eq(crmCompanies.orgId, orgId)];
    if (search) {
      const pattern = `%${escapeLike(search)}%`;
      filters.push(
        sql`(
          ${crmCompanies.name} ilike ${pattern} escape '\\'
          or coalesce(${crmCompanies.domain}, '') ilike ${pattern} escape '\\'
          or coalesce(${crmCompanies.industry}, '') ilike ${pattern} escape '\\'
        )`,
      );
    }
    const searchFilters = filters.slice();
    if (cursor) {
      filters.push(
        keysetAfter(crmCompanies.createdAt, crmCompanies.id, cursor),
      );
    }
    const [{ total }] = await database
      .select({ total: sql<number>`cast(count(*) as int)` })
      .from(crmCompanies)
      .where(and(...searchFilters));
    const rows = await database
      .select()
      .from(crmCompanies)
      .where(and(...filters))
      .orderBy(desc(crmCompanies.createdAt), desc(crmCompanies.id))
      .limit(limit + 1);
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      items: page.map(mapCompany),
      nextCursor:
        rows.length > limit && last
          ? encodeCursor({
              createdAt: requiredIso(last.createdAt),
              id: last.id,
            })
          : null,
      total,
    };
  }

  async function getCompany(
    orgId: string,
    id: string,
  ): Promise<CrmCompany | undefined> {
    const [row] = await database
      .select()
      .from(crmCompanies)
      .where(and(eq(crmCompanies.id, id), eq(crmCompanies.orgId, orgId)))
      .limit(1);
    return row ? mapCompany(row) : undefined;
  }

  async function createCompany(
    orgId: string,
    input: CrmCompanyInput,
    createdBy: CrmCreatedBy,
  ): Promise<CrmCompany> {
    const name = input.name.trim();
    if (!name) throw new Error("A company needs a name.");
    const [row] = await database
      .insert(crmCompanies)
      .values({
        orgId,
        name,
        domain: emptyToNull(input.domain) ?? null,
        website: emptyToNull(input.website) ?? null,
        industry: emptyToNull(input.industry) ?? null,
        phone: emptyToNull(input.phone) ?? null,
        location: emptyToNull(input.location) ?? null,
        notes: emptyToNull(input.notes) ?? null,
        ...createdByColumns(createdBy),
      })
      .returning({ id: crmCompanies.id });
    const created = await getCompany(orgId, row.id);
    if (!created) throw new Error("The company could not be read back.");
    return created;
  }

  async function updateCompany(
    orgId: string,
    id: string,
    input: Partial<CrmCompanyInput>,
  ): Promise<CrmCompany | undefined> {
    const existing = await getCompany(orgId, id);
    if (!existing) return undefined;
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name) throw new Error("A company needs a name.");
      patch.name = name;
    }
    if (input.domain !== undefined) patch.domain = emptyToNull(input.domain);
    if (input.website !== undefined) patch.website = emptyToNull(input.website);
    if (input.industry !== undefined)
      patch.industry = emptyToNull(input.industry);
    if (input.phone !== undefined) patch.phone = emptyToNull(input.phone);
    if (input.location !== undefined)
      patch.location = emptyToNull(input.location);
    if (input.notes !== undefined) patch.notes = emptyToNull(input.notes);
    await database
      .update(crmCompanies)
      .set(patch)
      .where(and(eq(crmCompanies.id, id), eq(crmCompanies.orgId, orgId)));
    return getCompany(orgId, id);
  }

  async function listOpportunities(
    query: CrmListQuery = {},
  ): Promise<CrmPage<CrmOpportunity>> {
    const orgId = scopedOrg(query);
    const limit = clampLimit(query.limit);
    const cursor = decodeCursor(query.cursor);
    const search = query.search?.trim();
    const stage = query.stage?.trim();
    const filters = [eq(crmOpportunities.orgId, orgId)];
    if (search) {
      const pattern = `%${escapeLike(search)}%`;
      filters.push(
        sql`(
          ${crmOpportunities.name} ilike ${pattern} escape '\\'
          or ${crmOpportunities.stage} ilike ${pattern} escape '\\'
        )`,
      );
    }
    if (stage && stage !== "all") {
      filters.push(eq(crmOpportunities.stage, normalizeDealStage(stage)));
    }
    if (query.personId) {
      filters.push(eq(crmOpportunities.personId, query.personId));
    }
    const searchFilters = filters.slice();
    if (cursor) {
      filters.push(
        keysetAfter(crmOpportunities.createdAt, crmOpportunities.id, cursor),
      );
    }
    const [{ total }] = await database
      .select({ total: sql<number>`cast(count(*) as int)` })
      .from(crmOpportunities)
      .where(and(...searchFilters));
    const rows = await database
      .select({
        id: crmOpportunities.id,
        name: crmOpportunities.name,
        stage: crmOpportunities.stage,
        position: crmOpportunities.position,
        amountCents: crmOpportunities.amountCents,
        currency: crmOpportunities.currency,
        companyId: crmOpportunities.companyId,
        personId: crmOpportunities.personId,
        expectedCloseAt: crmOpportunities.expectedCloseAt,
        notes: crmOpportunities.notes,
        createdByKind: crmOpportunities.createdByKind,
        createdById: crmOpportunities.createdById,
        createdByName: crmOpportunities.createdByName,
        createdAt: crmOpportunities.createdAt,
        updatedAt: crmOpportunities.updatedAt,
        companyName: crmCompanies.name,
        personName: crmPeople.name,
      })
      .from(crmOpportunities)
      .leftJoin(crmCompanies, eq(crmCompanies.id, crmOpportunities.companyId))
      .leftJoin(crmPeople, eq(crmPeople.id, crmOpportunities.personId))
      .where(and(...filters))
      .orderBy(desc(crmOpportunities.createdAt), desc(crmOpportunities.id))
      .limit(limit + 1);
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      items: page.map(mapOpportunity),
      nextCursor:
        rows.length > limit && last
          ? encodeCursor({
              createdAt: requiredIso(last.createdAt),
              id: last.id,
            })
          : null,
      total,
    };
  }

  async function getOpportunity(
    orgId: string,
    id: string,
  ): Promise<CrmOpportunity | undefined> {
    const [row] = await database
      .select({
        id: crmOpportunities.id,
        name: crmOpportunities.name,
        stage: crmOpportunities.stage,
        position: crmOpportunities.position,
        amountCents: crmOpportunities.amountCents,
        currency: crmOpportunities.currency,
        companyId: crmOpportunities.companyId,
        personId: crmOpportunities.personId,
        expectedCloseAt: crmOpportunities.expectedCloseAt,
        notes: crmOpportunities.notes,
        createdByKind: crmOpportunities.createdByKind,
        createdById: crmOpportunities.createdById,
        createdByName: crmOpportunities.createdByName,
        createdAt: crmOpportunities.createdAt,
        updatedAt: crmOpportunities.updatedAt,
        companyName: crmCompanies.name,
        personName: crmPeople.name,
      })
      .from(crmOpportunities)
      .leftJoin(crmCompanies, eq(crmCompanies.id, crmOpportunities.companyId))
      .leftJoin(crmPeople, eq(crmPeople.id, crmOpportunities.personId))
      .where(
        and(eq(crmOpportunities.id, id), eq(crmOpportunities.orgId, orgId)),
      )
      .limit(1);
    return row ? mapOpportunity(row) : undefined;
  }

  async function createOpportunity(
    orgId: string,
    input: CrmOpportunityInput,
    createdBy: CrmCreatedBy,
  ): Promise<CrmOpportunity> {
    const name = input.name.trim();
    if (!name) throw new Error("An opportunity needs a name.");
    await assertCompany(orgId, input.companyId);
    await assertPerson(orgId, input.personId);
    const [row] = await database
      .insert(crmOpportunities)
      .values({
        orgId,
        name,
        stage: normalizeDealStage(input.stage),
        position: input.position ?? 0,
        amountCents: input.amountCents ?? null,
        currency: input.currency?.trim() || "USD",
        companyId: emptyToNull(input.companyId) ?? null,
        personId: emptyToNull(input.personId) ?? null,
        expectedCloseAt: input.expectedCloseAt
          ? new Date(input.expectedCloseAt)
          : null,
        notes: emptyToNull(input.notes) ?? null,
        ...createdByColumns(createdBy),
      })
      .returning({ id: crmOpportunities.id });
    const created = await getOpportunity(orgId, row.id);
    if (!created) throw new Error("The opportunity could not be read back.");
    return created;
  }

  async function updateOpportunity(
    orgId: string,
    id: string,
    input: Partial<CrmOpportunityInput>,
  ): Promise<CrmOpportunity | undefined> {
    const existing = await getOpportunity(orgId, id);
    if (!existing) return undefined;
    if (input.companyId !== undefined)
      await assertCompany(orgId, input.companyId);
    if (input.personId !== undefined) await assertPerson(orgId, input.personId);
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name) throw new Error("An opportunity needs a name.");
      patch.name = name;
    }
    if (input.stage !== undefined)
      patch.stage = normalizeDealStage(input.stage);
    if (input.position !== undefined) patch.position = input.position;
    if (input.amountCents !== undefined) patch.amountCents = input.amountCents;
    if (input.currency !== undefined)
      patch.currency = input.currency.trim() || "USD";
    if (input.companyId !== undefined)
      patch.companyId = emptyToNull(input.companyId);
    if (input.personId !== undefined)
      patch.personId = emptyToNull(input.personId);
    if (input.expectedCloseAt !== undefined) {
      patch.expectedCloseAt = input.expectedCloseAt
        ? new Date(input.expectedCloseAt)
        : null;
    }
    if (input.notes !== undefined) patch.notes = emptyToNull(input.notes);
    await database
      .update(crmOpportunities)
      .set(patch)
      .where(
        and(eq(crmOpportunities.id, id), eq(crmOpportunities.orgId, orgId)),
      );
    return getOpportunity(orgId, id);
  }

  async function listCampaigns(
    query: CrmListQuery = {},
  ): Promise<CrmPage<CrmCampaign>> {
    const orgId = scopedOrg(query);
    const limit = clampLimit(query.limit);
    const cursor = decodeCursor(query.cursor);
    const search = query.search?.trim();
    const filters = [eq(crmCampaigns.orgId, orgId)];
    if (search) {
      const pattern = `%${escapeLike(search)}%`;
      filters.push(
        sql`(
          ${crmCampaigns.name} ilike ${pattern} escape '\\'
          or coalesce(${crmCampaigns.status}, '') ilike ${pattern} escape '\\'
        )`,
      );
    }
    const searchFilters = filters.slice();
    if (cursor) {
      filters.push(
        keysetAfter(crmCampaigns.createdAt, crmCampaigns.id, cursor),
      );
    }
    const [{ total }] = await database
      .select({ total: sql<number>`cast(count(*) as int)` })
      .from(crmCampaigns)
      .where(and(...searchFilters));
    const rows = await database
      .select()
      .from(crmCampaigns)
      .where(and(...filters))
      .orderBy(desc(crmCampaigns.createdAt), desc(crmCampaigns.id))
      .limit(limit + 1);
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      items: page.map(mapCampaign),
      nextCursor:
        rows.length > limit && last
          ? encodeCursor({
              createdAt: requiredIso(last.createdAt),
              id: last.id,
            })
          : null,
      total,
    };
  }

  async function getCampaign(
    orgId: string,
    id: string,
  ): Promise<CrmCampaign | undefined> {
    const [row] = await database
      .select()
      .from(crmCampaigns)
      .where(and(eq(crmCampaigns.id, id), eq(crmCampaigns.orgId, orgId)))
      .limit(1);
    return row ? mapCampaign(row) : undefined;
  }

  async function createCampaign(
    orgId: string,
    input: CrmCampaignInput,
    createdBy: CrmCreatedBy,
  ): Promise<CrmCampaign> {
    const name = input.name.trim();
    if (!name) throw new Error("A campaign needs a name.");
    const [row] = await database
      .insert(crmCampaigns)
      .values({
        orgId,
        name,
        status: input.status?.trim() || "draft",
        description: emptyToNull(input.description) ?? null,
        startedAt: input.startedAt ? new Date(input.startedAt) : null,
        endedAt: input.endedAt ? new Date(input.endedAt) : null,
        notes: emptyToNull(input.notes) ?? null,
        ...createdByColumns(createdBy),
      })
      .returning({ id: crmCampaigns.id });
    const created = await getCampaign(orgId, row.id);
    if (!created) throw new Error("The campaign could not be read back.");
    return created;
  }

  async function updateCampaign(
    orgId: string,
    id: string,
    input: Partial<CrmCampaignInput>,
  ): Promise<CrmCampaign | undefined> {
    const existing = await getCampaign(orgId, id);
    if (!existing) return undefined;
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name) throw new Error("A campaign needs a name.");
      patch.name = name;
    }
    if (input.status !== undefined)
      patch.status = input.status.trim() || "draft";
    if (input.description !== undefined)
      patch.description = emptyToNull(input.description);
    if (input.startedAt !== undefined) {
      patch.startedAt = input.startedAt ? new Date(input.startedAt) : null;
    }
    if (input.endedAt !== undefined) {
      patch.endedAt = input.endedAt ? new Date(input.endedAt) : null;
    }
    if (input.notes !== undefined) patch.notes = emptyToNull(input.notes);
    await database
      .update(crmCampaigns)
      .set(patch)
      .where(and(eq(crmCampaigns.id, id), eq(crmCampaigns.orgId, orgId)));
    return getCampaign(orgId, id);
  }

  async function listCampaignLists(
    orgId: string,
    campaignId: string,
  ): Promise<CrmCampaignList[]> {
    const campaign = await getCampaign(orgId, campaignId);
    if (!campaign) return [];
    const rows = await database
      .select({
        id: crmCampaignLists.id,
        campaignId: crmCampaignLists.campaignId,
        name: crmCampaignLists.name,
        slug: crmCampaignLists.slug,
        description: crmCampaignLists.description,
        createdAt: crmCampaignLists.createdAt,
        updatedAt: crmCampaignLists.updatedAt,
        memberCount: sql<number>`cast(count(${crmCampaignListMembers.id}) filter (where ${crmCampaignListMembers.status} = 'active') as int)`,
      })
      .from(crmCampaignLists)
      .leftJoin(
        crmCampaignListMembers,
        eq(crmCampaignListMembers.listId, crmCampaignLists.id),
      )
      .where(
        and(
          eq(crmCampaignLists.orgId, orgId),
          eq(crmCampaignLists.campaignId, campaignId),
        ),
      )
      .groupBy(
        crmCampaignLists.id,
        crmCampaignLists.campaignId,
        crmCampaignLists.name,
        crmCampaignLists.slug,
        crmCampaignLists.description,
        crmCampaignLists.createdAt,
        crmCampaignLists.updatedAt,
      )
      .orderBy(crmCampaignLists.createdAt);
    return rows.map(mapCampaignList);
  }

  async function createCampaignList(
    orgId: string,
    campaignId: string,
    input: CrmCampaignListInput,
  ): Promise<CrmCampaignList> {
    const campaign = await getCampaign(orgId, campaignId);
    if (!campaign) throw new Error("That campaign is not here.");
    const name = input.name.trim();
    if (!name) throw new Error("A list needs a name.");
    const slug = await uniqueListSlug(orgId, campaignId, slugify(name));
    const [row] = await database
      .insert(crmCampaignLists)
      .values({
        orgId,
        campaignId,
        name,
        slug,
        description: input.description?.trim() ?? "",
      })
      .returning({ id: crmCampaignLists.id });
    const lists = await listCampaignLists(orgId, campaignId);
    const created = lists.find((list) => list.id === row.id);
    if (!created) throw new Error("The list could not be read back.");
    return created;
  }

  async function getCampaignList(orgId: string, listId: string) {
    const [row] = await database
      .select()
      .from(crmCampaignLists)
      .where(
        and(eq(crmCampaignLists.id, listId), eq(crmCampaignLists.orgId, orgId)),
      )
      .limit(1);
    return row ?? undefined;
  }

  async function listCampaignListMembers(
    orgId: string,
    listId: string,
  ): Promise<{ items: CrmPerson[]; total: number }> {
    const list = await getCampaignList(orgId, listId);
    if (!list) return { items: [], total: 0 };
    const [{ total }] = await database
      .select({ total: sql<number>`cast(count(*) as int)` })
      .from(crmCampaignListMembers)
      .where(
        and(
          eq(crmCampaignListMembers.listId, listId),
          eq(crmCampaignListMembers.orgId, orgId),
          eq(crmCampaignListMembers.status, "active"),
        ),
      );
    const memberRows = await database
      .select({ personId: crmCampaignListMembers.personId })
      .from(crmCampaignListMembers)
      .where(
        and(
          eq(crmCampaignListMembers.listId, listId),
          eq(crmCampaignListMembers.orgId, orgId),
          eq(crmCampaignListMembers.status, "active"),
        ),
      )
      .orderBy(desc(crmCampaignListMembers.addedAt));
    const items: CrmPerson[] = [];
    for (const member of memberRows) {
      const person = await getPerson(orgId, member.personId);
      if (person) items.push(person);
    }
    return { items, total };
  }

  async function addCampaignListMembers(
    orgId: string,
    listId: string,
    personIds: string[],
  ): Promise<{ added: number }> {
    const list = await getCampaignList(orgId, listId);
    if (!list) throw new Error("That list is not here.");
    const ids = [...new Set(personIds.filter(Boolean))];
    let added = 0;
    for (const personId of ids) {
      const person = await getPerson(orgId, personId);
      if (!person) continue;
      const [existing] = await database
        .select()
        .from(crmCampaignListMembers)
        .where(
          and(
            eq(crmCampaignListMembers.listId, listId),
            eq(crmCampaignListMembers.personId, personId),
          ),
        )
        .limit(1);
      if (existing) {
        if (existing.status !== "active") {
          await database
            .update(crmCampaignListMembers)
            .set({ status: "active", addedAt: new Date(), addedBy: "user" })
            .where(eq(crmCampaignListMembers.id, existing.id));
          added += 1;
        }
        continue;
      }
      await database.insert(crmCampaignListMembers).values({
        orgId,
        listId,
        personId,
        addedBy: "user",
        status: "active",
      });
      added += 1;
    }
    return { added };
  }

  async function removeCampaignListMembers(
    orgId: string,
    listId: string,
    personIds: string[],
  ): Promise<{ removed: number }> {
    const list = await getCampaignList(orgId, listId);
    if (!list) throw new Error("That list is not here.");
    const ids = [...new Set(personIds.filter(Boolean))];
    if (ids.length === 0) return { removed: 0 };
    const result = await database
      .update(crmCampaignListMembers)
      .set({ status: "removed" })
      .where(
        and(
          eq(crmCampaignListMembers.orgId, orgId),
          eq(crmCampaignListMembers.listId, listId),
          inArray(crmCampaignListMembers.personId, ids),
          eq(crmCampaignListMembers.status, "active"),
        ),
      )
      .returning({ id: crmCampaignListMembers.id });
    return { removed: result.length };
  }

  async function uniqueListSlug(
    orgId: string,
    campaignId: string,
    base: string,
  ) {
    let slug = base;
    let n = 0;
    while (true) {
      const [hit] = await database
        .select({ id: crmCampaignLists.id })
        .from(crmCampaignLists)
        .where(
          and(
            eq(crmCampaignLists.orgId, orgId),
            eq(crmCampaignLists.campaignId, campaignId),
            eq(crmCampaignLists.slug, slug),
          ),
        )
        .limit(1);
      if (!hit) return slug;
      n += 1;
      slug = `${base}-${n}`;
    }
  }

  async function listConversations(
    query: CrmListQuery = {},
  ): Promise<CrmPage<CrmConversation>> {
    const orgId = scopedOrg(query);
    const limit = clampLimit(query.limit);
    const cursor = decodeCursor(query.cursor);
    const search = query.search?.trim();
    const filters = [eq(crmConversations.orgId, orgId)];
    if (query.personId) {
      filters.push(eq(crmConversations.personId, query.personId));
    }
    if (search) {
      const pattern = `%${escapeLike(search)}%`;
      filters.push(
        sql`(
          ${crmConversations.subject} ilike ${pattern} escape '\\'
          or coalesce(${crmConversations.body}, '') ilike ${pattern} escape '\\'
          or ${crmConversations.channel} ilike ${pattern} escape '\\'
        )`,
      );
    }
    const searchFilters = filters.slice();
    if (cursor) {
      filters.push(
        keysetAfter(crmConversations.occurredAt, crmConversations.id, cursor),
      );
    }
    const [{ total }] = await database
      .select({ total: sql<number>`cast(count(*) as int)` })
      .from(crmConversations)
      .where(and(...searchFilters));
    const rows = await database
      .select({
        id: crmConversations.id,
        subject: crmConversations.subject,
        channel: crmConversations.channel,
        body: crmConversations.body,
        personId: crmConversations.personId,
        companyId: crmConversations.companyId,
        occurredAt: crmConversations.occurredAt,
        createdByKind: crmConversations.createdByKind,
        createdById: crmConversations.createdById,
        createdByName: crmConversations.createdByName,
        createdAt: crmConversations.createdAt,
        updatedAt: crmConversations.updatedAt,
        personName: crmPeople.name,
        companyName: crmCompanies.name,
      })
      .from(crmConversations)
      .leftJoin(crmPeople, eq(crmPeople.id, crmConversations.personId))
      .leftJoin(crmCompanies, eq(crmCompanies.id, crmConversations.companyId))
      .where(and(...filters))
      .orderBy(desc(crmConversations.occurredAt), desc(crmConversations.id))
      .limit(limit + 1);
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      items: page.map(mapConversation),
      nextCursor:
        rows.length > limit && last
          ? encodeCursor({
              createdAt: requiredIso(last.occurredAt),
              id: last.id,
            })
          : null,
      total,
    };
  }

  async function getConversation(
    orgId: string,
    id: string,
  ): Promise<CrmConversation | undefined> {
    const [row] = await database
      .select({
        id: crmConversations.id,
        subject: crmConversations.subject,
        channel: crmConversations.channel,
        body: crmConversations.body,
        personId: crmConversations.personId,
        companyId: crmConversations.companyId,
        occurredAt: crmConversations.occurredAt,
        createdByKind: crmConversations.createdByKind,
        createdById: crmConversations.createdById,
        createdByName: crmConversations.createdByName,
        createdAt: crmConversations.createdAt,
        updatedAt: crmConversations.updatedAt,
        personName: crmPeople.name,
        companyName: crmCompanies.name,
      })
      .from(crmConversations)
      .leftJoin(crmPeople, eq(crmPeople.id, crmConversations.personId))
      .leftJoin(crmCompanies, eq(crmCompanies.id, crmConversations.companyId))
      .where(
        and(eq(crmConversations.id, id), eq(crmConversations.orgId, orgId)),
      )
      .limit(1);
    return row ? mapConversation(row) : undefined;
  }

  async function createConversation(
    orgId: string,
    input: CrmConversationInput,
    createdBy: CrmCreatedBy,
  ): Promise<CrmConversation> {
    const subject = input.subject.trim();
    if (!subject) throw new Error("A conversation needs a subject.");
    await assertCompany(orgId, input.companyId);
    await assertPerson(orgId, input.personId);
    const [row] = await database
      .insert(crmConversations)
      .values({
        orgId,
        subject,
        channel: input.channel?.trim() || "note",
        body: emptyToNull(input.body) ?? null,
        personId: emptyToNull(input.personId) ?? null,
        companyId: emptyToNull(input.companyId) ?? null,
        occurredAt: input.occurredAt ? new Date(input.occurredAt) : new Date(),
        ...createdByColumns(createdBy),
      })
      .returning({ id: crmConversations.id });
    const created = await getConversation(orgId, row.id);
    if (!created) throw new Error("The conversation could not be read back.");
    return created;
  }

  async function updateConversation(
    orgId: string,
    id: string,
    input: Partial<CrmConversationInput>,
  ): Promise<CrmConversation | undefined> {
    const existing = await getConversation(orgId, id);
    if (!existing) return undefined;
    if (input.companyId !== undefined)
      await assertCompany(orgId, input.companyId);
    if (input.personId !== undefined) await assertPerson(orgId, input.personId);
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (input.subject !== undefined) {
      const subject = input.subject.trim();
      if (!subject) throw new Error("A conversation needs a subject.");
      patch.subject = subject;
    }
    if (input.channel !== undefined)
      patch.channel = input.channel.trim() || "note";
    if (input.body !== undefined) patch.body = emptyToNull(input.body);
    if (input.personId !== undefined)
      patch.personId = emptyToNull(input.personId);
    if (input.companyId !== undefined)
      patch.companyId = emptyToNull(input.companyId);
    if (input.occurredAt !== undefined) {
      patch.occurredAt = input.occurredAt
        ? new Date(input.occurredAt)
        : new Date();
    }
    await database
      .update(crmConversations)
      .set(patch)
      .where(
        and(eq(crmConversations.id, id), eq(crmConversations.orgId, orgId)),
      );
    return getConversation(orgId, id);
  }

  async function listSends(
    query: CrmListQuery = {},
  ): Promise<CrmPage<CrmSend>> {
    const orgId = scopedOrg(query);
    const limit = clampLimit(query.limit);
    const cursor = decodeCursor(query.cursor);
    const search = query.search?.trim();
    const filters = [eq(crmSends.orgId, orgId)];
    if (query.kind) filters.push(eq(crmSends.kind, query.kind));
    if (query.campaignId)
      filters.push(eq(crmSends.campaignId, query.campaignId));
    if (query.personId) filters.push(eq(crmSends.personId, query.personId));
    if (search) {
      const pattern = `%${escapeLike(search)}%`;
      filters.push(
        sql`(
          ${crmSends.toAddress} ilike ${pattern} escape '\\'
          or coalesce(${crmSends.subject}, '') ilike ${pattern} escape '\\'
          or coalesce(${crmSends.body}, '') ilike ${pattern} escape '\\'
        )`,
      );
    }
    const searchFilters = filters.slice();
    if (cursor) {
      filters.push(keysetAfter(crmSends.createdAt, crmSends.id, cursor));
    }
    const [{ total }] = await database
      .select({ total: sql<number>`cast(count(*) as int)` })
      .from(crmSends)
      .where(and(...searchFilters));
    const rows = await database
      .select({
        id: crmSends.id,
        kind: crmSends.kind,
        status: crmSends.status,
        subject: crmSends.subject,
        body: crmSends.body,
        toAddress: crmSends.toAddress,
        personId: crmSends.personId,
        companyId: crmSends.companyId,
        campaignId: crmSends.campaignId,
        provider: crmSends.provider,
        sentAt: crmSends.sentAt,
        createdByKind: crmSends.createdByKind,
        createdById: crmSends.createdById,
        createdByName: crmSends.createdByName,
        createdAt: crmSends.createdAt,
        updatedAt: crmSends.updatedAt,
        personName: crmPeople.name,
        companyName: crmCompanies.name,
        campaignName: crmCampaigns.name,
      })
      .from(crmSends)
      .leftJoin(crmPeople, eq(crmPeople.id, crmSends.personId))
      .leftJoin(crmCompanies, eq(crmCompanies.id, crmSends.companyId))
      .leftJoin(crmCampaigns, eq(crmCampaigns.id, crmSends.campaignId))
      .where(and(...filters))
      .orderBy(desc(crmSends.createdAt), desc(crmSends.id))
      .limit(limit + 1);
    const page = rows.slice(0, limit);
    const tracking = await trackingFor(
      orgId,
      page.map((row) => row.id),
    );
    const last = page.at(-1);
    return {
      items: page.map((row) => mapSend(row, tracking.get(row.id))),
      nextCursor:
        rows.length > limit && last
          ? encodeCursor({
              createdAt: requiredIso(last.createdAt),
              id: last.id,
            })
          : null,
      total,
    };
  }

  async function getSend(
    orgId: string,
    id: string,
  ): Promise<CrmSend | undefined> {
    const [row] = await database
      .select({
        id: crmSends.id,
        kind: crmSends.kind,
        status: crmSends.status,
        subject: crmSends.subject,
        body: crmSends.body,
        toAddress: crmSends.toAddress,
        personId: crmSends.personId,
        companyId: crmSends.companyId,
        campaignId: crmSends.campaignId,
        provider: crmSends.provider,
        sentAt: crmSends.sentAt,
        createdByKind: crmSends.createdByKind,
        createdById: crmSends.createdById,
        createdByName: crmSends.createdByName,
        createdAt: crmSends.createdAt,
        updatedAt: crmSends.updatedAt,
        personName: crmPeople.name,
        companyName: crmCompanies.name,
        campaignName: crmCampaigns.name,
      })
      .from(crmSends)
      .leftJoin(crmPeople, eq(crmPeople.id, crmSends.personId))
      .leftJoin(crmCompanies, eq(crmCompanies.id, crmSends.companyId))
      .leftJoin(crmCampaigns, eq(crmCampaigns.id, crmSends.campaignId))
      .where(and(eq(crmSends.id, id), eq(crmSends.orgId, orgId)))
      .limit(1);
    if (!row) return undefined;
    const tracking = await trackingFor(orgId, [row.id]);
    return mapSend(row, tracking.get(row.id));
  }

  async function createSend(
    orgId: string,
    input: CrmSendInput,
    createdBy: CrmCreatedBy,
  ): Promise<CrmSend> {
    const toAddress = input.toAddress.trim();
    if (!toAddress) throw new Error("A send needs an address or number.");
    await assertCompany(orgId, input.companyId);
    await assertPerson(orgId, input.personId);
    if (input.personId) {
      const person = await getPerson(orgId, input.personId);
      if (person && (person.doNotContact || person.stageKey === "dnc")) {
        throw new Error(
          `${person.name} is marked Do Not Contact — send blocked.`,
        );
      }
    }
    await assertCampaign(orgId, input.campaignId);
    const [row] = await database
      .insert(crmSends)
      .values({
        orgId,
        kind: input.kind,
        status: input.status ?? "queued",
        subject: emptyToNull(input.subject) ?? null,
        body: emptyToNull(input.body) ?? null,
        toAddress,
        personId: emptyToNull(input.personId) ?? null,
        companyId: emptyToNull(input.companyId) ?? null,
        campaignId: emptyToNull(input.campaignId) ?? null,
        trackingToken: newTrackingToken(),
        provider: input.provider?.trim() || "logged",
        ...createdByColumns(createdBy),
      })
      .returning({ id: crmSends.id });
    const created = await getSend(orgId, row.id);
    if (!created) throw new Error("The send could not be read back.");
    return created;
  }

  async function updateSend(
    orgId: string,
    id: string,
    input: Partial<
      Pick<CrmSendInput, "status" | "provider"> & { sentAt?: string | null }
    >,
  ): Promise<CrmSend | undefined> {
    const existing = await getSend(orgId, id);
    if (!existing) return undefined;
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (input.status !== undefined) patch.status = input.status;
    if (input.provider !== undefined) patch.provider = input.provider;
    if (input.sentAt !== undefined) {
      patch.sentAt = input.sentAt ? new Date(input.sentAt) : null;
    }
    await database
      .update(crmSends)
      .set(patch)
      .where(and(eq(crmSends.id, id), eq(crmSends.orgId, orgId)));
    return getSend(orgId, id);
  }

  async function listSendEvents(
    orgId: string,
    sendId: string,
  ): Promise<CrmSendEvent[]> {
    const send = await getSend(orgId, sendId);
    if (!send) return [];
    const rows = await database
      .select()
      .from(crmSendEvents)
      .where(
        and(eq(crmSendEvents.sendId, sendId), eq(crmSendEvents.orgId, orgId)),
      )
      .orderBy(desc(crmSendEvents.createdAt));
    return rows.map((row) => ({
      id: row.id,
      eventType: row.eventType,
      linkUrl: row.linkUrl,
      createdAt: requiredIso(row.createdAt),
    }));
  }

  async function recordSendEvent(input: {
    sendId: string;
    eventType: CrmSendEventType;
    linkUrl?: string | null;
  }): Promise<CrmSend | undefined> {
    const [send] = await database
      .select({
        id: crmSends.id,
        orgId: crmSends.orgId,
        status: crmSends.status,
      })
      .from(crmSends)
      .where(eq(crmSends.id, input.sendId))
      .limit(1);
    if (!send) return undefined;
    await database.insert(crmSendEvents).values({
      orgId: send.orgId,
      sendId: send.id,
      eventType: input.eventType,
      linkUrl: emptyToNull(input.linkUrl) ?? null,
    });
    const next = nextStatus(send.status, input.eventType);
    if (next !== send.status) {
      await database
        .update(crmSends)
        .set({
          status: next,
          updatedAt: new Date(),
          ...(input.eventType === "sent" ? { sentAt: new Date() } : {}),
        })
        .where(eq(crmSends.id, send.id));
    }
    return getSend(send.orgId, send.id);
  }

  async function findSendByTrackingToken(token: string) {
    const trimmed = token.trim();
    if (!trimmed) return undefined;
    const [row] = await database
      .select({
        id: crmSends.id,
        orgId: crmSends.orgId,
        kind: crmSends.kind,
        status: crmSends.status,
        trackingToken: crmSends.trackingToken,
      })
      .from(crmSends)
      .where(eq(crmSends.trackingToken, trimmed))
      .limit(1);
    return row;
  }

  async function getTrackingToken(orgId: string, id: string) {
    const [row] = await database
      .select({ trackingToken: crmSends.trackingToken })
      .from(crmSends)
      .where(and(eq(crmSends.id, id), eq(crmSends.orgId, orgId)))
      .limit(1);
    return row?.trackingToken;
  }

  async function listThreads(
    query: CrmListQuery = {},
  ): Promise<CrmPage<CrmThread>> {
    const peoplePage = await listPeople({
      ...query,
      stage: undefined,
    });
    const orgId = scopedOrg(query);
    const personIds = peoplePage.items.map((person) => person.id);
    if (personIds.length === 0) {
      return {
        items: [],
        nextCursor: peoplePage.nextCursor,
        total: peoplePage.totalAllStages ?? peoplePage.total,
      };
    }

    const sendRows = await database
      .select({
        id: crmSends.id,
        kind: crmSends.kind,
        status: crmSends.status,
        subject: crmSends.subject,
        body: crmSends.body,
        toAddress: crmSends.toAddress,
        personId: crmSends.personId,
        companyId: crmSends.companyId,
        campaignId: crmSends.campaignId,
        provider: crmSends.provider,
        sentAt: crmSends.sentAt,
        createdByKind: crmSends.createdByKind,
        createdById: crmSends.createdById,
        createdByName: crmSends.createdByName,
        createdAt: crmSends.createdAt,
        updatedAt: crmSends.updatedAt,
        campaignName: crmCampaigns.name,
      })
      .from(crmSends)
      .leftJoin(crmCampaigns, eq(crmCampaigns.id, crmSends.campaignId))
      .where(
        and(eq(crmSends.orgId, orgId), inArray(crmSends.personId, personIds)),
      )
      .orderBy(desc(crmSends.createdAt), desc(crmSends.id));

    const latest = new Map<string, (typeof sendRows)[number]>();
    const outbound = new Map<string, number>();
    for (const row of sendRows) {
      if (!row.personId) continue;
      outbound.set(row.personId, (outbound.get(row.personId) ?? 0) + 1);
      if (!latest.has(row.personId)) latest.set(row.personId, row);
    }

    const tracking = await trackingFor(
      orgId,
      [...latest.values()].map((row) => row.id),
    );

    return {
      items: peoplePage.items.map((person) => {
        const row = latest.get(person.id);
        const latestSend = row
          ? mapSend(
              {
                ...row,
                personName: person.name,
                companyName: person.company?.name ?? null,
              },
              tracking.get(row.id),
            )
          : null;
        return {
          person,
          latestSend,
          outboundCount: outbound.get(person.id) ?? 0,
          status: deriveThreadStatus(latestSend),
        };
      }),
      nextCursor: peoplePage.nextCursor,
      total: peoplePage.totalAllStages ?? peoplePage.total,
    };
  }

  async function assertCompany(
    orgId: string,
    companyId: string | null | undefined,
  ) {
    const id = emptyToNull(companyId);
    if (!id) return;
    const company = await getCompany(orgId, id);
    if (!company) throw new Error("That company is not in this organization.");
  }

  async function assertPerson(
    orgId: string,
    personId: string | null | undefined,
  ) {
    const id = emptyToNull(personId);
    if (!id) return;
    const person = await getPerson(orgId, id);
    if (!person) throw new Error("That person is not in this organization.");
  }

  async function assertCampaign(
    orgId: string,
    campaignId: string | null | undefined,
  ) {
    const id = emptyToNull(campaignId);
    if (!id) return;
    const campaign = await getCampaign(orgId, id);
    if (!campaign)
      throw new Error("That campaign is not in this organization.");
  }

  async function trackingFor(orgId: string, sendIds: string[]) {
    const map = new Map<
      string,
      {
        opens: number;
        clicks: number;
        uniqueOpens: number;
        uniqueClicks: number;
        lastEventAt: string | null;
      }
    >();
    if (sendIds.length === 0) return map;
    const rows = await database
      .select({
        sendId: crmSendEvents.sendId,
        eventType: crmSendEvents.eventType,
        createdAt: crmSendEvents.createdAt,
      })
      .from(crmSendEvents)
      .where(
        and(
          eq(crmSendEvents.orgId, orgId),
          inArray(crmSendEvents.sendId, sendIds),
        ),
      );
    for (const id of sendIds) {
      map.set(id, {
        opens: 0,
        clicks: 0,
        uniqueOpens: 0,
        uniqueClicks: 0,
        lastEventAt: null,
      });
    }
    const opened = new Set<string>();
    const clicked = new Set<string>();
    for (const row of rows) {
      const current = map.get(row.sendId);
      if (!current) continue;
      if (row.eventType === "opened") {
        current.opens += 1;
        if (!opened.has(row.sendId)) {
          current.uniqueOpens += 1;
          opened.add(row.sendId);
        }
      }
      if (row.eventType === "clicked") {
        current.clicks += 1;
        if (!clicked.has(row.sendId)) {
          current.uniqueClicks += 1;
          clicked.add(row.sendId);
        }
      }
      const at = requiredIso(row.createdAt);
      if (!current.lastEventAt || at > current.lastEventAt) {
        current.lastEventAt = at;
      }
    }
    return map;
  }

  return {
    listPeople,
    listThreads,
    getPerson,
    createPerson,
    updatePerson,
    listCompanies,
    getCompany,
    createCompany,
    updateCompany,
    listOpportunities,
    getOpportunity,
    createOpportunity,
    updateOpportunity,
    listCampaigns,
    getCampaign,
    createCampaign,
    updateCampaign,
    listCampaignLists,
    createCampaignList,
    listCampaignListMembers,
    addCampaignListMembers,
    removeCampaignListMembers,
    listConversations,
    getConversation,
    createConversation,
    updateConversation,
    listSends,
    getSend,
    createSend,
    updateSend,
    listSendEvents,
    recordSendEvent,
    findSendByTrackingToken,
    getTrackingToken,
  };
}

function personSelect() {
  return {
    id: crmPeople.id,
    name: crmPeople.name,
    emails: crmPeople.emails,
    phones: crmPeople.phones,
    jobTitle: crmPeople.jobTitle,
    companyId: crmPeople.companyId,
    stageKey: crmPeople.stageKey,
    doNotContact: crmPeople.doNotContact,
    notes: crmPeople.notes,
    linkedinUrl: crmPeople.linkedinUrl,
    location: crmPeople.location,
    timezone: crmPeople.timezone,
    source: crmPeople.source,
    createdByKind: crmPeople.createdByKind,
    createdById: crmPeople.createdById,
    createdByName: crmPeople.createdByName,
    createdAt: crmPeople.createdAt,
    updatedAt: crmPeople.updatedAt,
    companyName: crmCompanies.name,
    companyDomain: crmCompanies.domain,
  };
}

function slugify(name: string) {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 64) || "list"
  );
}

function mapPerson(row: {
  id: string;
  name: string;
  emails: string[];
  phones: string[];
  jobTitle: string | null;
  companyId: string | null;
  stageKey: string;
  doNotContact: boolean;
  notes: string | null;
  linkedinUrl: string | null;
  location: string | null;
  timezone: string | null;
  source: string;
  createdByKind: "user" | "bot" | "system";
  createdById: string;
  createdByName: string;
  createdAt: Date;
  updatedAt: Date;
  companyName: string | null;
  companyDomain: string | null;
}): CrmPerson {
  return {
    id: row.id,
    name: row.name,
    emails: row.emails,
    phones: row.phones,
    jobTitle: row.jobTitle,
    companyId: row.companyId,
    company:
      row.companyId && row.companyName
        ? {
            id: row.companyId,
            name: row.companyName,
            domain: row.companyDomain,
          }
        : null,
    stageKey: row.stageKey,
    doNotContact: row.doNotContact,
    notes: row.notes,
    linkedinUrl: row.linkedinUrl,
    location: row.location,
    timezone: row.timezone,
    source: row.source,
    createdBy: createdByOf(row),
    createdAt: requiredIso(row.createdAt),
    updatedAt: requiredIso(row.updatedAt),
  };
}

function mapCompany(row: {
  id: string;
  name: string;
  domain: string | null;
  website: string | null;
  industry: string | null;
  phone: string | null;
  location: string | null;
  notes: string | null;
  createdByKind: "user" | "bot" | "system";
  createdById: string;
  createdByName: string;
  createdAt: Date;
  updatedAt: Date;
}): CrmCompany {
  return {
    id: row.id,
    name: row.name,
    domain: row.domain,
    website: row.website,
    industry: row.industry,
    phone: row.phone,
    location: row.location,
    notes: row.notes,
    createdBy: createdByOf(row),
    createdAt: requiredIso(row.createdAt),
    updatedAt: requiredIso(row.updatedAt),
  };
}

function mapCampaignList(row: {
  id: string;
  campaignId: string;
  name: string;
  slug: string;
  description: string;
  memberCount: number;
  createdAt: Date;
  updatedAt: Date;
}): CrmCampaignList {
  return {
    id: row.id,
    campaignId: row.campaignId,
    name: row.name,
    slug: row.slug,
    description: row.description,
    memberCount: row.memberCount,
    createdAt: requiredIso(row.createdAt),
    updatedAt: requiredIso(row.updatedAt),
  };
}

function mapOpportunity(row: {
  id: string;
  name: string;
  stage: string;
  position: number;
  amountCents: number | null;
  currency: string;
  companyId: string | null;
  personId: string | null;
  expectedCloseAt: Date | null;
  notes: string | null;
  createdByKind: "user" | "bot" | "system";
  createdById: string;
  createdByName: string;
  createdAt: Date;
  updatedAt: Date;
  companyName: string | null;
  personName: string | null;
}): CrmOpportunity {
  return {
    id: row.id,
    name: row.name,
    stage: normalizeDealStage(row.stage),
    position: row.position,
    amountCents: row.amountCents,
    currency: row.currency,
    companyId: row.companyId,
    personId: row.personId,
    company:
      row.companyId && row.companyName
        ? { id: row.companyId, name: row.companyName }
        : null,
    person:
      row.personId && row.personName
        ? { id: row.personId, name: row.personName }
        : null,
    expectedCloseAt: iso(row.expectedCloseAt),
    notes: row.notes,
    createdBy: createdByOf(row),
    createdAt: requiredIso(row.createdAt),
    updatedAt: requiredIso(row.updatedAt),
  };
}

function mapCampaign(row: {
  id: string;
  name: string;
  status: string;
  description: string | null;
  startedAt: Date | null;
  endedAt: Date | null;
  notes: string | null;
  createdByKind: "user" | "bot" | "system";
  createdById: string;
  createdByName: string;
  createdAt: Date;
  updatedAt: Date;
}): CrmCampaign {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    description: row.description,
    startedAt: iso(row.startedAt),
    endedAt: iso(row.endedAt),
    notes: row.notes,
    createdBy: createdByOf(row),
    createdAt: requiredIso(row.createdAt),
    updatedAt: requiredIso(row.updatedAt),
  };
}

function mapConversation(row: {
  id: string;
  subject: string;
  channel: string;
  body: string | null;
  personId: string | null;
  companyId: string | null;
  occurredAt: Date;
  createdByKind: "user" | "bot" | "system";
  createdById: string;
  createdByName: string;
  createdAt: Date;
  updatedAt: Date;
  personName: string | null;
  companyName: string | null;
}): CrmConversation {
  return {
    id: row.id,
    subject: row.subject,
    channel: row.channel,
    body: row.body,
    personId: row.personId,
    companyId: row.companyId,
    person:
      row.personId && row.personName
        ? { id: row.personId, name: row.personName }
        : null,
    company:
      row.companyId && row.companyName
        ? { id: row.companyId, name: row.companyName }
        : null,
    occurredAt: requiredIso(row.occurredAt),
    createdBy: createdByOf(row),
    createdAt: requiredIso(row.createdAt),
    updatedAt: requiredIso(row.updatedAt),
  };
}

function mapSend(
  row: {
    id: string;
    kind: CrmSendKind;
    status: CrmSendStatus;
    subject: string | null;
    body: string | null;
    toAddress: string;
    personId: string | null;
    companyId: string | null;
    campaignId: string | null;
    provider: string;
    sentAt: Date | null;
    createdByKind: "user" | "bot" | "system";
    createdById: string;
    createdByName: string;
    createdAt: Date;
    updatedAt: Date;
    personName: string | null;
    companyName: string | null;
    campaignName: string | null;
  },
  tracking:
    | {
        opens: number;
        clicks: number;
        uniqueOpens: number;
        uniqueClicks: number;
        lastEventAt: string | null;
      }
    | undefined,
): CrmSend {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    subject: row.subject,
    body: row.body,
    toAddress: row.toAddress,
    personId: row.personId,
    companyId: row.companyId,
    campaignId: row.campaignId,
    person:
      row.personId && row.personName
        ? { id: row.personId, name: row.personName }
        : null,
    company:
      row.companyId && row.companyName
        ? { id: row.companyId, name: row.companyName }
        : null,
    campaign:
      row.campaignId && row.campaignName
        ? { id: row.campaignId, name: row.campaignName }
        : null,
    provider: row.provider,
    sentAt: iso(row.sentAt),
    tracking: tracking ?? {
      opens: 0,
      clicks: 0,
      uniqueOpens: 0,
      uniqueClicks: 0,
      lastEventAt: null,
    },
    createdBy: createdByOf(row),
    createdAt: requiredIso(row.createdAt),
    updatedAt: requiredIso(row.updatedAt),
  };
}

export function deriveThreadStatus(send: CrmSend | null): CrmThreadStatus {
  if (!send) return "none";
  if (send.status === "failed") return "failed";
  if (send.status === "answered" || send.status === "no_answer")
    return send.status;
  if (send.tracking.uniqueClicks > 0 || send.status === "clicked")
    return "clicked";
  if (send.tracking.uniqueOpens > 0 || send.status === "opened")
    return "opened";
  if (send.status === "draft" || send.status === "queued") return send.status;
  if (send.status === "logged") return "logged";
  if (send.status === "sent" || send.status === "delivered") return "sent";
  return "logged";
}

function nextStatus(
  current: CrmSendStatus,
  event: CrmSendEventType,
): CrmSendStatus {
  const rank: Record<CrmSendStatus, number> = {
    draft: 0,
    queued: 1,
    logged: 2,
    sent: 3,
    delivered: 4,
    opened: 5,
    clicked: 6,
    failed: 7,
    answered: 7,
    no_answer: 7,
  };
  const mapped: Record<CrmSendEventType, CrmSendStatus> = {
    sent: "sent",
    delivered: "delivered",
    opened: "opened",
    clicked: "clicked",
    failed: "failed",
    answered: "answered",
    no_answer: "no_answer",
  };
  const next = mapped[event];
  if (current === "failed" || current === "answered" || current === "no_answer")
    return current;
  return rank[next] >= rank[current] ? next : current;
}
