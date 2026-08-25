import { describe, expect, test } from "bun:test";
import { agentIsOrchestrator, standingRoleOf } from "../src/orchestrator";

describe("agentIsOrchestrator", () => {
  test("the packaged general-assistant is the orchestrator even when org-scoped", () => {
    expect(agentIsOrchestrator({ id: "general-assistant" }, "org_acme")).toBe(
      true,
    );
    expect(
      agentIsOrchestrator({ id: "org_acme__general-assistant" }, "org_acme"),
    ).toBe(true);
    expect(agentIsOrchestrator({ id: "knowledge" }, "org_acme")).toBe(false);
  });

  test("standing_role: orchestrator wins over leftover names", () => {
    expect(
      agentIsOrchestrator(
        { id: "custom-brain", standingRole: "orchestrator" },
        "org_acme",
      ),
    ).toBe(true);
    expect(standingRoleOf({ standingRole: "orchestrator" })).toBe(
      "orchestrator",
    );
    expect(standingRoleOf({ systemPrompt: "Be helpful." })).toBeNull();
  });
});
