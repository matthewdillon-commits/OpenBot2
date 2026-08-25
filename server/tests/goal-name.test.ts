import { describe, expect, test } from "bun:test";
import { goalNameFromPrompt } from "../../shared/goal-name";

describe("goalNameFromPrompt", () => {
  test("uses the first sentence and does not use a coworker name", () => {
    expect(
      goalNameFromPrompt("Research these two people. Then write the CRM."),
    ).toBe("Research these two people.");
    expect(goalNameFromPrompt("")).toBe("New goal");
    expect(goalNameFromPrompt("   ")).toBe("New goal");
  });
});
