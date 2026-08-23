/**
 * LimitlessAI-2 pipeline stages. The browser keeps its own copy because it must
 * not import the server package.
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
      "Continue the conversation — qualify interest, answer questions.",
  },
  {
    key: "interested",
    label: "Interested",
    position: 4,
    playbook: "Push toward a meeting.",
  },
  {
    key: "booked",
    label: "Booked",
    position: 5,
    playbook: "Confirm the meeting. No more sales sequence.",
  },
  {
    key: "qualified",
    label: "Qualified",
    position: 6,
    playbook: "Legacy stage — treat like Interested.",
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
    playbook: "Not moving forward.",
  },
  {
    key: "nurture",
    label: "Nurture",
    position: 9,
    playbook: "Longer-cadence value touches only.",
  },
  {
    key: "dnc",
    label: "DNC",
    position: 10,
    playbook: "Do Not Contact — never email.",
  },
];

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
};

export const DEAL_STAGE_DEFS: DealStageDefinition[] = [
  { key: "qualify", label: "Qualify" },
  { key: "proposal", label: "Proposal" },
  { key: "negotiation", label: "Negotiation" },
  { key: "won", label: "Won" },
  { key: "lost", label: "Lost" },
];

export const DEFAULT_DEAL_STAGE: DealStageKey = "qualify";

export function isContactStageKey(key: string): key is ContactStageKey {
  return (CONTACT_STAGE_KEYS as readonly string[]).includes(key);
}

export function contactStageLabel(key: string): string {
  return CONTACT_STAGE_DEFS.find((stage) => stage.key === key)?.label ?? key;
}

export function dealStageLabel(key: string): string {
  const normalized = key === "new" || !key ? DEFAULT_DEAL_STAGE : key;
  return (
    DEAL_STAGE_DEFS.find((stage) => stage.key === normalized)?.label ?? key
  );
}

export function normalizeDealStage(key: string): DealStageKey | string {
  if (!key || key === "new") return DEFAULT_DEAL_STAGE;
  return key;
}
