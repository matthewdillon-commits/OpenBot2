import { describe, expect, test } from "bun:test";
import {
  FAMILY_NAV_NAMES,
  LEFTOVER_COWORKER_NAMES,
  ownerNavItems,
  visibleOwnerNavLabels,
} from "@/lib/nav/owner-nav";

describe("owner nav", () => {
  test("a typical owner does not see family names, leftover coworkers, or Agents", () => {
    const labels = visibleOwnerNavLabels({ canSeeTheWork: false });
    for (const name of FAMILY_NAV_NAMES) {
      expect(labels).not.toContain(name);
    }
    for (const name of LEFTOVER_COWORKER_NAMES) {
      expect(labels).not.toContain(name);
    }
    expect(labels).not.toContain("Agents");
    expect(labels).toEqual(["CRM", "Plugins", "Skills"]);
  });

  test("See the work operators may open Agents, still without family names", () => {
    const items = ownerNavItems({ canSeeTheWork: true });
    const labels = items.map((item) => item.label);
    for (const name of FAMILY_NAV_NAMES) {
      expect(labels).not.toContain(name);
    }
    for (const name of LEFTOVER_COWORKER_NAMES) {
      expect(labels).not.toContain(name);
    }
    expect(labels).toContain("Agents");
    expect(items.some((item) => item.to === "/agents")).toBe(true);
  });
});
