import { describe, expect, test } from "bun:test";
import {
  asJobOutcome,
  buildJobOutcome,
  extractCrmRecordIds,
  firstSentence,
  summarizeJobResult,
} from "../src/jobs/outcome";

describe("skinny job outcome", () => {
  test("summarizes the last assistant sentence, else a tool-success count", () => {
    expect(
      summarizeJobResult({
        status: "succeeded",
        assistantText:
          "Created person p_ada: Ada Lovelace. Confirm this save to the person in a sentence.",
      }),
    ).toBe("Created person p_ada: Ada Lovelace.");
    expect(
      summarizeJobResult({
        status: "succeeded",
        toolSuccessCount: 2,
      }),
    ).toBe("2 tools succeeded.");
    expect(
      summarizeJobResult({
        status: "failed",
        error: "The coworker could not be built for this run.",
      }),
    ).toBe("The coworker could not be built for this run.");
  });

  test("keeps CRM write ids already present in tool or assistant text", () => {
    expect(
      extractCrmRecordIds(
        "Created person p_ada: Ada Lovelace. Updated company c_acme: Acme.",
        "Created opportunity o_1: Deal.",
      ),
    ).toEqual(["p_ada", "c_acme", "o_1"]);
  });

  test("writes status, ids, finishedAt, and summary onto the outcome object", () => {
    const finishedAt = new Date("2026-08-25T04:00:00.000Z");
    expect(
      buildJobOutcome({
        status: "succeeded",
        finishedAt,
        channelId: "channel_1",
        agentId: "researcher",
        orgId: "org_local",
        actingUserId: "user-1",
        assistantText:
          "Created person p_ada: Ada Lovelace. Next I will email her.",
      }),
    ).toEqual({
      status: "succeeded",
      finishedAt: "2026-08-25T04:00:00.000Z",
      channelId: "channel_1",
      agentId: "researcher",
      orgId: "org_local",
      actingUserId: "user-1",
      summary: "Created person p_ada: Ada Lovelace.",
      crmRecordIds: ["p_ada"],
    });
  });

  test("rejects a malformed stored outcome", () => {
    expect(asJobOutcome({ status: "succeeded" })).toBeNull();
    expect(firstSentence("")).toBe("");
  });
});
