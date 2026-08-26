import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createDatabase } from "../src/db/client";
import {
  agentProfiles,
  agents,
  deploymentPackages,
  organizations,
} from "../src/db/schema";
import { scopedResourceId, unscopedResourceId } from "../src/orgs/constants";
import { copyPackageOwnedAgents } from "../src/orgs/provision";
import { TEST_POOL } from "./support/database";
import { createTestOrganization } from "./support/organization";

const database = createDatabase(
  process.env.DATABASE_URL ??
    "postgres://openbot:openbot@localhost:5432/openbot",
  TEST_POOL,
);

const createdAgentIds: string[] = [];
const createdPackageIds: string[] = [];
const createdOrgIds: string[] = [];

afterEach(async () => {
  for (const agentId of createdAgentIds.splice(0)) {
    await database.delete(agents).where(eq(agents.id, agentId));
  }
  for (const packageId of createdPackageIds.splice(0)) {
    await database
      .delete(deploymentPackages)
      .where(eq(deploymentPackages.id, packageId));
  }
  for (const orgId of createdOrgIds.splice(0)) {
    await database.delete(organizations).where(eq(organizations.id, orgId));
  }
});

afterAll(async () => {
  await database.$client.close();
});

describe("copyPackageOwnedAgents", () => {
  test("copies a new packaged worker onto an existing org and refreshes the prompt", async () => {
    const fromOrg = await createTestOrganization(database, {
      id: `org_from_${randomUUID().slice(0, 8)}`,
      slug: `from-${randomUUID().slice(0, 8)}`,
      name: "From Org",
    });
    const toOrg = await createTestOrganization(database, {
      id: `org_to_${randomUUID().slice(0, 8)}`,
      slug: `to-${randomUUID().slice(0, 8)}`,
      name: "To Org",
    });
    createdOrgIds.push(fromOrg.id, toOrg.id);

    const [pkg] = await database
      .insert(deploymentPackages)
      .values({
        tenantId: `pkg-${randomUUID()}`,
        sourcePath: "/tmp/package-test",
        checksum: randomUUID().replaceAll("-", ""),
      })
      .returning({ id: deploymentPackages.id });
    if (!pkg) throw new Error("package row missing");
    createdPackageIds.push(pkg.id);

    const sourceId = scopedResourceId(fromOrg.id, "campaign-worker");
    const destId = scopedResourceId(toOrg.id, "campaign-worker");
    createdAgentIds.push(sourceId, destId);

    await database.insert(agents).values({
      id: sourceId,
      orgId: fromOrg.id,
      name: "Email campaign",
      type: "built_in",
      configuration: { systemPrompt: "First prompt." },
      packageId: pkg.id,
    });
    await database.insert(agentProfiles).values({
      agentId: sourceId,
      orgId: fromOrg.id,
      ownerUserId: null,
      title: "Email campaign worker",
      roleDescription: "Run the campaign.",
      avatarSeed: "campaign-worker",
      visibility: "public",
    });

    expect(unscopedResourceId(fromOrg.id, sourceId)).toBe("campaign-worker");

    const copied = await copyPackageOwnedAgents(database, fromOrg.id, toOrg.id);
    expect(copied).toBe(1);

    const [first] = await database
      .select()
      .from(agents)
      .where(eq(agents.id, destId));
    expect(first?.configuration).toMatchObject({
      systemPrompt: "First prompt.",
    });

    await database
      .update(agents)
      .set({
        configuration: { systemPrompt: "Spawn with kind=campaign." },
      })
      .where(eq(agents.id, sourceId));

    const again = await copyPackageOwnedAgents(database, fromOrg.id, toOrg.id);
    expect(again).toBe(1);
    const [refreshed] = await database
      .select()
      .from(agents)
      .where(eq(agents.id, destId));
    expect(refreshed?.configuration).toMatchObject({
      systemPrompt: "Spawn with kind=campaign.",
    });

    const [profile] = await database
      .select()
      .from(agentProfiles)
      .where(eq(agentProfiles.agentId, destId));
    expect(profile?.title).toBe("Email campaign worker");
  });
});
