/**
 * LimitlessAI is the one coworker the owner addresses. Leftover package names
 * may still exist; they are not the first screen and not the speaker on a goal.
 */

export const DEFAULT_ORCHESTRATOR_UNSCOPED_ID = "general-assistant";

export const LEFTOVER_COWORKER_NAMES = [
  "General Assistant",
  "Knowledge",
  "Risk Analyst",
] as const;

export function isLeftoverCoworkerName(name: string): boolean {
  return (LEFTOVER_COWORKER_NAMES as readonly string[]).includes(name);
}

export function isOrchestratorId(id: string): boolean {
  return (
    id === DEFAULT_ORCHESTRATOR_UNSCOPED_ID ||
    id.endsWith(`__${DEFAULT_ORCHESTRATOR_UNSCOPED_ID}`)
  );
}

export function agentIsOrchestrator(agent: {
  id: string;
  standingRole?: "orchestrator" | null;
}): boolean {
  return agent.standingRole === "orchestrator" || isOrchestratorId(agent.id);
}

/**
 * The packaged orchestrator, or the first listed coworker if the package has
 * not marked one. Home always starts a goal with this lead.
 */
export function pickOrchestrator<
  T extends { id: string; standingRole?: "orchestrator" | null },
>(agents: readonly T[] | undefined): T | undefined {
  if (!agents?.length) return undefined;
  return (
    agents.find((agent) => agent.standingRole === "orchestrator") ??
    agents.find((agent) => isOrchestratorId(agent.id)) ??
    agents[0]
  );
}

/**
 * Who speaks when a goal opens: the orchestrator in this room, else the lead.
 */
export function pickOrchestratorId(
  agents:
    | readonly { id: string; standingRole?: "orchestrator" | null }[]
    | undefined,
  memberIds: readonly string[],
): string | undefined {
  if (memberIds.length === 0) return undefined;
  const members = new Set(memberIds);
  const inRoom = agents?.filter((agent) => members.has(agent.id));
  const marked = pickOrchestrator(inRoom);
  if (marked) return marked.id;
  return memberIds.find((id) => isOrchestratorId(id)) ?? memberIds[0];
}

/** Owner-facing name: LimitlessAI, not leftover “General Assistant”. */
export function coworkerDisplayName(
  agent: {
    id: string;
    name: string;
    standingRole?: "orchestrator" | null;
  },
  productName: string,
): string {
  return agentIsOrchestrator(agent) ? productName : agent.name;
}

/**
 * What a typical owner may be told in the home/goal thread. Leftover package
 * names are not first-class coworkers there; See the work may still name them.
 */
export function ownerFacingCoworkerName(
  agent: {
    id: string;
    name: string;
    standingRole?: "orchestrator" | null;
  },
  productName: string,
): string {
  if (agentIsOrchestrator(agent) || isLeftoverCoworkerName(agent.name)) {
    return productName;
  }
  return agent.name;
}
