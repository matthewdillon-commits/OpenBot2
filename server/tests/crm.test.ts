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
import type {
  CrmCreatedBy,
  CrmPage,
  CrmPerson,
  CrmSend,
  CrmStore,
} from "../src/crm/store";
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
    notes: null,
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

function page<T>(items: T[]): CrmPage<T> {
  return { items, nextCursor: null, total: items.length };
}

function unused(): never {
  throw new Error("unused store method");
}

function fakeStore(overrides: Partial<CrmStore> = {}): CrmStore & {
  created: CrmPerson[];
  sent: CrmSend[];
} {
  const created: CrmPerson[] = [];
  const sent: CrmSend[] = [];
  const emptyPage = async () => page([]);
  const store: CrmStore = {
    listPeople: async () => page([]),
    getPerson: async () => undefined,
    createPerson: async (_orgId, input, createdBy) => {
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
    getCompany: unused,
    createCompany: unused,
    updateCompany: unused,
    listOpportunities: emptyPage,
    getOpportunity: unused,
    createOpportunity: unused,
    updateOpportunity: unused,
    listCampaigns: emptyPage,
    getCampaign: unused,
    createCampaign: unused,
    updateCampaign: unused,
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
  return Object.assign(store, { created, sent });
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
