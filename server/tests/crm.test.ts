import { describe, expect, test } from "bun:test";
import type { AgentActor } from "../src/agents/profile-types";
import type { AuditEventInput, AuditStore } from "../src/audit";
import type { ActionPolicy } from "../src/computer/policy";
import { createCrmGateway } from "../src/crm/gateway";
import {
  parsePersonInput,
  parsePersonPatch,
  parseSendInput,
} from "../src/crm/routes";
import {
  CONTACT_STAGE_KEYS,
  DEFAULT_DEAL_STAGE,
  normalizeContactStage,
  normalizeDealStage,
} from "../src/crm/stages";
import type {
  CrmCompany,
  CrmCreatedBy,
  CrmPage,
  CrmPerson,
  CrmSend,
  CrmStore,
} from "../src/crm/store";
import { deriveThreadStatus } from "../src/crm/store";
import { crmTools } from "../src/crm/tools";
import { REFUSAL_MARKER } from "../src/plugins/tools";

const ACTOR: AgentActor = { id: "user-1", role: "user", orgId: "org_local" };
const CREATED_BY: CrmCreatedBy = {
  kind: "user",
  id: "user-1",
  name: "Ada",
};

function person(overrides: Partial<CrmPerson> = {}): CrmPerson {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    name: "Casey Chen",
    emails: ["casey@acme.test"],
    phones: ["+1 555 0100"],
    jobTitle: "Buyer",
    companyId: null,
    company: null,
    stageKey: "new",
    doNotContact: false,
    notes: null,
    linkedinUrl: null,
    location: null,
    timezone: null,
    source: "manual",
    createdBy: CREATED_BY,
    createdAt: "2026-08-22T00:00:00.000Z",
    updatedAt: "2026-08-22T00:00:00.000Z",
    ...overrides,
  };
}

function send(overrides: Partial<CrmSend> = {}): CrmSend {
  return {
    id: "22222222-2222-2222-2222-222222222222",
    kind: "email",
    status: "logged",
    subject: "Hello",
    body: "Hi",
    toAddress: "casey@acme.test",
    personId: null,
    companyId: null,
    campaignId: null,
    person: null,
    company: null,
    campaign: null,
    provider: "logged",
    sentAt: null,
    tracking: {
      opens: 0,
      clicks: 0,
      uniqueOpens: 0,
      uniqueClicks: 0,
      lastEventAt: null,
    },
    createdBy: CREATED_BY,
    createdAt: "2026-08-22T00:00:00.000Z",
    updatedAt: "2026-08-22T00:00:00.000Z",
    ...overrides,
  };
}

function company(overrides: Partial<CrmCompany> = {}): CrmCompany {
  return {
    id: "33333333-3333-3333-3333-333333333333",
    name: "Acme",
    domain: null,
    website: null,
    industry: null,
    phone: null,
    location: null,
    notes: null,
    createdBy: CREATED_BY,
    createdAt: "2026-08-22T00:00:00.000Z",
    updatedAt: "2026-08-22T00:00:00.000Z",
    ...overrides,
  };
}

function page<T>(items: T[]): CrmPage<T> {
  return { items, nextCursor: null, total: items.length };
}

function unused(): never {
  throw new Error("unused store method");
}

function fakeStore(overrides: Partial<CrmStore> = {}): CrmStore & {
  created: CrmPerson[];
  companies: CrmCompany[];
  sent: CrmSend[];
} {
  const created: CrmPerson[] = [];
  const companies: CrmCompany[] = [];
  const sent: CrmSend[] = [];
  const emptyPage = async () => page([]);
  const store: CrmStore = {
    listPeople: async () => page([]),
    listThreads: async () => page([]),
    getPerson: async () => undefined,
    createPerson: async (_orgId, input, createdBy) => {
      const linked = companies.find((row) => row.id === input.companyId);
      const row = person({
        name: input.name,
        emails: input.emails ?? [],
        phones: input.phones ?? [],
        jobTitle: input.jobTitle ?? null,
        location: input.location ?? null,
        notes: input.notes ?? null,
        companyId: input.companyId ?? null,
        company: linked
          ? { id: linked.id, name: linked.name, domain: linked.domain }
          : null,
        createdBy,
      });
      created.push(row);
      return row;
    },
    updatePerson: async () => undefined,
    listCompanies: async (query) => {
      const search = query?.search?.trim().toLowerCase();
      const items = search
        ? companies.filter(
            (row) =>
              row.name.toLowerCase().includes(search) ||
              (row.domain ?? "").toLowerCase().includes(search),
          )
        : companies;
      return page(items);
    },
    getCompany: unused,
    createCompany: async (_orgId, input, createdBy) => {
      const row = company({
        id: `33333333-3333-3333-3333-${String(companies.length + 1).padStart(12, "0")}`,
        name: input.name,
        domain: input.domain ?? null,
        website: input.website ?? null,
        createdBy,
      });
      companies.push(row);
      return row;
    },
    updateCompany: unused,
    listOpportunities: emptyPage,
    getOpportunity: unused,
    createOpportunity: unused,
    updateOpportunity: unused,
    listCampaigns: emptyPage,
    getCampaign: unused,
    createCampaign: unused,
    updateCampaign: unused,
    listCampaignLists: async () => [],
    createCampaignList: unused,
    listCampaignListMembers: async () => ({ items: [], total: 0 }),
    addCampaignListMembers: unused,
    removeCampaignListMembers: unused,
    listConversations: emptyPage,
    getConversation: unused,
    createConversation: unused,
    updateConversation: unused,
    listSends: emptyPage,
    getSend: async () => undefined,
    createSend: async (_orgId, input, createdBy) => {
      const row = send({
        kind: input.kind,
        toAddress: input.toAddress,
        subject: input.subject ?? null,
        body: input.body ?? null,
        createdBy,
      });
      sent.push(row);
      return row;
    },
    updateSend: async (_orgId, id, input) =>
      send({
        id,
        status: input.status ?? "logged",
        provider: input.provider ?? "logged",
      }),
    listSendEvents: async () => [],
    recordSendEvent: async () => undefined,
    findSendByTrackingToken: async () => undefined,
    getTrackingToken: async () => undefined,
    ...overrides,
  };
  return Object.assign(store, { created, companies, sent });
}

function recorder() {
  const written: AuditEventInput[] = [];
  const auditStore: AuditStore = {
    insert: async (event) => {
      written.push(event);
    },
  };
  return { written, auditStore };
}

const PERMISSIVE: ActionPolicy = { mode: "enforce", deny: [], allow: ["true"] };
const DENY_CRM: ActionPolicy = {
  mode: "enforce",
  deny: ['intent == "crm"'],
  allow: ["true"],
};

const databaseStub = {
  select: () => ({
    from: () => ({
      where: () => ({
        limit: async () => [{ name: "Risk Analyst" }],
      }),
    }),
  }),
} as never;

describe("CRM input parsers", () => {
  test("a person create needs a name", () => {
    expect(parsePersonInput({})).toEqual({
      ok: false,
      error: "A name is required.",
    });
    expect(parsePersonInput({ name: "Casey", emails: ["a@b.test"] })).toEqual({
      ok: true,
      value: { name: "Casey", emails: ["a@b.test"] },
    });
    expect(
      parsePersonInput({ name: "Casey", stageKey: "contacted" }),
    ).toEqual({
      ok: true,
      value: { name: "Casey", stageKey: "contacted" },
    });
  });

  test("a person patch may omit the name", () => {
    expect(parsePersonPatch({ jobTitle: "Buyer" })).toEqual({
      ok: true,
      value: { jobTitle: "Buyer" },
    });
  });

  test("a send needs a kind and an address", () => {
    expect(parseSendInput({ kind: "email" })).toEqual({
      ok: false,
      error: "A to address or number is required.",
    });
    expect(
      parseSendInput({ kind: "sms", toAddress: "+15550100", body: "Hi" }),
    ).toEqual({
      ok: true,
      value: { kind: "sms", toAddress: "+15550100", body: "Hi" },
    });
  });
});

describe("CRM stages", () => {
  test("people start at new and deals at qualify", () => {
    expect(normalizeContactStage(undefined)).toBe("new");
    expect(normalizeContactStage("replied")).toBe("replied");
    expect(normalizeDealStage(undefined)).toBe(DEFAULT_DEAL_STAGE);
    expect(normalizeDealStage("new")).toBe("qualify");
    expect(CONTACT_STAGE_KEYS).toContain("dnc");
  });

  test("a conversation status prefers a click over an open, and a fail first", () => {
    expect(deriveThreadStatus(null)).toBe("none");
    expect(
      deriveThreadStatus(
        send({
          status: "sent",
          tracking: {
            opens: 2,
            clicks: 1,
            uniqueOpens: 1,
            uniqueClicks: 1,
            lastEventAt: "2026-08-22T00:00:00.000Z",
          },
        }),
      ),
    ).toBe("clicked");
    expect(
      deriveThreadStatus(
        send({
          status: "failed",
          tracking: {
            opens: 1,
            clicks: 0,
            uniqueOpens: 1,
            uniqueClicks: 0,
            lastEventAt: null,
          },
        }),
      ),
    ).toBe("failed");
  });
});

describe("CRM tools", () => {
  test("are offered as five named tools", () => {
    const tools = crmTools({
      crm: {
        search: async () => "",
        get: async () => "",
        create: async () => "",
        update: async () => "",
        send: async () => "",
      },
      botId: "risk",
      actor: ACTOR,
    });
    expect(tools.map((tool) => tool.name)).toEqual([
      "crm_search",
      "crm_get",
      "crm_create",
      "crm_update",
      "crm_send",
    ]);
  });
});

describe("CRM gateway", () => {
  test("a denied write is audited and writes nothing", async () => {
    const store = fakeStore();
    const { written, auditStore } = recorder();
    const gateway = createCrmGateway({
      store,
      database: databaseStub,
      auditStore,
      policy: () => DENY_CRM,
    });

    const answer = await gateway.create({
      botId: "risk",
      actor: ACTOR,
      kind: "person",
      fields: { name: "Casey Chen", emails: ["casey@acme.test"] },
    });

    expect(answer.startsWith(REFUSAL_MARKER)).toBe(true);
    expect(answer).toContain("crm_create");
    expect(store.created).toEqual([]);
    expect(written).toHaveLength(1);
    expect(written[0]?.eventType).toBe("crm.record_refused");
    expect(written[0]?.payload).toMatchObject({
      bot: "risk",
      kind: "person",
      action: "write",
      decision: { carriedOut: false, source: "deny" },
    });
    expect(written[0]?.orgId).toBe("org_local");
  });

  test("a denied send writes nothing", async () => {
    const store = fakeStore();
    const { written, auditStore } = recorder();
    const gateway = createCrmGateway({
      store,
      database: databaseStub,
      auditStore,
      policy: () => DENY_CRM,
    });

    const answer = await gateway.send({
      botId: "risk",
      actor: ACTOR,
      fields: { kind: "email", toAddress: "casey@acme.test" },
    });

    expect(answer.startsWith(REFUSAL_MARKER)).toBe(true);
    expect(store.sent).toEqual([]);
    expect(written[0]?.eventType).toBe("crm.record_refused");
  });

  test("a permitted create records the Bot as created-by and is audited", async () => {
    const store = fakeStore();
    const { written, auditStore } = recorder();
    const gateway = createCrmGateway({
      store,
      database: databaseStub,
      auditStore,
      policy: () => PERMISSIVE,
    });

    const answer = await gateway.create({
      botId: "risk",
      actor: ACTOR,
      kind: "person",
      fields: { name: "Casey Chen" },
    });

    expect(answer).toContain("Created person");
    expect(store.created).toHaveLength(1);
    expect(store.created[0]?.createdBy).toEqual({
      kind: "bot",
      id: "risk",
      name: "Risk Analyst",
    });
    expect(written[0]?.eventType).toBe("crm.record_written");
    expect(written[0]?.payload).toMatchObject({
      bot: "risk",
      kind: "person",
      action: "write",
      decision: { carriedOut: true },
    });
  });

  test("creating a person with company_name finds or creates the company and confirms the save", async () => {
    const store = fakeStore();
    const { auditStore } = recorder();
    const gateway = createCrmGateway({
      store,
      database: databaseStub,
      auditStore,
      policy: () => PERMISSIVE,
    });

    const answer = await gateway.create({
      botId: "risk",
      actor: ACTOR,
      kind: "person",
      fields: {
        name: "Sadiq Boodoo",
        jobTitle: "Owner",
        location: "Ontario",
        companyName: "Approved Financial Services",
        website: "https://approved.test",
      },
    });

    expect(store.companies).toHaveLength(1);
    expect(store.companies[0]?.name).toBe("Approved Financial Services");
    expect(store.companies[0]?.website).toBe("https://approved.test");
    expect(store.created[0]?.companyId).toBe(store.companies[0]?.id);
    expect(store.created[0]?.company?.name).toBe("Approved Financial Services");
    expect(answer).toContain("Created person");
    expect(answer).toContain("Sadiq Boodoo");
    expect(answer).toContain("Owner");
    expect(answer).toContain("Approved Financial Services");
    expect(answer).toContain("Ontario");
    expect(answer).toContain("CRM");
  });

  test("a second person at the same company reuses the row", async () => {
    const store = fakeStore();
    const { auditStore } = recorder();
    const gateway = createCrmGateway({
      store,
      database: databaseStub,
      auditStore,
      policy: () => PERMISSIVE,
    });

    await gateway.create({
      botId: "risk",
      actor: ACTOR,
      kind: "person",
      fields: { name: "Ada", companyName: "Acme Ltd" },
    });
    await gateway.create({
      botId: "risk",
      actor: ACTOR,
      kind: "person",
      fields: { name: "Grace", companyName: "acme ltd" },
    });

    expect(store.companies).toHaveLength(1);
    expect(store.created).toHaveLength(2);
    expect(store.created[1]?.companyId).toBe(store.created[0]?.companyId);
  });

  test("crm_create maps company_name onto the gateway fields", async () => {
    let captured: Record<string, unknown> | undefined;
    const tools = crmTools({
      crm: {
        search: async () => "",
        get: async () => "",
        create: async (input) => {
          captured = input.fields;
          return "ok";
        },
        update: async () => "",
        send: async () => "",
      },
      botId: "risk",
      actor: ACTOR,
    });
    const create = tools.find((tool) => tool.name === "crm_create");
    expect(create).toBeDefined();
    await create?.execute({
      kind: "person",
      name: "Maya Chen",
      company_name: "Northwind",
      job_title: "Buyer",
    });
    expect(captured).toMatchObject({
      name: "Maya Chen",
      companyName: "Northwind",
      jobTitle: "Buyer",
    });
  });

  test("search lists people when permitted", async () => {
    const store = fakeStore({
      listPeople: async () => page([person()]),
    });
    const { written, auditStore } = recorder();
    const gateway = createCrmGateway({
      store,
      database: databaseStub,
      auditStore,
      policy: () => PERMISSIVE,
    });

    const answer = await gateway.search({
      botId: "risk",
      actor: ACTOR,
      kind: "person",
    });

    expect(answer).toContain("Casey Chen");
    expect(written[0]?.eventType).toBe("crm.record_read");
  });
});
