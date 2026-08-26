import { describe, expect, test } from "bun:test";
import {
  FAMILY_NAV_NAMES,
  LEFTOVER_COWORKER_NAMES,
  ownerNavItems,
  visibleOwnerNavLabels,
} from "@/lib/nav/owner-nav";

function assertOwnerRail(labels: string[]) {
  for (const name of FAMILY_NAV_NAMES) {
    expect(labels).not.toContain(name);
  }
  for (const name of LEFTOVER_COWORKER_NAMES) {
    expect(labels).not.toContain(name);
  }
  expect(labels).not.toContain("Agents");
  expect(labels).not.toContain("Measure");
  expect(labels).not.toContain("Approvals");
  expect(labels).not.toContain("Wakes");
  expect(labels).not.toContain("Triggers");
  expect(labels).toEqual(["CRM", "Plugins", "Skills"]);
}

describe("owner nav", () => {
  test("a typical owner does not see Agents, leftover coworkers, or family names", () => {
    assertOwnerRail(visibleOwnerNavLabels({ canSeeTheWork: false }));
  });

  test("See the work does not add Agents; Skills and Plugins stay in the owner rail", () => {
    const items = ownerNavItems({ canSeeTheWork: true });
    const labels = items.map((item) => item.label);
    assertOwnerRail(labels);
    expect(items.some((item) => item.to === "/plugins")).toBe(true);
    expect(items.some((item) => item.to === "/skills")).toBe(true);
    expect(items.some((item) => item.to === "/crm")).toBe(true);
  });
});
