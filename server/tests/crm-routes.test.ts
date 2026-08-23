import { describe, expect, test } from "bun:test";
import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import type { AppVariables } from "../src/auth/guards";
import { createCrmRoutes } from "../src/crm/routes";
import type {
  CrmCreatedBy,
  CrmPage,
  CrmPerson,
  CrmSend,
  CrmStore,
} from "../src/crm/store";

const USER = {
  id: "member-1",
  email: "member@openbot.test",
  name: "A Member",
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

function send(overrides: Partial<CrmSend> = {}): CrmSend {
  return {
    id: "22222222-2222-2222-2222-222222222222",
    kind: "email",
    status: "logged",
    subject: "Hello",
    body: "See https://example.test/offer",
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
    createdBy: { kind: "user", id: USER.id, name: USER.name },
    createdAt: "2026-08-22T00:00:00.000Z",
    updatedAt: "2026-08-22T00:00:00.000Z",
    ...overrides,
  };
}

function emptyPage<T>(): CrmPage<T> {
  return { items: [], nextCursor: null, total: 0 };
}

function unused(): never {
  throw new Error("unused");
}

function appWith(options?: {
  people?: CrmPerson[];
  orgId?: string | null;
  sendRow?: CrmSend;
  token?: string;
}): {
  request: (path: string, init?: RequestInit) => Promise<Response>;
  createdBy: CrmCreatedBy[];
  events: { sendId: string; eventType: string; linkUrl?: string | null }[];
} {
  const people = options?.people ?? [];
  const createdBy: CrmCreatedBy[] = [];
  const events: { sendId: string; eventType: string; linkUrl?: string | null }[] =
    [];
  const sendRow = options?.sendRow;
  const token = options?.token ?? "track-token";

  const store: CrmStore = {
    listPeople: async (query) => ({
      items: people,
      nextCursor: null,
      total: people.length,
      ...(query?.orgId ? {} : {}),
    }),
    getPerson: async (_orgId, id) => people.find((entry) => entry.id === id),
    createPerson: async (_orgId, input, actor) => {
      createdBy.push(actor);
      return person({
        name: input.name,
        emails: input.emails ?? [],
        createdBy: actor,
      });
    },
    updatePerson: async (_orgId, id, input) => {
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
    listSends: async () =>
      sendRow
        ? { items: [sendRow], nextCursor: null, total: 1 }
        : emptyPage(),
    getSend: async (_orgId, id) =>
      sendRow && sendRow.id === id ? sendRow : undefined,
    createSend: async (_orgId, input, actor) => {
      createdBy.push(actor);
      return send({
        kind: input.kind,
        toAddress: input.toAddress,
        subject: input.subject ?? null,
        body: input.body ?? null,
        createdBy: actor,
      });
    },
    updateSend: async (_orgId, id, input) =>
      send({
        id,
        status: input.status ?? "logged",
        provider: input.provider ?? "logged",
      }),
    listSendEvents: async () => [],
    recordSendEvent: async (input) => {
      events.push(input);
      return sendRow;
    },
    findSendByTrackingToken: async (value) =>
      sendRow && value === token
        ? {
            id: sendRow.id,
            orgId: "org_local",
            kind: sendRow.kind,
            status: sendRow.status,
            trackingToken: token,
          }
        : undefined,
    getTrackingToken: async () => token,
  };

  const requireUser: MiddlewareHandler<{ Variables: AppVariables }> = async (
    context,
    next,
  ) => {
    context.set("actor", {
      id: USER.id,
      email: USER.email,
      name: USER.name,
      role: "user",
      ...(options?.orgId === null
        ? {}
        : { orgId: options?.orgId ?? "org_local" }),
    });
    await next();
  };

  const app = new Hono();
  app.route("/api/crm", createCrmRoutes(store, requireUser));

  return {
    request: (path, init) => app.request(`http://openbot.test${path}`, init),
    createdBy,
    events,
  };
}

describe("CRM HTTP routes", () => {
  test("lists people for a signed-in member of an organization", async () => {
    const { request } = appWith({ people: [person()] });
    const response = await request("/api/crm/people");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      people: CrmPerson[];
      total: number;
    };
    expect(body.total).toBe(1);
    expect(body.people[0]?.name).toBe("Casey Chen");
    expect(JSON.stringify(body)).not.toContain("trackingToken");
  });

  test("refuses CRM reads without an organization", async () => {
    const { request } = appWith({ orgId: null });
    expect((await request("/api/crm/people")).status).toBe(403);
  });

  test("creates a person and records the signed-in user as created-by", async () => {
    const { request, createdBy } = appWith({ people: [] });
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
    const { request } = appWith({ people: [] });
    const response = await request("/api/crm/people", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ emails: ["casey@acme.test"] }),
    });
    expect(response.status).toBe(400);
  });

  test("answers 404 for a missing person", async () => {
    const { request } = appWith({ people: [] });
    const response = await request(
      "/api/crm/people/00000000-0000-0000-0000-000000000000",
    );
    expect(response.status).toBe(404);
  });

  test("records an email send without exposing the tracking token", async () => {
    const { request } = appWith({ people: [] });
    const response = await request("/api/crm/sends", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "email",
        toAddress: "casey@acme.test",
        subject: "Hello",
      }),
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { send: CrmSend };
    expect(body.send.kind).toBe("email");
    expect(body.send.toAddress).toBe("casey@acme.test");
    expect(body.send).not.toHaveProperty("trackingToken");
  });

  test("the open pixel records an open and returns a gif", async () => {
    const row = send();
    const { request, events } = appWith({ sendRow: row, token: "open-me" });
    const response = await request("/api/crm/track/open/open-me.gif");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/gif");
    expect(events).toEqual([{ sendId: row.id, eventType: "opened" }]);
  });

  test("a click rewrite records the URL and redirects", async () => {
    const row = send();
    const { request, events } = appWith({ sendRow: row, token: "click-me" });
    const response = await request(
      "/api/crm/track/click/click-me?u=https://example.test/offer",
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://example.test/offer");
    expect(events).toEqual([
      {
        sendId: row.id,
        eventType: "clicked",
        linkUrl: "https://example.test/offer",
      },
    ]);
  });

  test("a click without a real token is not an open redirect", async () => {
    const { request, events } = appWith({
      sendRow: send(),
      token: "click-me",
    });
    const response = await request(
      "/api/crm/track/click/unknown?u=https://evil.test",
    );
    expect(response.status).toBe(400);
    expect(events).toEqual([]);
  });
});
