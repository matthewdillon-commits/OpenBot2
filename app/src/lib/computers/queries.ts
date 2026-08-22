import { queryOptions } from "@tanstack/react-query";
import { client } from "@/lib/client";

/** One Bot's computer, as Admin sees it. */
export type ComputerProfile = {
  botId: string;
  running: boolean;
  startedAt: string | null;
  /** Absent when the provider does not report egress at all, which is not the same as none. */
  egress?: string | null;
};

/** Whether each Bot has a browser profile of its own, or they share one. */
export type ComputerIsolation = "per-bot" | "shared";

/** What the list endpoint answers: the computers, and how they are separated. */
export type ComputerFleet = {
  computers: ComputerProfile[];
  isolation?: ComputerIsolation;
};

/**
 * Whether the boundary acts on its verdict.
 *
 * `dry-run` records what it would have refused without refusing it, which is how a policy is tried
 * out before it stops a Bot mid-task.
 */
export type PolicyMode = "dry-run" | "enforce";

/** The rules a Bot's actions are judged against. */
export type ActionPolicy = {
  mode: PolicyMode;
  deny: string[];
  allow: string[];
  /**
   * Whether Bots are offered a browser at all.
   *
   * Absent or `true` is on. `false` is the kill switch: the chat surface does not register the
   * tools, and the gateway refuses every computer action. MCP tools are not this.
   */
  browserEnabled?: boolean;
};

/**
 * Whether this deployment is offering Bots a browser right now.
 *
 * From the public capabilities endpoint, because the chat surface has to know and the policy
 * route is administrator-only.
 */
export type ComputerCapability = {
  browserEnabled: boolean;
};

export const computerKeys = {
  all: ["computers"] as const,
  fleet: () => ["computers", "fleet"] as const,
  policy: () => ["computers", "policy"] as const,
  capability: () => ["computers", "capability"] as const,
};

/**
 * A placeholder id in the path. The endpoint answers with every computer regardless, so this is
 * addressing a collection through a member's route rather than naming one.
 */
const FLEET_ID = "openbot-computer";

/** No envelope key: the body carries both the list and the isolation mode. */
export function computerFleetQueryOptions() {
  return queryOptions({
    queryKey: computerKeys.fleet(),
    queryFn: async (): Promise<ComputerFleet> => {
      const response = await client(`/api/computers/${FLEET_ID}/computers`, {
        fallback: "The computers could not be listed.",
      });
      return response.json();
    },
  });
}

export function actionPolicyQueryOptions() {
  return queryOptions({
    queryKey: computerKeys.policy(),
    queryFn: (): Promise<ActionPolicy> =>
      client("/api/computers/policy", "policy", {
        fallback: "The boundary could not be read.",
      }),
  });
}

/** The whole body, not an envelope. `browserEnabled` is only true when the server said so. */
export function computerCapabilityQueryOptions() {
  return queryOptions({
    queryKey: computerKeys.capability(),
    queryFn: async (): Promise<ComputerCapability> => {
      const response = await client("/api/capabilities", {
        fallback: "Could not load computer capability.",
      });
      const body = (await response.json()) as { browserEnabled?: unknown };
      return { browserEnabled: body.browserEnabled === true };
    },
  });
}
