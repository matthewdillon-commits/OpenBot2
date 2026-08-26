/**
 * Labels a typical owner may see in the app chrome. Family names and leftover
 * coworker names are not items. Agents is the operator roster, not home.
 * Skills and Plugins stay in the owner rail.
 */
export const FAMILY_NAV_NAMES = [
  "Sales",
  "Website",
  "Marketing",
  "Customer",
  "Ops",
] as const;

export const LEFTOVER_COWORKER_NAMES = [
  "General Assistant",
  "Knowledge",
  "Risk Analyst",
] as const;

/** Packaged specialist workers. Not owner-nav items; the owner talks to LimitlessAI. */
export const WORKER_COWORKER_NAMES = [
  "Email campaign",
  "Marketing research",
  "Always-on sales",
] as const;

export type OwnerNavItem = {
  to: "/" | "/crm" | "/plugins" | "/skills";
  label: string;
};

/**
 * Footer destinations next to the goal list. Composer + goals are the customer
 * door; this list must never grow family names, leftover coworker names, or
 * Agents. Skills and Plugins remain.
 */
export function ownerNavItems(_options: {
  canSeeTheWork: boolean;
}): OwnerNavItem[] {
  return [
    { to: "/crm", label: "CRM" },
    { to: "/plugins", label: "Plugins" },
    { to: "/skills", label: "Skills" },
  ];
}

export function visibleOwnerNavLabels(options: {
  canSeeTheWork: boolean;
}): string[] {
  return ownerNavItems(options).map((item) => item.label);
}
