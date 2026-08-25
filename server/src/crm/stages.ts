/**
 * LimitlessAI-2 pipeline stages, copied as the CRM's stage catalog.
 *
 * People move through an outreach funnel. Opportunities move through a five-column deal board.
 * `qualified` is a leftover mid-funnel label and is treated like Interested.
 */

export const CONTACT_STAGE_KEYS = [
  "new",
  "researched",
  "contacted",
  "replied",
  "interested",
  "booked",
  "qualified",
  "won",
  "lost",
  "nurture",
  "dnc",
] as const;

export type ContactStageKey = (typeof CONTACT_STAGE_KEYS)[number];

export type ContactStageDefinition = {
  key: ContactStageKey;
  label: string;
  position: number;
  playbook: string;
};

export const CONTACT_STAGE_DEFS: ContactStageDefinition[] = [
  {
    key: "new",
    label: "New",
    position: 0,
    playbook: "Research and first-touch when ready.",
  },
  {
    key: "researched",
    label: "Researched",
    position: 1,
    playbook: "Personalize and send first outreach.",
  },
  {
    key: "contacted",
    label: "Contacted",
    position: 2,
    playbook: "Sequence follow-up until they reply (or mark lost/DNC).",
  },
  {
    key: "replied",
    label: "Replied",
    position: 3,
    playbook:
      "Continue the conversation — qualify interest, answer questions. Do not restart cold sequence.",
  },
  {
    key: "interested",
    label: "Interested",
    position: 4,
    playbook:
      "Push toward a meeting: propose times, send calendar link, handle objections.",
  },
  {
    key: "booked",
    label: "Booked",
    position: 5,
    playbook: "Confirm / remind about the meeting. No more sales sequence.",
  },
  {
    key: "qualified",
    label: "Qualified",
    position: 6,
    playbook:
      "Legacy stage — treat like Interested; move to booked when a meeting is set.",
  },
  {
    key: "won",
    label: "Won",
    position: 7,
    playbook: "Closed — no outreach unless they ask.",
  },
  {
    key: "lost",
    label: "Lost",
    position: 8,
    playbook: "Not moving forward — do not email unless reopened to nurture.",
  },
  {
    key: "nurture",
    label: "Nurture",
    position: 9,
    playbook: "Longer-cadence value touches only — not aggressive sequence.",
  },
  {
    key: "dnc",
    label: "DNC",
    position: 10,
    playbook: "Do Not Contact — never email.",
  },
];

export const DEFAULT_CONTACT_STAGE: ContactStageKey = "new";

export const DEAL_STAGE_KEYS = [
  "qualify",
  "proposal",
  "negotiation",
  "won",
  "lost",
] as const;

export type DealStageKey = (typeof DEAL_STAGE_KEYS)[number];

export type DealStageDefinition = {
  key: DealStageKey;
  label: string;
  position: number;
};

export const DEAL_STAGE_DEFS: DealStageDefinition[] = [
  { key: "qualify", label: "Qualify", position: 0 },
  { key: "proposal", label: "Proposal", position: 1 },
  { key: "negotiation", label: "Negotiation", position: 2 },
  { key: "won", label: "Won", position: 3 },
  { key: "lost", label: "Lost", position: 4 },
];

export const DEFAULT_DEAL_STAGE: DealStageKey = "qualify";

export function isContactStageKey(key: string): key is ContactStageKey {
  return (CONTACT_STAGE_KEYS as readonly string[]).includes(key);
}

export function isDealStageKey(key: string): key is DealStageKey {
  return (DEAL_STAGE_KEYS as readonly string[]).includes(key);
}

export function normalizeContactStage(
  value: string | null | undefined,
): ContactStageKey {
  const trimmed = value?.trim().toLowerCase() ?? "";
  return isContactStageKey(trimmed) ? trimmed : DEFAULT_CONTACT_STAGE;
}

/**
 * The first CRM used `new` for a deal. LimitlessAI-2's board starts at Qualify.
 */
export function normalizeDealStage(value: string | null | undefined): string {
  const trimmed = value?.trim().toLowerCase() ?? "";
  if (!trimmed || trimmed === "new") return DEFAULT_DEAL_STAGE;
  return trimmed;
}

export function contactStageLabel(key: string): string {
  return CONTACT_STAGE_DEFS.find((stage) => stage.key === key)?.label ?? key;
}

export function dealStageLabel(key: string): string {
  const normalized = normalizeDealStage(key);
  return (
    DEAL_STAGE_DEFS.find((stage) => stage.key === normalized)?.label ?? key
  );
}
