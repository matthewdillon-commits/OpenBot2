export type CrmObjectMode =
  | "people"
  | "companies"
  | "opportunities"
  | "campaigns"
  | "conversations";

export const CRM_OBJECT_TABS: CrmObjectMode[] = [
  "people",
  "companies",
  "opportunities",
  "campaigns",
  "conversations",
];

const LABELS: Record<CrmObjectMode, string> = {
  people: "People",
  companies: "Companies",
  opportunities: "Opportunities",
  campaigns: "Campaigns",
  conversations: "Conversations",
};

export function crmModeLabel(mode: CrmObjectMode): string {
  return LABELS[mode] || "CRM";
}

export function migrateLegacyCrmMode(raw: string | null): CrmObjectMode | null {
  if (!raw) return null;
  if (raw === "list" || raw === "tasks" || raw === "notes" || raw === "plan") {
    return "people";
  }
  if (raw === "deals") return "opportunities";
  if (raw === "messages" || raw === "outreach" || raw === "sends") {
    return "conversations";
  }
  if (
    raw === "people" ||
    raw === "companies" ||
    raw === "opportunities" ||
    raw === "campaigns" ||
    raw === "conversations"
  ) {
    return raw;
  }
  return null;
}
