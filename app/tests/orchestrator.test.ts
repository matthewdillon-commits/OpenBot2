import { describe, expect, test } from "bun:test";
import {
  coworkerDisplayName,
  ownerFacingCoworkerName,
  pickOrchestrator,
  pickOrchestratorId,
} from "@/lib/orchestrator";

describe("pickOrchestrator", () => {
  test("the packaged orchestrator is who a goal talks to, not a leftover specialist", () => {
    const knowledge = {
      id: "knowledge",
      name: "Knowledge",
      standingRole: null as const,
    };
    const orchestrator = {
      id: "general-assistant",
      name: "General Assistant",
      standingRole: "orchestrator" as const,
    };
    expect(pickOrchestrator([knowledge, orchestrator])).toEqual(orchestrator);
    expect(
      pickOrchestratorId(
        [knowledge, orchestrator],
        ["knowledge", "general-assistant"],
      ),
    ).toBe("general-assistant");
  });

  test("owner-facing name is LimitlessAI, not General Assistant", () => {
    expect(
      coworkerDisplayName(
        {
          id: "general-assistant",
          name: "General Assistant",
          standingRole: "orchestrator",
        },
        "LimitlessAI",
      ),
    ).toBe("LimitlessAI");
    expect(
      coworkerDisplayName(
        { id: "knowledge", name: "Knowledge", standingRole: null },
        "LimitlessAI",
      ),
    ).toBe("Knowledge");
    expect(
      ownerFacingCoworkerName(
        { id: "knowledge", name: "Knowledge", standingRole: null },
        "LimitlessAI",
      ),
    ).toBe("LimitlessAI");
    expect(
      ownerFacingCoworkerName(
        { id: "risk-analyst", name: "Risk Analyst", standingRole: null },
        "LimitlessAI",
      ),
    ).toBe("LimitlessAI");
  });
});
