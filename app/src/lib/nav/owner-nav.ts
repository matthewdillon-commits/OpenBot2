/**
 * Labels a typical owner may see in the app chrome. Family names and leftover
 * coworker names are not items. Agents is the operator roster, not home.
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

export type OwnerNavItem = {
  to: "/" | "/crm" | "/plugins" | "/skills" | "/agents";
  label: string;
};

/**
 * Footer destinations next to the goal list. Composer + goals are the customer
 * door; this list must never grow family names or leftover coworker names.
 */
export function ownerNavItems(options: {
  canSeeTheWork: boolean;
}): OwnerNavItem[] {
  const items: OwnerNavItem[] = [
    { to: "/crm", label: "CRM" },
    { to: "/plugins", label: "Plugins" },
    { to: "/skills", label: "Skills" },
  ];
  if (options.canSeeTheWork) {
    items.push({ to: "/agents", label: "Agents" });
  }
  return items;
}

export function visibleOwnerNavLabels(options: {
  canSeeTheWork: boolean;
}): string[] {
  return ownerNavItems(options).map((item) => item.label);
}
