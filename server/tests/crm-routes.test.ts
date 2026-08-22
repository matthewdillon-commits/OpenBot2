import { describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import type {
  CrmCreatedBy,
  CrmPage,
  CrmPerson,
  CrmStore,
} from "../src/crm/store";
import { loadConfig } from "../src/config";
import { testEnvironment } from "./support/environment";

const USER = {
  id: "member-1",
  email: "member@openbot.test",
  name: "A Member",
  image: null,
};

function person(overrides: Partial<CrmPerson> = {}): CrmPerson {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    name: "Casey Chen",
    emails: ["casey@acme.test"],
    phones: [],
    jobTitle: "Buyer",
    companyId: null,
    company: null,
    notes: null,
    createdBy: { kind: "user", id: USER.id, name: USER.name },
    createdAt: "2026-08-22T00:00:00.000Z",
    updatedAt: "2026-08-22T00:00:00.000Z",
    ...overrides,
  };
}

function emptyPage<T>(): CrmPage<T> {
  return { items: [], nextCursor: null, total: 0 };
}

function appWith(people: CrmPerson[]): {
  request: (path: string, init?: RequestInit) => Promise<Response>;
  createdBy: CrmCreatedBy[];
} {
  const createdBy: CrmCreatedBy[] = [];
  const unused = async () => {
    throw new Error("unused");
  };
  const store: CrmStore = {
    listPeople: async () => ({
      items: people,
      nextCursor: null,
      total: people.length,
    }),
    getPerson: async (id) => people.find((entry) => entry.id === id),
    createPerson: async (input, actor) => {
      createdBy.push(actor);
      return person({
        name: input.name,
        emails: input.emails ?? [],
        createdBy: actor,
      });
    },
    updatePerson: async (id, input) => {
      const existing = people.find((entry) => entry.id === id);
      if (!existing) return undefined;
      return { ...existing, ...input, name: input.name ?? existing.name };
    },
    listCompanies: async () => emptyPage(),
    getCompany: unused,
    createCompany: unused,
    updateCompany: unused,
    listOpportunities: async () => emptyPage(),
    getOpportunity: unused,
    createOpportunity: unused,
    updateOpportunity: unused,
    listCampaigns: async () => emptyPage(),
    getCampaign: unused,
    createCampaign: unused,
    updateCampaign: unused,
    listConversations: async () => emptyPage(),
    getConversation: unused,
    createConversation: unused,
    updateConversation: unused,
  };

  const app = createApp(
    loadConfig(testEnvironment()),
    {
      handler: () => new Response(null, { status: 204 }),
      api: { getSession: async () => ({ user: USER }) },
    } as never,
    { rolesForUser: async () => ["user"] },
    ...(Array.from({ length: 19 }) as never[]),
    store as never,
  );

  return {
    request: (path, init) => app.request(`http://openbot.test${path}`, init),
    createdBy,
  };
}

describe("CRM HTTP routes", () => {
  test("lists people for a signed-in user", async () => {
    const { request } = appWith([person()]);
    const response = await request("/api/crm/people");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      people: CrmPerson[];
      total: number;
    };
    expect(body.total).toBe(1);
    expect(body.people[0]?.name).toBe("Casey Chen");
  });

  test("creates a person and records the signed-in user as created-by", async () => {
    const { request, createdBy } = appWith([]);
    const response = await request("/api/crm/people", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Casey Chen", emails: ["casey@acme.test"] }),
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { person: CrmPerson };
    expect(body.person.name).toBe("Casey Chen");
    expect(createdBy).toEqual([{ kind: "user", id: USER.id, name: USER.name }]);
  });

  test("refuses a person without a name", async () => {
    const { request } = appWith([]);
    const response = await request("/api/crm/people", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ emails: ["casey@acme.test"] }),
    });
    expect(response.status).toBe(400);
  });

  test("answers 404 for a missing person", async () => {
    const { request } = appWith([]);
    const response = await request(
      "/api/crm/people/00000000-0000-0000-0000-000000000000",
    );
    expect(response.status).toBe(404);
  });
});
