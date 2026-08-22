import { describe, expect, test } from "bun:test";
import { toAgentOptions } from "./triggers";

describe("toAgentOptions", () => {
  const profiles = [
    { id: "knowledge", name: "Knowledge", title: "Docs" },
    { id: "risk-analyst", name: "Risk Analyst" },
  ];

  test("lists every visible coworker when no member filter is given", () => {
    expect(toAgentOptions(profiles).map((option) => option.id)).toEqual([
      "knowledge",
      "risk-analyst",
    ]);
  });

  test("can still narrow to a permitted set", () => {
    expect(
      toAgentOptions(profiles, ["risk-analyst"]).map((option) => option.id),
    ).toEqual(["risk-analyst"]);
  });
});
