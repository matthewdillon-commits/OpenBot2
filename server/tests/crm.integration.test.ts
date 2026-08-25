import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { createAgentProfileStore } from "../src/agents/profile-store";
import type { AgentActor } from "../src/agents/profile-types";
import type { AuditEventInput, AuditStore } from "../src/audit";
import type { ActionPolicy } from "../src/computer/policy";
import { createCrmGateway } from "../src/crm/gateway";
import { createCrmRoutes } from "../src/crm/routes";
import { createCrmStore } from "../src/crm/store";
import { createDatabase } from "../src/db/client";
import {
  agentProfiles,
  agents,
  crmCampaigns,
  crmCompanies,
  crmConversations,
  crmOpportunities,
  crmPeople,
  crmSendEvents,
  crmSends,
  organizationMemberships,
  users,
} from "../src/db/schema";
import { LOCAL_ORGANIZATION_ID } from "../src/orgs/constants";
import { REFUSAL_MARKER } from "../src/plugins/tools";
import { TEST_POOL } from "./support/database";
import {
  createTestOrganization,
  ensureLocalOrganization,
  seedMembership,
} from "./support/organization";

const databaseUrl = process.env.DATABASE_URL;
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const otherOrg = {
  id: `org_crm_${suffix}`,
  slug: `crm-${suffix}`.slice(0, 40),
  name: "Other CRM Co",
};

let database: ReturnType<typeof createDatabase>;
let store: ReturnType<typeof createCrmStore>;
let profileStore: ReturnType<typeof createAgentProfileStore>;

const createdUserIds: string[] = [];
const createdAgentIds: string[] = [];
const createdPersonIds: string[] = [];
const createdCompanyIds: string[] = [];
const createdCampaignIds: string[] = [];
const createdSendIds: string[] = [];
const createdConversationIds: string[] = [];
const createdOpportunityIds: string[] = [];

const PERMISSIVE: ActionPolicy = { mode: "enforce", deny: [], allow: ["true"] };
const DENY_CRM: ActionPolicy = {
  mode: "enforce",
  deny: ['intent == "crm"'],
  allow: ["true"],
};

function recorder() {
  const written: AuditEventInput[] = [];
  const auditStore: AuditStore = {
    insert: async (event) => {
      written.push(event);
    },
  };
  return { written, auditStore };
}

async function createUser(orgId = LOCAL_ORGANIZATION_ID): Promise<AgentActor> {
  const id = `crm-user-${randomUUID()}`;
  await database.insert(users).values({
    id,
    email: `${id}@example.test`,
    name: "CRM Test User",
  });
  createdUserIds.push(id);
  await seedMembership(database, id, "owner", orgId);
  return { id, role: "user", orgId };
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

if (databaseUrl) {
  database = createDatabase(databaseUrl, TEST_POOL);
  store = createCrmStore(database);
  profileStore = createAgentProfileStore(
    database,
    new URL("https://managed.example.test/ag-ui"),
  );
}

afterEach(async () => {
  if (!databaseUrl) return;
  for (const sendId of createdSendIds.splice(0)) {
    await database.delete(crmSendEvents).where(eq(crmSendEvents.sendId, sendId));
    await database.delete(crmSends).where(eq(crmSends.id, sendId));
  }
  for (const conversationId of createdConversationIds.splice(0)) {
    await database
      .delete(crmConversations)
      .where(eq(crmConversations.id, conversationId));
  }
  for (const opportunityId of createdOpportunityIds.splice(0)) {
    await database
      .delete(crmOpportunities)
      .where(eq(crmOpportunities.id, opportunityId));
  }
  for (const personId of createdPersonIds.splice(0)) {
    await database.delete(crmPeople).where(eq(crmPeople.id, personId));
  }
  for (const companyId of createdCompanyIds.splice(0)) {
    await database.delete(crmCompanies).where(eq(crmCompanies.id, companyId));
  }
  for (const campaignId of createdCampaignIds.splice(0)) {
    await database.delete(crmCampaigns).where(eq(crmCampaigns.id, campaignId));
  }
  for (const agentId of createdAgentIds.splice(0)) {
    await database
      .delete(agentProfiles)
      .where(eq(agentProfiles.agentId, agentId));
    await database.delete(agents).where(eq(agents.id, agentId));
  }
  for (const userId of createdUserIds.splice(0)) {
    await database
      .delete(organizationMemberships)
      .where(eq(organizationMemberships.userId, userId));
    await database.delete(users).where(eq(users.id, userId));
  }
});

afterAll(() => undefined);

describe("CRM against a real store", () => {
  test("a person can be created, listed, and linked to a company", async () => {
    if (!databaseUrl) return;
    await ensureLocalOrganization(database);
    const actor = await createUser();
    const company = await store.createCompany(
      actor.orgId ?? LOCAL_ORGANIZATION_ID,
      { name: "Acme", domain: "acme.test" },
      { kind: "user", id: actor.id, name: "CRM Test User" },
    );
    createdCompanyIds.push(company.id);

    const created = await store.createPerson(
      actor.orgId ?? LOCAL_ORGANIZATION_ID,
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

    const listed = await store.listPeople({
      orgId: actor.orgId,
      search: "Casey",
    });
    expect(listed.total).toBeGreaterThanOrEqual(1);
    expect(listed.items.some((row) => row.id === created.id)).toBe(true);

    const updated = await store.updatePerson(
      actor.orgId ?? LOCAL_ORGANIZATION_ID,
      created.id,
      { jobTitle: "Lead Buyer" },
    );
    expect(updated?.jobTitle).toBe("Lead Buyer");
    expect(updated?.company?.domain).toBe("acme.test");
  });

  test("a member of one org cannot read another org's contact", async () => {
    if (!databaseUrl) return;
    await ensureLocalOrganization(database);
    await createTestOrganization(database, otherOrg);
    const alice = await createUser(LOCAL_ORGANIZATION_ID);
    const bob = await createUser(otherOrg.id);

    const person = await store.createPerson(
      LOCAL_ORGANIZATION_ID,
      { name: "Alice Contact", emails: ["alice@local.test"] },
      { kind: "user", id: alice.id, name: "Alice" },
    );
    createdPersonIds.push(person.id);

    expect(await store.getPerson(otherOrg.id, person.id)).toBeUndefined();
    const bobList = await store.listPeople({ orgId: bob.orgId });
    expect(bobList.items.some((row) => row.id === person.id)).toBe(false);

    const company = await store.createCompany(
      LOCAL_ORGANIZATION_ID,
      { name: "Local Co" },
      { kind: "user", id: alice.id, name: "Alice" },
    );
    createdCompanyIds.push(company.id);
    await expect(
      store.createPerson(
        otherOrg.id,
        { name: "Linked", companyId: company.id },
        { kind: "user", id: bob.id, name: "Bob" },
      ),
    ).rejects.toThrow(/not in this organization/);
  });

  test("a Bot write records the Bot name and is audited", async () => {
    if (!databaseUrl) return;
    await ensureLocalOrganization(database);
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

    const created = await store.getPerson(
      actor.orgId ?? LOCAL_ORGANIZATION_ID,
      match?.[0] ?? "",
    );
    expect(created?.createdBy).toEqual({
      kind: "bot",
      id: botId,
      name: "Risk Analyst",
    });
    expect(written[0]?.eventType).toBe("crm.record_written");
    expect(written[0]?.orgId).toBe(actor.orgId);
  });

  test("creating a person with company_name finds or creates the company", async () => {
    if (!databaseUrl) return;
    await ensureLocalOrganization(database);
    const actor = await createUser();
    const botId = await createAgent(actor, "Risk Analyst");
    const { auditStore } = recorder();
    const gateway = createCrmGateway({
      store,
      database,
      auditStore,
      policy: () => PERMISSIVE,
    });
    const orgId = actor.orgId ?? LOCAL_ORGANIZATION_ID;

    const answer = await gateway.create({
      botId,
      actor,
      kind: "person",
      fields: {
        name: "Sadiq Boodoo",
        jobTitle: "Owner",
        location: "Ontario",
        companyName: "Approved Financial Services",
        website: "https://approved.test",
      },
    });

    expect(answer).toContain("Created person");
    expect(answer).toContain("Approved Financial Services");
    const match = answer.match(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
    );
    expect(match?.[0]).toBeTruthy();
    if (match?.[0]) createdPersonIds.push(match[0]);

    const created = await store.getPerson(orgId, match?.[0] ?? "");
    expect(created?.company?.name).toBe("Approved Financial Services");
    expect(created?.jobTitle).toBe("Owner");
    expect(created?.location).toBe("Ontario");
    if (created?.companyId) createdCompanyIds.push(created.companyId);

    const again = await gateway.create({
      botId,
      actor,
      kind: "person",
      fields: {
        name: "Other Contact",
        companyName: "approved financial services",
      },
    });
    const second = again.match(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
    );
    if (second?.[0]) createdPersonIds.push(second[0]);
    const linked = await store.getPerson(orgId, second?.[0] ?? "");
    expect(linked?.companyId).toBe(created?.companyId);
  });

  test("a second create of the same person at that company updates the row", async () => {
    if (!databaseUrl) return;
    await ensureLocalOrganization(database);
    const actor = await createUser();
    const botId = await createAgent(actor, "Risk Analyst");
    const { auditStore } = recorder();
    const gateway = createCrmGateway({
      store,
      database,
      auditStore,
      policy: () => PERMISSIVE,
    });
    const orgId = actor.orgId ?? LOCAL_ORGANIZATION_ID;

    const first = await gateway.create({
      botId,
      actor,
      kind: "person",
      fields: {
        name: "Sadiq Boodoo",
        jobTitle: "Principal Broker & CEO",
        location: "Ontario",
        companyName: "Approved Financial Services",
      },
    });
    expect(first).toContain("Created person");
    const match = first.match(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
    );
    expect(match?.[0]).toBeTruthy();
    if (match?.[0]) createdPersonIds.push(match[0]);

    const second = await gateway.create({
      botId,
      actor,
      kind: "person",
      fields: {
        name: "Sadiq Boodoo",
        jobTitle: "President & CEO",
        location: "Ontario",
        companyName: "Approved Financial Services",
      },
    });
    expect(second).toContain("Updated person");
    expect(second).toContain("President & CEO");

    const listed = await store.listPeople({ orgId, search: "Sadiq Boodoo" });
    const exact = listed.items.filter(
      (row) => row.name.toLowerCase() === "sadiq boodoo",
    );
    expect(exact).toHaveLength(1);
    expect(exact[0]?.jobTitle).toBe("President & CEO");
    expect(exact[0]?.company?.name).toBe("Approved Financial Services");
    if (exact[0]?.companyId) createdCompanyIds.push(exact[0].companyId);
  });

  test("policy deny writes nothing", async () => {
    if (!databaseUrl) return;
    await ensureLocalOrganization(database);
    const actor = await createUser();
    const botId = await createAgent(actor, "Risk Analyst");
    const { written, auditStore } = recorder();
    const gateway = createCrmGateway({
      store,
      database,
      auditStore,
      policy: () => DENY_CRM,
    });

    const before = await store.listPeople({ orgId: actor.orgId });
    const answer = await gateway.create({
      botId,
      actor,
      kind: "person",
      fields: { name: "Should Not Exist" },
    });
    const after = await store.listPeople({ orgId: actor.orgId });

    expect(answer.startsWith(REFUSAL_MARKER)).toBe(true);
    expect(after.total).toBe(before.total);
    expect(written[0]?.eventType).toBe("crm.record_refused");
  });

  test("an email send tracks opens and clicks without exposing the token", async () => {
    if (!databaseUrl) return;
    await ensureLocalOrganization(database);
    const actor = await createUser();
    const created = await store.createSend(
      actor.orgId ?? LOCAL_ORGANIZATION_ID,
      {
        kind: "email",
        toAddress: "casey@acme.test",
        subject: "Hello",
        body: "See https://example.test",
      },
      { kind: "user", id: actor.id, name: "CRM Test User" },
    );
    createdSendIds.push(created.id);

    expect(created).not.toHaveProperty("trackingToken");
    const listed = await store.listSends({ orgId: actor.orgId });
    expect(JSON.stringify(listed)).not.toContain("trackingToken");
    expect(listed.items.some((row) => row.id === created.id)).toBe(true);
    expect(listed.items.every((row) => !("trackingToken" in row))).toBe(true);

    const token = await store.getTrackingToken(
      actor.orgId ?? LOCAL_ORGANIZATION_ID,
      created.id,
    );
    expect(token).toBeTruthy();

    const app = new Hono();
    app.route(
      "/api/crm",
      createCrmRoutes(store, async (_context, next) => next()),
    );

    const open = await app.request(
      `http://openbot.test/api/crm/track/open/${token}.gif`,
    );
    expect(open.status).toBe(200);
    expect(open.headers.get("content-type")).toBe("image/gif");

    const click = await app.request(
      `http://openbot.test/api/crm/track/click/${token}?u=https://example.test/offer`,
    );
    expect(click.status).toBe(302);

    const events = await store.listSendEvents(
      actor.orgId ?? LOCAL_ORGANIZATION_ID,
      created.id,
    );
    expect(events.map((event) => event.eventType)).toEqual(
      expect.arrayContaining(["opened", "clicked"]),
    );
    const tracked = await store.getSend(
      actor.orgId ?? LOCAL_ORGANIZATION_ID,
      created.id,
    );
    expect(tracked?.tracking.uniqueOpens).toBe(1);
    expect(tracked?.tracking.uniqueClicks).toBe(1);
  });

  test("people list by stage and conversations come from sends", async () => {
    if (!databaseUrl) return;
    await ensureLocalOrganization(database);
    const actor = await createUser();
    const orgId = actor.orgId ?? LOCAL_ORGANIZATION_ID;
    const fresh = await store.createPerson(
      orgId,
      { name: "New Lead", emails: ["new@acme.test"] },
      { kind: "user", id: actor.id, name: "CRM Test User" },
    );
    createdPersonIds.push(fresh.id);
    const contacted = await store.createPerson(
      orgId,
      { name: "Reached", emails: ["reached@acme.test"], stageKey: "contacted" },
      { kind: "user", id: actor.id, name: "CRM Test User" },
    );
    createdPersonIds.push(contacted.id);
    expect(fresh.stageKey).toBe("new");
    expect(contacted.stageKey).toBe("contacted");

    const listed = await store.listPeople({ orgId, stage: "contacted" });
    expect(listed.items.every((row) => row.stageKey === "contacted")).toBe(true);
    expect(listed.items.some((row) => row.id === contacted.id)).toBe(true);
    expect(listed.items.some((row) => row.id === fresh.id)).toBe(false);
    expect(listed.stageCounts?.contacted).toBeGreaterThanOrEqual(1);
    expect(listed.totalAllStages).toBeGreaterThanOrEqual(listed.total);

    const deal = await store.createOpportunity(
      orgId,
      { name: "Acme seat" },
      { kind: "user", id: actor.id, name: "CRM Test User" },
    );
    createdOpportunityIds.push(deal.id);
    expect(deal.stage).toBe("qualify");
    const moved = await store.updateOpportunity(orgId, deal.id, {
      stage: "proposal",
    });
    expect(moved?.stage).toBe("proposal");

    const send = await store.createSend(
      orgId,
      {
        kind: "email",
        toAddress: "reached@acme.test",
        subject: "Hello",
        personId: contacted.id,
      },
      { kind: "user", id: actor.id, name: "CRM Test User" },
    );
    createdSendIds.push(send.id);
    const threads = await store.listThreads({ orgId, search: "Reached" });
    const thread = threads.items.find((row) => row.person.id === contacted.id);
    expect(thread?.latestSend?.id).toBe(send.id);
    expect(thread?.status).toBe("queued");
    expect(JSON.stringify(threads)).not.toContain("trackingToken");

    const withLinkedin = await store.updatePerson(orgId, contacted.id, {
      linkedinUrl: "https://linkedin.com/in/reached",
      location: "Toronto",
    });
    expect(withLinkedin?.linkedinUrl).toBe("https://linkedin.com/in/reached");
    expect(withLinkedin?.location).toBe("Toronto");

    const campaign = await store.createCampaign(
      orgId,
      { name: "Spring outbound", status: "active" },
      { kind: "user", id: actor.id, name: "CRM Test User" },
    );
    createdCampaignIds.push(campaign.id);
    const list = await store.createCampaignList(orgId, campaign.id, {
      name: "Warm leads",
    });
    expect(list.memberCount).toBe(0);
    const added = await store.addCampaignListMembers(orgId, list.id, [
      contacted.id,
    ]);
    expect(added.added).toBe(1);
    const members = await store.listCampaignListMembers(orgId, list.id);
    expect(members.total).toBe(1);
    expect(members.items[0]?.id).toBe(contacted.id);
    expect(await store.listCampaignLists(otherOrg.id, campaign.id)).toEqual([]);
    await expect(
      store.createCampaignList(otherOrg.id, campaign.id, { name: "Stolen" }),
    ).rejects.toThrow(/not here/);

    const dnc = await store.updatePerson(orgId, contacted.id, {
      stageKey: "dnc",
    });
    expect(dnc?.doNotContact).toBe(true);
    await expect(
      store.createSend(
        orgId,
        {
          kind: "email",
          toAddress: "reached@acme.test",
          personId: contacted.id,
        },
        { kind: "user", id: actor.id, name: "CRM Test User" },
      ),
    ).rejects.toThrow(/Do Not Contact/);
  });
});
