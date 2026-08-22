import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { AuditEventInput, AuditStore } from "../src/audit";
import { createAgentProfileStore } from "../src/agents/profile-store";
import type { AgentActor } from "../src/agents/profile-types";
import type { ActionPolicy } from "../src/computer/policy";
import { createCrmGateway } from "../src/crm/gateway";
import { createCrmStore } from "../src/crm/store";
import { createDatabase } from "../src/db/client";
import {
  agentProfiles,
  agents,
  crmCompanies,
  crmPeople,
  users,
} from "../src/db/schema";
import { REFUSAL_MARKER } from "../src/plugins/tools";
import { TEST_POOL } from "./support/database";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgres://openbot:openbot@localhost:5432/openbot";
const database = createDatabase(databaseUrl, TEST_POOL);
const store = createCrmStore(database);
const profileStore = createAgentProfileStore(
  database,
  new URL("https://managed.example.test/ag-ui"),
);

const testPrefix = `crm-${randomUUID()}`;
const createdUserIds: string[] = [];
const createdAgentIds: string[] = [];
const createdPersonIds: string[] = [];
const createdCompanyIds: string[] = [];

afterEach(async () => {
  for (const personId of createdPersonIds.splice(0)) {
    await database.delete(crmPeople).where(eq(crmPeople.id, personId));
  }
  for (const companyId of createdCompanyIds.splice(0)) {
    await database.delete(crmCompanies).where(eq(crmCompanies.id, companyId));
  }
  for (const agentId of createdAgentIds.splice(0)) {
    await database
      .delete(agentProfiles)
      .where(eq(agentProfiles.agentId, agentId));
    await database.delete(agents).where(eq(agents.id, agentId));
  }
  for (const userId of createdUserIds.splice(0)) {
    await database.delete(users).where(eq(users.id, userId));
  }
});

afterAll(async () => {
  await database.$client.close();
});

async function createUser(): Promise<AgentActor> {
  const id = `${testPrefix}-user-${randomUUID()}`;
  await database.insert(users).values({
    id,
    email: `${id}@example.test`,
    name: "CRM Test User",
  });
  createdUserIds.push(id);
  return { id, role: "user" };
}

async function createAgent(owner: AgentActor, name: string) {
  const profile = await profileStore.create(owner, {
    name,
    title: `${name} title`,
    roleDescription: `${name} role`,
    visibility: "private",
  });
  createdAgentIds.push(profile.id);
  return profile.id;
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

describe("CRM against a real store", () => {
  test("a person can be created, listed, and linked to a company", async () => {
    const actor = await createUser();
    const company = await store.createCompany(
      { name: "Acme", domain: "acme.test" },
      { kind: "user", id: actor.id, name: "CRM Test User" },
    );
    createdCompanyIds.push(company.id);

    const created = await store.createPerson(
      {
        name: "Casey Chen",
        emails: ["casey@acme.test"],
        phones: ["+1 555 0100"],
        jobTitle: "Buyer",
        companyId: company.id,
      },
      { kind: "user", id: actor.id, name: "CRM Test User" },
    );
    createdPersonIds.push(created.id);

    expect(created.company?.name).toBe("Acme");
    expect(created.createdBy).toEqual({
      kind: "user",
      id: actor.id,
      name: "CRM Test User",
    });

    const listed = await store.listPeople({ search: "Casey" });
    expect(listed.total).toBeGreaterThanOrEqual(1);
    expect(listed.items.some((row) => row.id === created.id)).toBe(true);

    const updated = await store.updatePerson(created.id, {
      jobTitle: "Lead Buyer",
    });
    expect(updated?.jobTitle).toBe("Lead Buyer");
    expect(updated?.company?.domain).toBe("acme.test");
  });

  test("a Bot write records the Bot name and is audited", async () => {
    const actor = await createUser();
    const botId = await createAgent(actor, "Risk Analyst");
    const { written, auditStore } = recorder();
    const gateway = createCrmGateway({
      store,
      database,
      auditStore,
      policy: () => PERMISSIVE,
    });

    const answer = await gateway.create({
      botId,
      actor,
      kind: "person",
      fields: { name: "Jordan Lee", emails: ["jordan@example.test"] },
    });

    expect(answer).toContain("Created person");
    const match = answer.match(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
    );
    expect(match?.[0]).toBeTruthy();
    if (match?.[0]) createdPersonIds.push(match[0]);

    const created = await store.getPerson(match?.[0] ?? "");
    expect(created?.createdBy).toEqual({
      kind: "bot",
      id: botId,
      name: "Risk Analyst",
    });
    expect(written[0]?.eventType).toBe("crm.record_written");
    expect(written[0]?.payload).toMatchObject({
      bot: botId,
      kind: "person",
      action: "write",
      decision: { carriedOut: true },
    });
  });

  test("policy deny writes nothing", async () => {
    const actor = await createUser();
    const botId = await createAgent(actor, "Risk Analyst");
    const { written, auditStore } = recorder();
    const gateway = createCrmGateway({
      store,
      database,
      auditStore,
      policy: () => DENY_CRM,
    });

    const before = await store.listPeople({ search: testPrefix });
    const answer = await gateway.create({
      botId,
      actor,
      kind: "person",
      fields: { name: `${testPrefix} denied` },
    });

    expect(answer.startsWith(REFUSAL_MARKER)).toBe(true);
    const after = await store.listPeople({ search: `${testPrefix} denied` });
    expect(after.total).toBe(before.total);
    expect(after.items).toEqual([]);
    expect(written[0]?.eventType).toBe("crm.record_refused");
    expect(written[0]?.payload).toMatchObject({
      decision: { carriedOut: false, source: "deny" },
    });
  });
});
