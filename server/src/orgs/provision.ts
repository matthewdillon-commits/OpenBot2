import { and, eq, isNotNull, isNull } from "drizzle-orm";
import type { Database } from "../db/client";
import { agentProfiles, agents } from "../db/schema";
import { scopedResourceId, unscopedResourceId } from "./constants";

/**
 * Give an organization the packaged coworkers (orchestrator + specialist workers).
 *
 * Package agent ids are global primary keys, so a second org cannot reuse `general-assistant`.
 * Each copy is namespaced with {@link scopedResourceId} and stays system-owned.
 * Existing copies are refreshed from the package so a new worker or orchestrator
 * prompt lands on orgs that were created before that package revision.
 */
export async function copyPackageOwnedAgents(
  database: Database,
  fromOrgId: string,
  toOrgId: string,
): Promise<number> {
  if (fromOrgId === toOrgId) return 0;

  const rows = await database
    .select({
      id: agents.id,
      name: agents.name,
      type: agents.type,
      configuration: agents.configuration,
      packageId: agents.packageId,
      title: agentProfiles.title,
      roleDescription: agentProfiles.roleDescription,
      avatarSeed: agentProfiles.avatarSeed,
      visibility: agentProfiles.visibility,
    })
    .from(agents)
    .innerJoin(agentProfiles, eq(agentProfiles.agentId, agents.id))
    .where(
      and(
        eq(agents.orgId, fromOrgId),
        isNotNull(agents.packageId),
        isNull(agentProfiles.deletedAt),
      ),
    );

  let copied = 0;
  for (const row of rows) {
    const packageId = row.packageId;
    if (!packageId) continue;
    const id = scopedResourceId(toOrgId, unscopedResourceId(fromOrgId, row.id));
    const [agent] = await database
      .insert(agents)
      .values({
        id,
        orgId: toOrgId,
        name: row.name,
        type: row.type,
        configuration: row.configuration,
        packageId,
      })
      .onConflictDoUpdate({
        target: agents.id,
        setWhere: and(
          eq(agents.packageId, packageId),
          isNotNull(agents.packageId),
        ),
        set: {
          name: row.name,
          type: row.type,
          configuration: row.configuration,
          packageId,
          updatedAt: new Date(),
        },
      })
      .returning({ id: agents.id });
    if (!agent) continue;

    await database
      .insert(agentProfiles)
      .values({
        agentId: id,
        orgId: toOrgId,
        ownerUserId: null,
        title: row.title,
        roleDescription: row.roleDescription,
        avatarSeed: row.avatarSeed,
        visibility: row.visibility,
      })
      .onConflictDoUpdate({
        target: agentProfiles.agentId,
        setWhere: isNull(agentProfiles.ownerUserId),
        set: {
          title: row.title,
          roleDescription: row.roleDescription,
          avatarSeed: row.avatarSeed,
          visibility: row.visibility,
          deletedAt: null,
          updatedAt: new Date(),
        },
      });
    copied += 1;
  }

  return copied;
}
