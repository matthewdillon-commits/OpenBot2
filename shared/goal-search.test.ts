import { describe, expect, test } from "bun:test";
import {
  goalEmptyCopy,
  goalEmptyKind,
  goalMatchesQuery,
  goalMatchesStatus,
  normalizeGoalQuery,
  parseGoalListStatus,
} from "./goal-search";

const quarry = {
  name: "Research Ada Lovelace",
  lastMessage: "Found three sources.",
  lastAction: "Wrote the CRM person.",
};

describe("normalizeGoalQuery", () => {
  test("trims surrounding whitespace and keeps inner spaces", () => {
    expect(normalizeGoalQuery("  Ada  Lovelace  ")).toBe("Ada  Lovelace");
    expect(normalizeGoalQuery("")).toBe("");
    expect(normalizeGoalQuery("   ")).toBe("");
  });
});

describe("parseGoalListStatus", () => {
  test("accepts the three views and treats anything else as All", () => {
    expect(parseGoalListStatus("all")).toBe("all");
    expect(parseGoalListStatus("active")).toBe("active");
    expect(parseGoalListStatus("completed")).toBe("completed");
    expect(parseGoalListStatus("Active")).toBe("all");
    expect(parseGoalListStatus("")).toBe("all");
    expect(parseGoalListStatus(null)).toBe("all");
  });
});

describe("goalMatchesQuery", () => {
  test("matches case-insensitively on title, last message, and last action", () => {
    expect(goalMatchesQuery(quarry, "ada")).toBe(true);
    expect(goalMatchesQuery(quarry, "  ADA  ")).toBe(true);
    expect(goalMatchesQuery(quarry, "lovelace")).toBe(true);
    expect(goalMatchesQuery(quarry, "three sources")).toBe(true);
    expect(goalMatchesQuery(quarry, "CRM PERSON")).toBe(true);
  });

  test("a partial title is enough, and clearing the query matches everything", () => {
    expect(goalMatchesQuery(quarry, "Research")).toBe(true);
    expect(goalMatchesQuery(quarry, "   ")).toBe(true);
    expect(goalMatchesQuery(quarry, "")).toBe(true);
    expect(goalMatchesQuery(quarry, "nope")).toBe(false);
  });
});

describe("goalMatchesStatus", () => {
  test("the same goal is eligible in All and the view that owns its status", () => {
    expect(goalMatchesStatus("Active", "all")).toBe(true);
    expect(goalMatchesStatus("Active", "active")).toBe(true);
    expect(goalMatchesStatus("Active", "completed")).toBe(false);

    expect(goalMatchesStatus("Needs you", "all")).toBe(true);
    expect(goalMatchesStatus("Needs you", "active")).toBe(true);
    expect(goalMatchesStatus("Needs you", "completed")).toBe(false);

    expect(goalMatchesStatus("Done", "all")).toBe(true);
    expect(goalMatchesStatus("Done", "active")).toBe(false);
    expect(goalMatchesStatus("Done", "completed")).toBe(true);
  });
});

describe("goalEmptyKind", () => {
  test("does not claim an empty roster while loading, placeholder, or exiting", () => {
    const base = {
      pending: false,
      placeholder: false,
      exiting: false,
      rowCount: 0,
      query: "Ada",
      status: "all" as const,
    };
    expect(goalEmptyKind({ ...base, pending: true })).toBe("hold");
    expect(goalEmptyKind({ ...base, placeholder: true })).toBe("hold");
    expect(goalEmptyKind({ ...base, exiting: true })).toBe("hold");
    expect(goalEmptyKind(base)).toBe("no-matches");
  });

  test("distinguishes no goals yet from no search matches and no filter matches", () => {
    expect(
      goalEmptyKind({
        pending: false,
        placeholder: false,
        exiting: false,
        rowCount: 0,
        query: "",
        status: "all",
      }),
    ).toBe("no-goals");
    expect(
      goalEmptyKind({
        pending: false,
        placeholder: false,
        exiting: false,
        rowCount: 0,
        query: "Ada",
        status: "completed",
      }),
    ).toBe("no-matches");
    expect(
      goalEmptyKind({
        pending: false,
        placeholder: false,
        exiting: false,
        rowCount: 0,
        query: "  ",
        status: "active",
      }),
    ).toBe("no-filter-matches");
    expect(
      goalEmptyKind({
        pending: false,
        placeholder: false,
        exiting: false,
        rowCount: 1,
        query: "Ada",
        status: "all",
      }),
    ).toBe("none");
  });
});

describe("goalEmptyCopy", () => {
  test("quotes the trimmed query and does not reuse the no-goals sentence for search", () => {
    const matches = goalEmptyCopy("no-matches", "  Ada  ");
    expect(matches).toContain("No goals match your search");
    expect(matches).toContain("Ada");
    expect(matches).not.toContain("don't have goals yet");
    expect(goalEmptyCopy("no-goals", "Ada")).toContain("don't have goals yet");
    expect(goalEmptyCopy("no-filter-matches", "", "completed")).toBe(
      "No completed goals.",
    );
    expect(goalEmptyCopy("hold", "Ada")).toBeNull();
  });
});
