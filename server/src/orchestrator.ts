/**
 * LimitlessAI is the one coworker the owner addresses. Specialists are on demand.
 *
 * Leftover package names (General Assistant, Knowledge, Risk Analyst) may still exist in
 * the tenant package. They are not first-class home items and not family nav.
 */
import { unscopedResourceId } from "./orgs/constants";

export const STANDING_ROLES = ["orchestrator"] as const;
export type StandingRole = (typeof STANDING_ROLES)[number];

/** Packaged built-in that is the orchestrator when YAML has not yet marked standing_role. */
export const DEFAULT_ORCHESTRATOR_UNSCOPED_ID = "general-assistant";

/**
 * Family names that must never appear in the owner nav. Not Sales / Website /
 * Marketing / Customer / Ops, and not leftover OpenBot coworker names as items.
 */
export const FAMILY_NAV_NAMES = [
  "Sales",
  "Website",
  "Marketing",
  "Customer",
  "Ops",
] as const;

export const LEFTOVER_COWORKER_NAMES = [
  "General Assistant",
  "Knowledge",
  "Risk Analyst",
] as const;

export function standingRoleOf(configuration: unknown): StandingRole | null {
  if (!configuration || typeof configuration !== "object") return null;
  const value = (configuration as { standingRole?: unknown }).standingRole;
  return value === "orchestrator" ? "orchestrator" : null;
}

export function agentIsOrchestrator(
  agent: { id: string; standingRole?: StandingRole | null },
  orgId: string,
): boolean {
  if (agent.standingRole === "orchestrator") return true;
  return (
    unscopedResourceId(orgId, agent.id) === DEFAULT_ORCHESTRATOR_UNSCOPED_ID
  );
}

/**
 * The operator door: A2A room behind “See the work”.
 *
 * Org owner and admin, and the deployment admin role, may open it. A typical
 * member may not. The browser renders this flag; it does not recompute it.
 */
export function canSeeTheWork(actor: {
  role?: string | null;
  orgRole?: string | null;
}): boolean {
  return (
    actor.role === "admin" ||
    actor.orgRole === "admin" ||
    actor.orgRole === "owner"
  );
}
