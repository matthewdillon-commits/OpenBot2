import { describe, expect, test } from "bun:test";
import type { AuditEventInput, AuditStore } from "../src/audit";
import type { AgentActor } from "../src/agents/profile-types";
import type { ActionPolicy } from "../src/computer/policy";
import { createCrmGateway } from "../src/crm/gateway";
import { parsePersonInput, parsePersonPatch } from "../src/crm/routes";
import { crmTools } from "../src/crm/tools";
import type {
  CrmCreatedBy,
  CrmPage,
  CrmPerson,
  CrmStore,
} from "../src/crm/store";
import { REFUSAL_MARKER } from "../src/plugins/tools";

const ACTOR: AgentActor = { id: "user-1", role: "user" };
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

function fakeStore(overrides: Partial<CrmStore> = {}): CrmStore & {
  created: CrmPerson[];
} {
  const created: CrmPerson[] = [];
  const missing = async () => {
    throw new Error("unused store method");
  };
  const emptyPage = async () => page([]);
  const store: CrmStore = {
    listPeople: async () => page([]),
    getPerson: async () => undefined,
    createPerson: async (input, createdBy) => {
      const row = person({
        name: input.name,
        emails: input.emails ?? [],
        createdBy,
      });
      created.push(row);
      return row;
    },
    updatePerson: async () => undefined,
    listCompanies: emptyPage,
    getCompany: missing,
    createCompany: missing,
    updateCompany: missing,
    listOpportunities: emptyPage,
    getOpportunity: missing,
    createOpportunity: missing,
    updateOpportunity: missing,
    listCampaigns: emptyPage,
    getCampaign: missing,
    createCampaign: missing,
    updateCampaign: missing,
    listConversations: emptyPage,
    getConversation: missing,
    createConversation: missing,
    updateConversation: missing,
    ...overrides,
  };
  return Object.assign(store, { created });
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
  });

  test("a person patch may omit the name", () => {
    expect(parsePersonPatch({ jobTitle: "Buyer" })).toEqual({
      ok: true,
      value: { jobTitle: "Buyer" },
    });
  });
});

describe("CRM tools", () => {
  test("are offered as four named tools", () => {
    const tools = crmTools({
      crm: {
        search: async () => "",
        get: async () => "",
        create: async () => "",
        update: async () => "",
      },
      botId: "risk",
      actor: ACTOR,
    });
    expect(tools.map((tool) => tool.name)).toEqual([
      "crm_search",
      "crm_get",
      "crm_create",
      "crm_update",
    ]);
  });
});

describe("CRM gateway", () => {
  test("a denied write is audited and writes nothing", async () => {
    const store = fakeStore();
    const { written, auditStore } = recorder();
    const gateway = createCrmGateway({
      store,
      database: {
        select: () => ({
          from: () => ({
            where: () => ({
              limit: async () => [{ name: "Risk" }],
            }),
          }),
        }),
      } as never,
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
  });

  test("a permitted create records the Bot as created-by and is audited", async () => {
    const store = fakeStore();
    const { written, auditStore } = recorder();
    const gateway = createCrmGateway({
      store,
      database: {
        select: () => ({
          from: () => ({
            where: () => ({
              limit: async () => [{ name: "Risk Analyst" }],
            }),
          }),
        }),
      } as never,
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

  test("search lists people when permitted", async () => {
    const store = fakeStore({
      listPeople: async () => page([person()]),
    });
    const { written, auditStore } = recorder();
    const gateway = createCrmGateway({
      store,
      database: {
        select: () => ({
          from: () => ({ where: () => ({ limit: async () => [] }) }),
        }),
      } as never,
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
