import { afterAll, beforeAll, expect, test } from "bun:test";
import { createAgentProfileStore } from "../src/agents/profile-store";
import { createAuditStore } from "../src/audit";
import { createChannelStore } from "../src/channels/routes";
import { createThreadIdentity } from "../src/channels/thread-identity";
import { createCredentialAdminService, createCredentialStore } from "../src/credentials";
import { createDatabase } from "../src/db/client";
import { users } from "../src/db/schema";
import {
  computerIdFor,
  intelligenceUserId,
  LOCAL_ORGANIZATION_ID,
  scopedResourceId,
} from "../src/orgs/constants";
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
  const profiles = createAgentProfileStore(database, new URL("http://localhost:9/ag-ui"));
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
  expect((await profiles.list(aliceActor)).some((row) => row.id === bobAgent.id)).toBe(
    false,
  );

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

  const localSlugs = (await pluginStore.listSkills({
    id: alice.id,
    isAdmin: true,
    orgId: LOCAL_ORGANIZATION_ID,
  })).map((skill) => skill.slug);
  const otherSlugs = (await pluginStore.listSkills({
    id: bob.id,
    isAdmin: true,
    orgId: otherOrg.id,
  })).map((skill) => skill.slug);

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
