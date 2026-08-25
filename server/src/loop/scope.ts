/**
 * Which goal a governed tool call is on, so a high-risk wait can land on that
 * channel rather than inventing a second surface.
 *
 * Set around execute in loadToolsForActor. Gateways read it after policy permits.
 */
import { AsyncLocalStorage } from "node:async_hooks";

export type GoalActionScope = {
  orgId: string;
  channelId: string;
  goalId: string;
  threadId?: string;
  jobId?: string;
  actorId: string;
  botId: string;
  toolName: string;
  args: Record<string, unknown>;
  /**
   * Set when the owner chose keep and we are carrying the pending action out.
   * Absent, a high-risk permit waits as an approval card.
   */
  carryOutHighRisk?: boolean;
};

export const goalActionScope = new AsyncLocalStorage<GoalActionScope>();

export function currentGoalActionScope(): GoalActionScope | undefined {
  return goalActionScope.getStore();
}

export function runInGoalActionScope<T>(
  scope: GoalActionScope,
  run: () => T,
): T {
  return goalActionScope.run(scope, run);
}
