import { and, desc, eq, sql } from "drizzle-orm";
import type { Database } from "../db/client";
import {
  crmCampaigns,
  crmCompanies,
  crmConversations,
  crmOpportunities,
  crmPeople,
} from "../db/schema";

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
  notes: string | null;
  createdBy: CrmCreatedBy;
  createdAt: string;
  updatedAt: string;
};

export type CrmOpportunity = {
  id: string;
  name: string;
  stage: string;
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

export type CrmListQuery = {
  search?: string;
  cursor?: string;
  limit?: number;
};

export type CrmPage<T> = {
  items: T[];
  nextCursor: string | null;
  total: number;
};

export type CrmCompanyInput = {
  name: string;
  domain?: string | null;
  website?: string | null;
  industry?: string | null;
  phone?: string | null;
  notes?: string | null;
};

export type CrmPersonInput = {
  name: string;
  emails?: string[];
  phones?: string[];
  jobTitle?: string | null;
  companyId?: string | null;
  notes?: string | null;
};

export type CrmOpportunityInput = {
  name: string;
  stage?: string;
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

export type CrmStore = {
  listPeople: (query?: CrmListQuery) => Promise<CrmPage<CrmPerson>>;
  getPerson: (id: string) => Promise<CrmPerson | undefined>;
  createPerson: (
    input: CrmPersonInput,
    createdBy: CrmCreatedBy,
  ) => Promise<CrmPerson>;
  updatePerson: (
    id: string,
    input: Partial<CrmPersonInput>,
  ) => Promise<CrmPerson | undefined>;

  listCompanies: (query?: CrmListQuery) => Promise<CrmPage<CrmCompany>>;
  getCompany: (id: string) => Promise<CrmCompany | undefined>;
  createCompany: (
    input: CrmCompanyInput,
    createdBy: CrmCreatedBy,
  ) => Promise<CrmCompany>;
  updateCompany: (
    id: string,
    input: Partial<CrmCompanyInput>,
  ) => Promise<CrmCompany | undefined>;

  listOpportunities: (query?: CrmListQuery) => Promise<CrmPage<CrmOpportunity>>;
  getOpportunity: (id: string) => Promise<CrmOpportunity | undefined>;
  createOpportunity: (
    input: CrmOpportunityInput,
    createdBy: CrmCreatedBy,
  ) => Promise<CrmOpportunity>;
  updateOpportunity: (
    id: string,
    input: Partial<CrmOpportunityInput>,
  ) => Promise<CrmOpportunity | undefined>;

  listCampaigns: (query?: CrmListQuery) => Promise<CrmPage<CrmCampaign>>;
  getCampaign: (id: string) => Promise<CrmCampaign | undefined>;
  createCampaign: (
    input: CrmCampaignInput,
    createdBy: CrmCreatedBy,
  ) => Promise<CrmCampaign>;
  updateCampaign: (
    id: string,
    input: Partial<CrmCampaignInput>,
  ) => Promise<CrmCampaign | undefined>;

  listConversations: (
    query?: CrmListQuery,
  ) => Promise<CrmPage<CrmConversation>>;
  getConversation: (id: string) => Promise<CrmConversation | undefined>;
  createConversation: (
    input: CrmConversationInput,
    createdBy: CrmCreatedBy,
  ) => Promise<CrmConversation>;
  updateConversation: (
    id: string,
    input: Partial<CrmConversationInput>,
  ) => Promise<CrmConversation | undefined>;
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

export function createCrmStore(database: Database): CrmStore {
  async function listPeople(
    query: CrmListQuery = {},
  ): Promise<CrmPage<CrmPerson>> {
    const limit = clampLimit(query.limit);
    const cursor = decodeCursor(query.cursor);
    const search = query.search?.trim();
    const filters = [];
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
    if (cursor) {
      filters.push(keysetAfter(crmPeople.createdAt, crmPeople.id, cursor));
    }

    const where = filters.length > 0 ? and(...filters) : undefined;
    const [{ total }] = await database
      .select({
        total: sql<number>`cast(count(*) as int)`,
      })
      .from(crmPeople)
      .where(
        search
          ? sql`(
              ${crmPeople.name} ilike ${`%${escapeLike(search)}%`} escape '\\'
              or coalesce(${crmPeople.jobTitle}, '') ilike ${`%${escapeLike(search)}%`} escape '\\'
              or exists (
                select 1 from unnest(${crmPeople.emails}) as email
                where email ilike ${`%${escapeLike(search)}%`} escape '\\'
              )
            )`
          : undefined,
      );

    const rows = await database
      .select({
        id: crmPeople.id,
        name: crmPeople.name,
        emails: crmPeople.emails,
        phones: crmPeople.phones,
        jobTitle: crmPeople.jobTitle,
        companyId: crmPeople.companyId,
        notes: crmPeople.notes,
        createdByKind: crmPeople.createdByKind,
        createdById: crmPeople.createdById,
        createdByName: crmPeople.createdByName,
        createdAt: crmPeople.createdAt,
        updatedAt: crmPeople.updatedAt,
        companyName: crmCompanies.name,
        companyDomain: crmCompanies.domain,
      })
      .from(crmPeople)
      .leftJoin(crmCompanies, eq(crmCompanies.id, crmPeople.companyId))
      .where(where)
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
      total,
    };
  }

  async function getPerson(id: string): Promise<CrmPerson | undefined> {
    const [row] = await database
      .select({
        id: crmPeople.id,
        name: crmPeople.name,
        emails: crmPeople.emails,
        phones: crmPeople.phones,
        jobTitle: crmPeople.jobTitle,
        companyId: crmPeople.companyId,
        notes: crmPeople.notes,
        createdByKind: crmPeople.createdByKind,
        createdById: crmPeople.createdById,
        createdByName: crmPeople.createdByName,
        createdAt: crmPeople.createdAt,
        updatedAt: crmPeople.updatedAt,
        companyName: crmCompanies.name,
        companyDomain: crmCompanies.domain,
      })
      .from(crmPeople)
      .leftJoin(crmCompanies, eq(crmCompanies.id, crmPeople.companyId))
      .where(eq(crmPeople.id, id))
      .limit(1);
    return row ? mapPerson(row) : undefined;
  }

  async function createPerson(
    input: CrmPersonInput,
    createdBy: CrmCreatedBy,
  ): Promise<CrmPerson> {
    const name = input.name.trim();
    if (!name) throw new Error("A person needs a name.");
    const [row] = await database
      .insert(crmPeople)
      .values({
        name,
        emails: cleanList(input.emails),
        phones: cleanList(input.phones),
        jobTitle: emptyToNull(input.jobTitle) ?? null,
        companyId: emptyToNull(input.companyId) ?? null,
        notes: emptyToNull(input.notes) ?? null,
        ...createdByColumns(createdBy),
      })
      .returning({ id: crmPeople.id });
    const created = await getPerson(row.id);
    if (!created) throw new Error("The person could not be read back.");
    return created;
  }

  async function updatePerson(
    id: string,
    input: Partial<CrmPersonInput>,
  ): Promise<CrmPerson | undefined> {
    const existing = await getPerson(id);
    if (!existing) return undefined;
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
    if (input.notes !== undefined) patch.notes = emptyToNull(input.notes);
    await database.update(crmPeople).set(patch).where(eq(crmPeople.id, id));
    return getPerson(id);
  }

  async function listCompanies(
    query: CrmListQuery = {},
  ): Promise<CrmPage<CrmCompany>> {
    const limit = clampLimit(query.limit);
    const cursor = decodeCursor(query.cursor);
    const search = query.search?.trim();
    const filters = [];
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
    if (cursor) {
      filters.push(
        keysetAfter(crmCompanies.createdAt, crmCompanies.id, cursor),
      );
    }
    const where = filters.length > 0 ? and(...filters) : undefined;
    const [{ total }] = await database
      .select({ total: sql<number>`cast(count(*) as int)` })
      .from(crmCompanies)
      .where(
        search
          ? sql`(
              ${crmCompanies.name} ilike ${`%${escapeLike(search)}%`} escape '\\'
              or coalesce(${crmCompanies.domain}, '') ilike ${`%${escapeLike(search)}%`} escape '\\'
              or coalesce(${crmCompanies.industry}, '') ilike ${`%${escapeLike(search)}%`} escape '\\'
            )`
          : undefined,
      );
    const rows = await database
      .select()
      .from(crmCompanies)
      .where(where)
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

  async function getCompany(id: string): Promise<CrmCompany | undefined> {
    const [row] = await database
      .select()
      .from(crmCompanies)
      .where(eq(crmCompanies.id, id))
      .limit(1);
    return row ? mapCompany(row) : undefined;
  }

  async function createCompany(
    input: CrmCompanyInput,
    createdBy: CrmCreatedBy,
  ): Promise<CrmCompany> {
    const name = input.name.trim();
    if (!name) throw new Error("A company needs a name.");
    const [row] = await database
      .insert(crmCompanies)
      .values({
        name,
        domain: emptyToNull(input.domain) ?? null,
        website: emptyToNull(input.website) ?? null,
        industry: emptyToNull(input.industry) ?? null,
        phone: emptyToNull(input.phone) ?? null,
        notes: emptyToNull(input.notes) ?? null,
        ...createdByColumns(createdBy),
      })
      .returning({ id: crmCompanies.id });
    const created = await getCompany(row.id);
    if (!created) throw new Error("The company could not be read back.");
    return created;
  }

  async function updateCompany(
    id: string,
    input: Partial<CrmCompanyInput>,
  ): Promise<CrmCompany | undefined> {
    const existing = await getCompany(id);
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
    if (input.notes !== undefined) patch.notes = emptyToNull(input.notes);
    await database
      .update(crmCompanies)
      .set(patch)
      .where(eq(crmCompanies.id, id));
    return getCompany(id);
  }

  async function listOpportunities(
    query: CrmListQuery = {},
  ): Promise<CrmPage<CrmOpportunity>> {
    const limit = clampLimit(query.limit);
    const cursor = decodeCursor(query.cursor);
    const search = query.search?.trim();
    const filters = [];
    if (search) {
      const pattern = `%${escapeLike(search)}%`;
      filters.push(
        sql`(
          ${crmOpportunities.name} ilike ${pattern} escape '\\'
          or ${crmOpportunities.stage} ilike ${pattern} escape '\\'
        )`,
      );
    }
    if (cursor) {
      filters.push(
        keysetAfter(crmOpportunities.createdAt, crmOpportunities.id, cursor),
      );
    }
    const where = filters.length > 0 ? and(...filters) : undefined;
    const [{ total }] = await database
      .select({ total: sql<number>`cast(count(*) as int)` })
      .from(crmOpportunities)
      .where(
        search
          ? sql`(
              ${crmOpportunities.name} ilike ${`%${escapeLike(search)}%`} escape '\\'
              or ${crmOpportunities.stage} ilike ${`%${escapeLike(search)}%`} escape '\\'
            )`
          : undefined,
      );
    const rows = await database
      .select({
        id: crmOpportunities.id,
        name: crmOpportunities.name,
        stage: crmOpportunities.stage,
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
      .where(where)
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
    id: string,
  ): Promise<CrmOpportunity | undefined> {
    const [row] = await database
      .select({
        id: crmOpportunities.id,
        name: crmOpportunities.name,
        stage: crmOpportunities.stage,
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
      .where(eq(crmOpportunities.id, id))
      .limit(1);
    return row ? mapOpportunity(row) : undefined;
  }

  async function createOpportunity(
    input: CrmOpportunityInput,
    createdBy: CrmCreatedBy,
  ): Promise<CrmOpportunity> {
    const name = input.name.trim();
    if (!name) throw new Error("An opportunity needs a name.");
    const [row] = await database
      .insert(crmOpportunities)
      .values({
        name,
        stage: input.stage?.trim() || "new",
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
    const created = await getOpportunity(row.id);
    if (!created) throw new Error("The opportunity could not be read back.");
    return created;
  }

  async function updateOpportunity(
    id: string,
    input: Partial<CrmOpportunityInput>,
  ): Promise<CrmOpportunity | undefined> {
    const existing = await getOpportunity(id);
    if (!existing) return undefined;
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name) throw new Error("An opportunity needs a name.");
      patch.name = name;
    }
    if (input.stage !== undefined) patch.stage = input.stage.trim() || "new";
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
      .where(eq(crmOpportunities.id, id));
    return getOpportunity(id);
  }

  async function listCampaigns(
    query: CrmListQuery = {},
  ): Promise<CrmPage<CrmCampaign>> {
    const limit = clampLimit(query.limit);
    const cursor = decodeCursor(query.cursor);
    const search = query.search?.trim();
    const filters = [];
    if (search) {
      const pattern = `%${escapeLike(search)}%`;
      filters.push(
        sql`(
          ${crmCampaigns.name} ilike ${pattern} escape '\\'
          or ${crmCampaigns.status} ilike ${pattern} escape '\\'
          or coalesce(${crmCampaigns.description}, '') ilike ${pattern} escape '\\'
        )`,
      );
    }
    if (cursor) {
      filters.push(
        keysetAfter(crmCampaigns.createdAt, crmCampaigns.id, cursor),
      );
    }
    const where = filters.length > 0 ? and(...filters) : undefined;
    const [{ total }] = await database
      .select({ total: sql<number>`cast(count(*) as int)` })
      .from(crmCampaigns)
      .where(
        search
          ? sql`(
              ${crmCampaigns.name} ilike ${`%${escapeLike(search)}%`} escape '\\'
              or ${crmCampaigns.status} ilike ${`%${escapeLike(search)}%`} escape '\\'
              or coalesce(${crmCampaigns.description}, '') ilike ${`%${escapeLike(search)}%`} escape '\\'
            )`
          : undefined,
      );
    const rows = await database
      .select()
      .from(crmCampaigns)
      .where(where)
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

  async function getCampaign(id: string): Promise<CrmCampaign | undefined> {
    const [row] = await database
      .select()
      .from(crmCampaigns)
      .where(eq(crmCampaigns.id, id))
      .limit(1);
    return row ? mapCampaign(row) : undefined;
  }

  async function createCampaign(
    input: CrmCampaignInput,
    createdBy: CrmCreatedBy,
  ): Promise<CrmCampaign> {
    const name = input.name.trim();
    if (!name) throw new Error("A campaign needs a name.");
    const [row] = await database
      .insert(crmCampaigns)
      .values({
        name,
        status: input.status?.trim() || "draft",
        description: emptyToNull(input.description) ?? null,
        startedAt: input.startedAt ? new Date(input.startedAt) : null,
        endedAt: input.endedAt ? new Date(input.endedAt) : null,
        notes: emptyToNull(input.notes) ?? null,
        ...createdByColumns(createdBy),
      })
      .returning({ id: crmCampaigns.id });
    const created = await getCampaign(row.id);
    if (!created) throw new Error("The campaign could not be read back.");
    return created;
  }

  async function updateCampaign(
    id: string,
    input: Partial<CrmCampaignInput>,
  ): Promise<CrmCampaign | undefined> {
    const existing = await getCampaign(id);
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
    if (input.startedAt !== undefined)
      patch.startedAt = input.startedAt ? new Date(input.startedAt) : null;
    if (input.endedAt !== undefined)
      patch.endedAt = input.endedAt ? new Date(input.endedAt) : null;
    if (input.notes !== undefined) patch.notes = emptyToNull(input.notes);
    await database
      .update(crmCampaigns)
      .set(patch)
      .where(eq(crmCampaigns.id, id));
    return getCampaign(id);
  }

  async function listConversations(
    query: CrmListQuery = {},
  ): Promise<CrmPage<CrmConversation>> {
    const limit = clampLimit(query.limit);
    const cursor = decodeCursor(query.cursor);
    const search = query.search?.trim();
    const filters = [];
    if (search) {
      const pattern = `%${escapeLike(search)}%`;
      filters.push(
        sql`(
          ${crmConversations.subject} ilike ${pattern} escape '\\'
          or ${crmConversations.channel} ilike ${pattern} escape '\\'
          or coalesce(${crmConversations.body}, '') ilike ${pattern} escape '\\'
        )`,
      );
    }
    if (cursor) {
      filters.push(
        keysetAfter(crmConversations.createdAt, crmConversations.id, cursor),
      );
    }
    const where = filters.length > 0 ? and(...filters) : undefined;
    const [{ total }] = await database
      .select({ total: sql<number>`cast(count(*) as int)` })
      .from(crmConversations)
      .where(
        search
          ? sql`(
              ${crmConversations.subject} ilike ${`%${escapeLike(search)}%`} escape '\\'
              or ${crmConversations.channel} ilike ${`%${escapeLike(search)}%`} escape '\\'
              or coalesce(${crmConversations.body}, '') ilike ${`%${escapeLike(search)}%`} escape '\\'
            )`
          : undefined,
      );
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
      .where(where)
      .orderBy(desc(crmConversations.occurredAt), desc(crmConversations.id))
      .limit(limit + 1);
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      items: page.map(mapConversation),
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

  async function getConversation(
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
      .where(eq(crmConversations.id, id))
      .limit(1);
    return row ? mapConversation(row) : undefined;
  }

  async function createConversation(
    input: CrmConversationInput,
    createdBy: CrmCreatedBy,
  ): Promise<CrmConversation> {
    const subject = input.subject.trim();
    if (!subject) throw new Error("A conversation needs a subject.");
    const [row] = await database
      .insert(crmConversations)
      .values({
        subject,
        channel: input.channel?.trim() || "note",
        body: emptyToNull(input.body) ?? null,
        personId: emptyToNull(input.personId) ?? null,
        companyId: emptyToNull(input.companyId) ?? null,
        occurredAt: input.occurredAt ? new Date(input.occurredAt) : undefined,
        ...createdByColumns(createdBy),
      })
      .returning({ id: crmConversations.id });
    const created = await getConversation(row.id);
    if (!created) throw new Error("The conversation could not be read back.");
    return created;
  }

  async function updateConversation(
    id: string,
    input: Partial<CrmConversationInput>,
  ): Promise<CrmConversation | undefined> {
    const existing = await getConversation(id);
    if (!existing) return undefined;
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
    if (input.occurredAt !== undefined)
      patch.occurredAt = input.occurredAt
        ? new Date(input.occurredAt)
        : existing.occurredAt;
    await database
      .update(crmConversations)
      .set(patch)
      .where(eq(crmConversations.id, id));
    return getConversation(id);
  }

  return {
    listPeople,
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
    listConversations,
    getConversation,
    createConversation,
    updateConversation,
  };
}

function mapPerson(row: {
  id: string;
  name: string;
  emails: string[];
  phones: string[];
  jobTitle: string | null;
  companyId: string | null;
  notes: string | null;
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
    emails: row.emails ?? [],
    phones: row.phones ?? [],
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
    notes: row.notes,
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
    notes: row.notes,
    createdBy: createdByOf(row),
    createdAt: requiredIso(row.createdAt),
    updatedAt: requiredIso(row.updatedAt),
  };
}

function mapOpportunity(row: {
  id: string;
  name: string;
  stage: string;
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
    stage: row.stage,
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
