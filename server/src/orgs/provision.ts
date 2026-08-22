import { and, eq, isNotNull, isNull } from "drizzle-orm";
import type { Database } from "../db/client";
import { agentProfiles, agents } from "../db/schema";
import { scopedResourceId, unscopedResourceId } from "./constants";

/**
 * Give a newly created organization the packaged coworkers the appliance already has.
 *
 * Package agent ids are global primary keys, so a second org cannot reuse `general-assistant`.
 * Each copy is namespaced with {@link scopedResourceId} and stays system-owned.
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
    const id = scopedResourceId(toOrgId, unscopedResourceId(fromOrgId, row.id));
    const [agent] = await database
      .insert(agents)
      .values({
        id,
        orgId: toOrgId,
        name: row.name,
        type: row.type,
        configuration: row.configuration,
        packageId: row.packageId,
      })
      .onConflictDoNothing()
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
      .onConflictDoNothing();
    copied += 1;
  }

  return copied;
}
