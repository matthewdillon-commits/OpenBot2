/**
 * Specialist workers the orchestrator stands up for the three owner jobs.
 *
 * Not a nav family. The owner talks to LimitlessAI; these ids are who actually
 * runs campaign / research / always-on sales after start_specialist.
 */
import { createHash } from "node:crypto";
import { unscopedResourceId } from "../orgs/constants";

export const WORKER_KINDS = ["campaign", "research", "sales"] as const;
export type WorkerKind = (typeof WORKER_KINDS)[number];

/** Packaged built-in ids (unscoped). Org copies are `org_…__campaign-worker`. */
export const WORKER_UNSCOPED_IDS = {
  campaign: "campaign-worker",
  research: "research-worker",
  sales: "sales-worker",
} as const satisfies Record<WorkerKind, string>;

/** Owner-facing packaged names. Not nav items; the owner still talks to LimitlessAI. */
export const WORKER_OWNER_NAMES = [
  "Email campaign",
  "Marketing research",
  "Always-on sales",
] as const;

export const SALES_CRON_EVERY_SECONDS = 3600;

/** Same goal + sales worker → one cron row even if two replicas spawn at once. */
export function standingSalesTriggerId(
  orgId: string,
  channelId: string,
  coworkerId: string,
): string {
  const digest = createHash("sha256")
    .update(`${orgId}\0${channelId}\0${coworkerId}`)
    .digest("hex")
    .slice(0, 32);
  return `jtr_sales_${digest}`;
}

export const SALES_STANDING_PROMPT = [
  "Continue always-on sales on this goal. Do not wait for the owner to type.",
  "Each wake: look at this organization's CRM, research leads that need work, send outreach, update stages, and book meetings.",
  "Pull the owner only when something is actually blocked (Needs you) — missing send, do-not-contact, or an approval card.",
  "Report one sentence of last action on this same goal.",
].join(" ");

export function parseWorkerKind(value: unknown): WorkerKind | null {
  return typeof value === "string" &&
    (WORKER_KINDS as readonly string[]).includes(value)
    ? (value as WorkerKind)
    : null;
}

export function workerKindOfUnscopedId(unscopedId: string): WorkerKind | null {
  for (const kind of WORKER_KINDS) {
    if (WORKER_UNSCOPED_IDS[kind] === unscopedId) return kind;
  }
  return null;
}

export function findWorkerInOrg<T extends { id: string }>(
  agents: readonly T[],
  orgId: string,
  kind: WorkerKind,
): T | undefined {
  const unscoped = WORKER_UNSCOPED_IDS[kind];
  return agents.find(
    (agent) => unscopedResourceId(orgId, agent.id) === unscoped,
  );
}

/**
 * What the orchestrator is told so it spawns instead of doing the job in-tab
 * or asking the owner to pick a bot.
 */
export const ORCHESTRATOR_SPAWN_GUIDANCE = [
  "You are LimitlessAI, the one brain the owner addresses. You do not ask them to pick a worker.",
  "For these jobs you MUST call start_specialist with kind set, then tell the owner the worker is on it. You do not run the whole job yourself in this turn, and you do not wait for them to stay in composer:",
  "- kind=campaign: “Set up an email campaign…” — audience/list, copy, send, track, report back on this goal. Owner is not in composer for each email.",
  "- kind=research: “Do marketing research…” — a research worker actually researches (market, competitors, audience) and comes back with findings on this goal. Owner does not paste articles.",
  "- kind=sales: always-on sales / outreach / monitor inbox and leads. A sales worker keeps going via a standing wake (cron; mailbox/webhook if mapped). Owner is pulled in only when blocked (Needs you).",
  "Specialists join this goal's room, share the organization's CRM, continue after the tab closes, and report back here.",
].join("\n");

export const WORKER_PLAYBOOKS: Record<WorkerKind, string> = {
  campaign: [
    "You are the email-campaign worker on this goal. Run the campaign end to end. The owner is not in composer for each email.",
    "1. Audience: crm_search kind=person (and company) for the asked audience. Create people only when they are missing. Do not invent a private list.",
    "2. Record: crm_create kind=campaign with a clear name for this send.",
    "3. Copy: write subject and body for the offer. Keep it one campaign, not a chat.",
    "4. Send: crm_send kind=email to each person with campaign_id. If delivery is only logged because mail is not configured, say that honestly in your result — do not pretend a mailbox went out.",
    "5. Track: crm_search kind=send for this campaign. Report who was targeted, what was sent, and what is still blocked.",
    "Finish with one sentence the orchestrator can put on this goal as last action. Do not ask the owner to pick a bot.",
  ].join("\n"),
  research: [
    "You are the marketing-research worker on this goal. Actually research. The owner does not paste articles in.",
    "Use search_web for market, competitors, and audience. Use the computer when a live page is the only way to see the market. Use company knowledge when it is connected.",
    "Write findings on this goal: what the market is, who competes, who the audience is, and what to do next. Cite sources you actually retrieved.",
    "If people or companies belong in the org book, crm_create them (search first so you do not duplicate). This is the organization's CRM, not a private notebook.",
    "Finish with one sentence the orchestrator can put on this goal as last action. Do not ask the owner to pick a bot.",
  ].join("\n"),
  sales: [
    "You are the always-on sales worker on this goal. This is standing work, not a one-shot chat.",
    "Each run: crm_search people and opportunities. Research leads that are new or stalled. crm_send outreach. crm_update stage_key (new → researched → contacted → replied → interested → booked). Book meetings when they are ready.",
    "Do not wait for the owner to type again. Pull them only when something is actually blocked (Needs you): do-not-contact, missing send, or an approval card.",
    "If mail is only logged and not delivered, say so and keep the CRM honest. Share this organization's CRM — the same customer fact every agent can see.",
    "Finish with one sentence of last action on this goal.",
  ].join("\n"),
};
