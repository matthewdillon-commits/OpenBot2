import { afterAll, beforeAll, expect, test } from "bun:test";
import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { createAgentProfileStore } from "../src/agents/profile-store";
import { createAgentRoutes } from "../src/agents/routes";
import { createAuditStore } from "../src/audit";
import type { AppVariables } from "../src/auth/guards";
import type { AuthConfig } from "../src/config";
import {
  createChannelRoutes,
  createChannelStore,
} from "../src/channels/routes";
import { createThreadIdentity } from "../src/channels/thread-identity";
import {
  createCredentialAdminService,
  createCredentialStore,
} from "../src/credentials";
import { createDatabase } from "../src/db/client";
import { bindRequestRls } from "../src/db/rls";
import { agents, users } from "../src/db/schema";
import { bootstrapOrganizations } from "../src/orgs/bootstrap";
import {
  computerIdFor,
  intelligenceUserId,
  LOCAL_ORGANIZATION_ID,
  scopedResourceId,
} from "../src/orgs/constants";
import { createOrganizationStore } from "../src/orgs/store";
import { createOrganizationSsoStore } from "../src/orgs/sso";
import { createPluginStore } from "../src/plugins/store";
import { TEST_POOL } from "./support/database";
import {
  createTestOrganization,
  ensureLocalOrganization,
  seedMembership,
} from "./support/organization";

const databaseUrl = process.env.DATABASE_URL;
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

const otherOrg = {
  id: `org_other_${suffix}`,
  slug: `other-${suffix}`.slice(0, 40),
  name: "Other Co",
};

const alice = {
  id: `user_alice_${suffix}`,
  email: `alice-${suffix}@openbot.test`,
};
const bob = {
  id: `user_bob_${suffix}`,
  email: `bob-${suffix}@openbot.test`,
};

let database: ReturnType<typeof createDatabase>;

beforeAll(async () => {
  if (!databaseUrl) return;
  database = createDatabase(databaseUrl, TEST_POOL);
  await ensureLocalOrganization(database);
  await createTestOrganization(database, otherOrg);
  await database.insert(users).values([
    { id: alice.id, email: alice.email, name: "Alice" },
    { id: bob.id, email: bob.email, name: "Bob" },
  ]);
  await seedMembership(database, alice.id, "owner", LOCAL_ORGANIZATION_ID);
  await seedMembership(database, bob.id, "owner", otherOrg.id);
});

afterAll(() => undefined);

test("a member of one org cannot read another org's coworker or channel", async () => {
  if (!databaseUrl) return;
  const profiles = createAgentProfileStore(
    database,
    new URL("http://localhost:9/ag-ui"),
  );
  const channels = createChannelStore(
    database,
    profiles,
    createThreadIdentity("test-deployment"),
  );

  const aliceActor = {
    id: alice.id,
    role: "admin" as const,
    orgId: LOCAL_ORGANIZATION_ID,
  };
  const bobActor = {
    id: bob.id,
    role: "admin" as const,
    orgId: otherOrg.id,
  };

  const aliceAgent = await profiles.create(aliceActor, {
    name: "Alice Bot",
    title: "Alice Bot",
    roleDescription: "Local only",
    visibility: "public",
  });
  const bobAgent = await profiles.create(bobActor, {
    name: "Bob Bot",
    title: "Bob Bot",
    roleDescription: "Other only",
    visibility: "public",
  });

  expect(await profiles.get(aliceActor, bobAgent.id)).toBeNull();
  expect(await profiles.get(bobActor, aliceAgent.id)).toBeNull();
  expect(
    (await profiles.list(aliceActor)).some((row) => row.id === bobAgent.id),
  ).toBe(false);

  const aliceChannel = await channels.create(aliceActor, [aliceAgent.id]);
  expect(await channels.get(bobActor, aliceChannel.id)).toBeNull();
});

test("Intelligence user ids are namespaced by organization", () => {
  expect(intelligenceUserId("org_a", "user_1")).toBe("org_a:user_1");
  expect(intelligenceUserId("org_a", "user_1")).not.toBe(
    intelligenceUserId("org_b", "user_1"),
  );
});

test("computer ids stay bare for the local org and are namespaced otherwise", () => {
  expect(computerIdFor(LOCAL_ORGANIZATION_ID, "analyst")).toBe("analyst");
  expect(computerIdFor("org_acme", "analyst")).toBe("org_acme__analyst");
  expect(computerIdFor("org_acme", "org_acme__analyst")).toBe(
    "org_acme__analyst",
  );
  expect(scopedResourceId(LOCAL_ORGANIZATION_ID, "github")).toBe("github");
  expect(scopedResourceId("org_acme", "github")).toBe("org_acme__github");
});

test("a skill and a credential in one org are invisible in another", async () => {
  if (!databaseUrl) return;
  const auditStore = createAuditStore(database);
  const pluginStore = createPluginStore({
    database,
    auditStore,
    credentials: { readSecret: async () => null },
    encryptionKey: "x".repeat(44),
    policy: () => ({ mode: "enforce", deny: [], allow: ["true"] }),
  });
  const credentials = createCredentialAdminService(
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    createCredentialStore(database),
    auditStore,
  );

  await pluginStore.installSkill({
    slug: `local-skill-${suffix}`,
    title: "Local only",
    summary: "",
    instructions: "Stay here.",
    ownerUserId: null,
    by: alice.email,
    orgId: LOCAL_ORGANIZATION_ID,
  });
  await pluginStore.installSkill({
    slug: `other-skill-${suffix}`,
    title: "Other only",
    summary: "",
    instructions: "Stay there.",
    ownerUserId: null,
    by: bob.email,
    orgId: otherOrg.id,
  });

  const localSlugs = (
    await pluginStore.listSkills({
      id: alice.id,
      isAdmin: true,
      orgId: LOCAL_ORGANIZATION_ID,
    })
  ).map((skill) => skill.slug);
  const otherSlugs = (
    await pluginStore.listSkills({
      id: bob.id,
      isAdmin: true,
      orgId: otherOrg.id,
    })
  ).map((skill) => skill.slug);

  expect(localSlugs).toContain(`local-skill-${suffix}`);
  expect(localSlugs).not.toContain(`other-skill-${suffix}`);
  expect(otherSlugs).toContain(`other-skill-${suffix}`);
  expect(otherSlugs).not.toContain(`local-skill-${suffix}`);

  const localCred = await credentials.create({
    kind: "mcp",
    provider: "test",
    keyId: `local-${suffix}`,
    metadata: {},
    plaintext: "local-secret",
    actorUserId: alice.id,
    orgId: LOCAL_ORGANIZATION_ID,
  });
  const otherCred = await credentials.create({
    kind: "mcp",
    provider: "test",
    keyId: `other-${suffix}`,
    metadata: {},
    plaintext: "other-secret",
    actorUserId: bob.id,
    orgId: otherOrg.id,
  });

  const localList = await credentials.list(LOCAL_ORGANIZATION_ID);
  const otherList = await credentials.list(otherOrg.id);
  expect(localList.some((row) => row.id === localCred.id)).toBe(true);
  expect(localList.some((row) => row.id === otherCred.id)).toBe(false);
  expect(otherList.some((row) => row.id === otherCred.id)).toBe(true);
  expect(otherList.some((row) => row.id === localCred.id)).toBe(false);

  const vault = createCredentialStore(database);
  expect(
    await vault.readSecret(otherCred.id, LOCAL_ORGANIZATION_ID),
  ).toBeNull();
  expect(await vault.readSecret(localCred.id, otherOrg.id)).toBeNull();
  expect(
    await vault.readSecret(localCred.id, LOCAL_ORGANIZATION_ID),
  ).not.toBeNull();
});

test("HTTP routes 404 another organization's channel and agent", async () => {
  if (!databaseUrl) return;
  const profiles = createAgentProfileStore(
    database,
    new URL("http://localhost:9/ag-ui"),
  );
  const channels = createChannelStore(
    database,
    profiles,
    createThreadIdentity("test-deployment"),
  );
  const aliceActor = {
    id: alice.id,
    email: alice.email,
    role: "admin" as const,
    orgId: LOCAL_ORGANIZATION_ID,
    orgRole: "owner" as const,
  };
  const bobActor = {
    id: bob.id,
    email: bob.email,
    role: "admin" as const,
    orgId: otherOrg.id,
    orgRole: "owner" as const,
  };
  const bobAgent = await profiles.create(bobActor, {
    name: "Bob HTTP Bot",
    title: "Bob HTTP Bot",
    roleDescription: "Other only",
    visibility: "public",
  });
  const bobChannel = await channels.create(bobActor, [bobAgent.id]);

  const asAlice: MiddlewareHandler<{ Variables: AppVariables }> = async (
    context,
    next,
  ) => {
    context.set("actor", aliceActor);
    await next();
  };
  const app = new Hono()
    .route("/api/channels", createChannelRoutes(channels, asAlice))
    .route("/api/agents", createAgentRoutes(profiles, asAlice, false));

  const channelResponse = await app.request(
    `http://openbot.test/api/channels/${bobChannel.id}`,
  );
  expect(channelResponse.status).toBe(404);

  const agentResponse = await app.request(
    `http://openbot.test/api/agents/${bobAgent.id}`,
  );
  expect(agentResponse.status).toBe(404);
});

test("bootstrap does not add a customer member to the local org", async () => {
  if (!databaseUrl) return;
  const store = createOrganizationStore(database);
  await bootstrapOrganizations(database, store, { singleUser: false });
  const memberships = await store.listForUser(bob.id);
  expect(memberships.map((row) => row.id)).toEqual([otherOrg.id]);
});

test("a person with no membership is not auto-joined once a second org exists", async () => {
  if (!databaseUrl) return;
  const store = createOrganizationStore(database);
  const lonely = {
    id: `user_lonely_${suffix}`,
    email: `lonely-${suffix}@openbot.test`,
  };
  await database.insert(users).values({
    id: lonely.id,
    email: lonely.email,
    name: "Lonely",
  });
  expect(await store.joinIfSoleOrganization(lonely.id)).toBeNull();
  expect(await store.listForUser(lonely.id)).toEqual([]);
});

test("thread fingerprints differ across organizations", () => {
  const identity = createThreadIdentity("shared-project");
  const local = identity.mint(LOCAL_ORGANIZATION_ID);
  const other = identity.mint(otherOrg.id);
  expect(identity.owns(local, LOCAL_ORGANIZATION_ID)).toBe(true);
  expect(identity.owns(other, otherOrg.id)).toBe(true);
  expect(identity.owns(other, LOCAL_ORGANIZATION_ID)).toBe(false);
  expect(identity.owns(local, otherOrg.id)).toBe(false);
});

const TEST_AUTH: AuthConfig = {
  baseUrl: "http://localhost:3001",
  secret: "x".repeat(32),
  trustedOrigins: [],
  initialAdminEmails: [],
  emailPassword: true,
  google: { clientId: "id", clientSecret: "secret" },
};

test("Postgres RLS hides another org's rows from a sloppy query", async () => {
  if (!databaseUrl) return;
  const rlsDb = createDatabase(databaseUrl, { max: 2 });
  await rlsDb.insert(agents).values([
    {
      id: `rls_a_${suffix}`,
      orgId: LOCAL_ORGANIZATION_ID,
      name: "RLS A",
      type: "built_in",
      configuration: {},
    },
    {
      id: `rls_b_${suffix}`,
      orgId: otherOrg.id,
      name: "RLS B",
      type: "built_in",
      configuration: {},
    },
  ]);
  await rlsDb.execute(sql`grant openbot_rls to current_user`);
  try {
    await bindRequestRls(rlsDb, {
      orgId: LOCAL_ORGANIZATION_ID,
      bypass: false,
    });
    const rows = await rlsDb
      .select({ id: agents.id, orgId: agents.orgId })
      .from(agents);
    expect(rows.some((row) => row.id === `rls_a_${suffix}`)).toBe(true);
    expect(rows.some((row) => row.id === `rls_b_${suffix}`)).toBe(false);
    expect(rows.every((row) => row.orgId === LOCAL_ORGANIZATION_ID)).toBe(true);

    await bindRequestRls(rlsDb, { orgId: otherOrg.id, bypass: false });
    const otherRows = await rlsDb
      .select({ id: agents.id, orgId: agents.orgId })
      .from(agents);
    expect(otherRows.some((row) => row.id === `rls_b_${suffix}`)).toBe(true);
    expect(otherRows.some((row) => row.id === `rls_a_${suffix}`)).toBe(false);
    expect(otherRows.every((row) => row.orgId === otherOrg.id)).toBe(true);
  } finally {
    await bindRequestRls(rlsDb, { orgId: null, bypass: false });
  }
});

test("org A's SSO does not apply to org B", async () => {
  if (!databaseUrl) return;
  const sso = createOrganizationSsoStore(database);
  const domainA = `alice-${suffix}.example`;
  const domainB = `bob-${suffix}.example`;
  await sso.set(LOCAL_ORGANIZATION_ID, {
    googleEnabled: false,
    domains: [domainA],
  });
  await sso.set(otherOrg.id, {
    googleEnabled: true,
    domains: [domainB],
  });
  const forA = await sso.resolveForEmail(`owner@${domainA}`, TEST_AUTH);
  const forB = await sso.resolveForEmail(`owner@${domainB}`, TEST_AUTH);
  expect(forA.orgId).toBe(LOCAL_ORGANIZATION_ID);
  expect(forA.google).toBe(false);
  expect(forB.orgId).toBe(otherOrg.id);
  expect(forB.google).toBe(true);
});
