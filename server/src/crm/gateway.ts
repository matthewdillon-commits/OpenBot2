import { and, eq } from "drizzle-orm";
import type { AgentActor } from "../agents/profile-types";
import { type AuditStore, recordAuditEvent } from "../audit";
import {
  type ActionPolicy,
  evaluateActionPolicy,
  type PolicyContext,
  type PolicyDecision,
} from "../computer/policy";
import type { Database } from "../db/client";
import { agents } from "../db/schema";
import { orgIdOf } from "../orgs/constants";
import { REFUSAL_MARKER } from "../plugins/tools";
import { deliverSend } from "./deliver";
import type {
  CrmCampaign,
  CrmCampaignInput,
  CrmCompany,
  CrmCompanyInput,
  CrmConversation,
  CrmConversationInput,
  CrmCreatedBy,
  CrmListQuery,
  CrmOpportunity,
  CrmOpportunityInput,
  CrmPerson,
  CrmPersonInput,
  CrmSend,
  CrmSendInput,
  CrmStore,
} from "./store";

export const CRM_SEARCH_TOOL = "crm_search";
export const CRM_GET_TOOL = "crm_get";
export const CRM_CREATE_TOOL = "crm_create";
export const CRM_UPDATE_TOOL = "crm_update";
export const CRM_SEND_TOOL = "crm_send";

export const CRM_KINDS = [
  "person",
  "company",
  "opportunity",
  "campaign",
  "conversation",
  "send",
] as const;

export type CrmKind = (typeof CRM_KINDS)[number];

export type CrmGateway = {
  search(input: {
    botId: string;
    actor: AgentActor;
    kind: CrmKind;
    query?: string;
  }): Promise<string>;
  get(input: {
    botId: string;
    actor: AgentActor;
    kind: CrmKind;
    id: string;
  }): Promise<string>;
  create(input: {
    botId: string;
    actor: AgentActor;
    kind: CrmKind;
    fields: Record<string, unknown>;
  }): Promise<string>;
  update(input: {
    botId: string;
    actor: AgentActor;
    kind: CrmKind;
    id: string;
    fields: Record<string, unknown>;
  }): Promise<string>;
  send(input: {
    botId: string;
    actor: AgentActor;
    fields: Record<string, unknown>;
    publicOrigin?: string;
  }): Promise<string>;
};

/**
 * CRM writes and reads a Bot makes, judged the same way every other governed action is.
 *
 * Resolve the kind and the fields, decide against the live policy (`intent == "crm"` or the
 * tool name), write the trail, and only then touch a row. A deny leaves the table alone.
 */
export function createCrmGateway(options: {
  store: CrmStore;
  database: Database;
  auditStore: AuditStore;
  policy: (orgId: string) => ActionPolicy | undefined;
}): CrmGateway {
  const { store, database, auditStore, policy } = options;

  const decide = async (input: {
    botId: string;
    actor: AgentActor;
    tool: string;
    kind: CrmKind;
    action: "read" | "write";
    targetId?: string;
  }): Promise<
    | { ok: false; refused: string }
    | { ok: true; verdict: PolicyDecision; createdBy: CrmCreatedBy; orgId: string }
  > => {
    const orgId = orgIdOf(input.actor);
    const verdict = evaluateActionPolicy(
      policy(orgId),
      policyContext({
        tool: input.tool,
        botId: input.botId,
        actorId: input.actor.id,
      }),
    );

    await writeAudit(auditStore, {
      actor: input.actor,
      botId: input.botId,
      tool: input.tool,
      kind: input.kind,
      action: input.action,
      targetId: input.targetId,
      verdict,
      orgId,
    });

    if (!verdict.forward) {
      return { ok: false, refused: `${REFUSAL_MARKER} ${verdict.reason}` };
    }

    return {
      ok: true,
      verdict,
      orgId,
      createdBy: await createdByFromBot(database, input.botId, orgId),
    };
  };

  return {
    async search(input) {
      const decision = await decide({
        botId: input.botId,
        actor: input.actor,
        tool: CRM_SEARCH_TOOL,
        kind: input.kind,
        action: "read",
      });
      if (!decision.ok) return decision.refused;

      const query: CrmListQuery = {
        orgId: decision.orgId,
        ...(input.query?.trim() ? { search: input.query.trim() } : {}),
        limit: 20,
      };
      const page = await listOf(store, input.kind, query);
      if (page.items.length === 0) {
        return input.query?.trim()
          ? `No ${input.kind} records matched that.`
          : `No ${input.kind} records yet.`;
      }
      return page.items.map((item) => summarise(input.kind, item)).join("\n\n");
    },

    async get(input) {
      const id = input.id.trim();
      if (!id) return "That lookup needs an id.";
      const decision = await decide({
        botId: input.botId,
        actor: input.actor,
        tool: CRM_GET_TOOL,
        kind: input.kind,
        action: "read",
        targetId: id,
      });
      if (!decision.ok) return decision.refused;

      const record = await getOf(store, decision.orgId, input.kind, id);
      if (!record) return `No ${input.kind} with that id.`;
      return JSON.stringify(record);
    },

    async create(input) {
      const decision = await decide({
        botId: input.botId,
        actor: input.actor,
        tool: CRM_CREATE_TOOL,
        kind: input.kind,
        action: "write",
      });
      if (!decision.ok) return decision.refused;

      try {
        const fields = await withLinkedCompany(
          store,
          decision.orgId,
          input.kind,
          input.fields,
          decision.createdBy,
        );
        if (input.kind === "person") {
          const existing = await existingPerson(store, decision.orgId, fields);
          if (existing) {
            const updated = await updateOf(
              store,
              decision.orgId,
              "person",
              existing.id,
              fields,
            );
            if (!updated) return "No person with that id.";
            return describeWrite("Updated", "person", updated);
          }
        }
        const created = await createOf(
          store,
          decision.orgId,
          input.kind,
          fields,
          decision.createdBy,
        );
        return describeWrite("Created", input.kind, created);
      } catch (error) {
        return error instanceof Error
          ? error.message
          : `That ${input.kind} could not be created.`;
      }
    },

    async update(input) {
      const id = input.id.trim();
      if (!id) return "That update needs an id.";
      const decision = await decide({
        botId: input.botId,
        actor: input.actor,
        tool: CRM_UPDATE_TOOL,
        kind: input.kind,
        action: "write",
        targetId: id,
      });
      if (!decision.ok) return decision.refused;

      try {
        const fields = await withLinkedCompany(
          store,
          decision.orgId,
          input.kind,
          input.fields,
          decision.createdBy,
        );
        const updated = await updateOf(
          store,
          decision.orgId,
          input.kind,
          id,
          fields,
        );
        if (!updated) return `No ${input.kind} with that id.`;
        return describeWrite("Updated", input.kind, updated);
      } catch (error) {
        return error instanceof Error
          ? error.message
          : `That ${input.kind} could not be updated.`;
      }
    },

    async send(input) {
      const decision = await decide({
        botId: input.botId,
        actor: input.actor,
        tool: CRM_SEND_TOOL,
        kind: "send",
        action: "write",
      });
      if (!decision.ok) return decision.refused;

      try {
        const created = await store.createSend(
          decision.orgId,
          input.fields as CrmSendInput,
          decision.createdBy,
        );
        const sent = await deliverSend({
          store,
          orgId: decision.orgId,
          send: created,
          publicOrigin: input.publicOrigin,
        });
        return `Recorded ${sent.kind} to ${sent.toAddress} (${sent.id}). Status: ${sent.status}.`;
      } catch (error) {
        return error instanceof Error
          ? error.message
          : "That send could not be recorded.";
      }
    },
  };
}

async function createdByFromBot(
  database: Database,
  botId: string,
  orgId: string,
): Promise<CrmCreatedBy> {
  const [row] = await database
    .select({ name: agents.name })
    .from(agents)
    .where(and(eq(agents.id, botId), eq(agents.orgId, orgId)))
    .limit(1);
  return {
    kind: "bot",
    id: botId,
    name: row?.name?.trim() || botId,
  };
}

function policyContext(input: {
  tool: string;
  botId: string;
  actorId: string;
}): PolicyContext {
  return {
    tool: { name: input.tool },
    bot: { id: input.botId },
    actor: { id: input.actorId },
    page: { url: "", host: "" },
    element: { ref: "", role: "", name: "", type: "" },
    key: "",
    file: { path: "", name: "", extension: "" },
    command: "",
    intent: "crm",
  };
}

async function writeAudit(
  auditStore: AuditStore,
  entry: {
    actor: AgentActor;
    botId: string;
    tool: string;
    kind: CrmKind;
    action: "read" | "write";
    targetId?: string;
    verdict: PolicyDecision;
    orgId: string;
  },
) {
  await recordAuditEvent(auditStore, {
    eventType: entry.verdict.forward
      ? entry.action === "write"
        ? "crm.record_written"
        : "crm.record_read"
      : "crm.record_refused",
    targetType: "crm",
    targetId: entry.targetId ?? entry.botId,
    actorUserId: entry.actor.id,
    orgId: entry.orgId,
    payload: {
      bot: entry.botId,
      actor: entry.actor.id,
      tool: entry.tool,
      kind: entry.kind,
      action: entry.action,
      decision: {
        allowed: entry.verdict.allowed,
        mode: entry.verdict.mode,
        source: entry.verdict.source,
        rule: entry.verdict.matched,
        carriedOut: entry.verdict.forward,
      },
    },
  });
}

type AnyRecord =
  | CrmPerson
  | CrmCompany
  | CrmOpportunity
  | CrmCampaign
  | CrmConversation
  | CrmSend;

async function listOf(
  store: CrmStore,
  kind: CrmKind,
  query: CrmListQuery,
): Promise<{ items: AnyRecord[] }> {
  switch (kind) {
    case "person":
      return store.listPeople(query);
    case "company":
      return store.listCompanies(query);
    case "opportunity":
      return store.listOpportunities(query);
    case "campaign":
      return store.listCampaigns(query);
    case "conversation":
      return store.listConversations(query);
    case "send":
      return store.listSends(query);
  }
}

async function getOf(
  store: CrmStore,
  orgId: string,
  kind: CrmKind,
  id: string,
): Promise<AnyRecord | undefined> {
  switch (kind) {
    case "person":
      return store.getPerson(orgId, id);
    case "company":
      return store.getCompany(orgId, id);
    case "opportunity":
      return store.getOpportunity(orgId, id);
    case "campaign":
      return store.getCampaign(orgId, id);
    case "conversation":
      return store.getConversation(orgId, id);
    case "send":
      return store.getSend(orgId, id);
  }
}

/**
 * A person create/update may name the employer instead of an id.
 *
 * The model otherwise stuffs "Works at Acme" into notes and never writes a company row, so the
 * People list shows a dash. Find or create here, in the same permitted write, so linking does not
 * depend on a second tool call.
 */
async function withLinkedCompany(
  store: CrmStore,
  orgId: string,
  kind: CrmKind,
  fields: Record<string, unknown>,
  createdBy: CrmCreatedBy,
): Promise<Record<string, unknown>> {
  if (kind !== "person") return fields;

  const next = { ...fields };
  const companyName =
    typeof next.companyName === "string" ? next.companyName.trim() : "";
  delete next.companyName;
  const companyId =
    typeof next.companyId === "string" ? next.companyId.trim() : "";
  if (companyId || !companyName) return next;

  const website = typeof next.website === "string" ? next.website.trim() : "";
  const domain = typeof next.domain === "string" ? next.domain.trim() : "";
  delete next.website;
  delete next.domain;

  const page = await store.listCompanies({
    orgId,
    search: companyName,
    limit: 50,
  });
  const match = page.items.find(
    (company) => company.name.toLowerCase() === companyName.toLowerCase(),
  );
  if (match) {
    next.companyId = match.id;
    return next;
  }

  const created = await store.createCompany(
    orgId,
    {
      name: companyName,
      ...(domain ? { domain } : {}),
      ...(website ? { website } : {}),
    },
    createdBy,
  );
  next.companyId = created.id;
  return next;
}

/**
 * A person create may be the same human the Bot already wrote.
 *
 * Research turns call crm_create twice with slightly different titles; search-then-update is
 * what we ask the model to do, but the second create still arrives. Match on email, or on the
 * same name at the same company (or an unlinked row with that name), and update instead.
 */
async function existingPerson(
  store: CrmStore,
  orgId: string,
  fields: Record<string, unknown>,
): Promise<CrmPerson | undefined> {
  const name = typeof fields.name === "string" ? fields.name.trim() : "";
  const emails = Array.isArray(fields.emails)
    ? fields.emails
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean)
    : [];
  const companyId =
    typeof fields.companyId === "string" ? fields.companyId.trim() : "";

  const candidates: CrmPerson[] = [];
  const seen = new Set<string>();
  async function collect(search: string) {
    const trimmed = search.trim();
    if (!trimmed) return;
    const page = await store.listPeople({ orgId, search: trimmed, limit: 50 });
    for (const item of page.items) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      candidates.push(item);
    }
  }
  if (name) await collect(name);
  for (const email of emails) await collect(email);

  const byEmail = candidates.find((person) =>
    person.emails.some((email) => emails.includes(email.toLowerCase())),
  );
  if (byEmail) return byEmail;

  if (!name) return undefined;
  const named = candidates.filter(
    (person) => person.name.toLowerCase() === name.toLowerCase(),
  );
  if (named.length === 0) return undefined;

  if (companyId) {
    const sameCompany = named.filter((person) => person.companyId === companyId);
    if (sameCompany[0]) return sameCompany[0];
  }
  const unlinked = named.filter((person) => !person.companyId);
  if (unlinked[0]) return unlinked[0];
  if (!companyId && named.length === 1) return named[0];
  return undefined;
}

async function createOf(
  store: CrmStore,
  orgId: string,
  kind: CrmKind,
  fields: Record<string, unknown>,
  createdBy: CrmCreatedBy,
): Promise<AnyRecord> {
  switch (kind) {
    case "person":
      return store.createPerson(orgId, fields as CrmPersonInput, createdBy);
    case "company":
      return store.createCompany(orgId, fields as CrmCompanyInput, createdBy);
    case "opportunity":
      return store.createOpportunity(
        orgId,
        fields as CrmOpportunityInput,
        createdBy,
      );
    case "campaign":
      return store.createCampaign(orgId, fields as CrmCampaignInput, createdBy);
    case "conversation":
      return store.createConversation(
        orgId,
        fields as CrmConversationInput,
        createdBy,
      );
    case "send":
      return store.createSend(orgId, fields as CrmSendInput, createdBy);
  }
}

async function updateOf(
  store: CrmStore,
  orgId: string,
  kind: CrmKind,
  id: string,
  fields: Record<string, unknown>,
): Promise<AnyRecord | undefined> {
  switch (kind) {
    case "person":
      return store.updatePerson(orgId, id, fields as Partial<CrmPersonInput>);
    case "company":
      return store.updateCompany(orgId, id, fields as Partial<CrmCompanyInput>);
    case "opportunity":
      return store.updateOpportunity(
        orgId,
        id,
        fields as Partial<CrmOpportunityInput>,
      );
    case "campaign":
      return store.updateCampaign(
        orgId,
        id,
        fields as Partial<CrmCampaignInput>,
      );
    case "conversation":
      return store.updateConversation(
        orgId,
        id,
        fields as Partial<CrmConversationInput>,
      );
    case "send":
      return undefined;
  }
}

function labelOf(kind: CrmKind, record: AnyRecord): string {
  if (kind === "conversation") return (record as CrmConversation).subject;
  if (kind === "send") return (record as CrmSend).toAddress;
  return (record as { name: string }).name;
}

/**
 * What the Bot should tell the person watching after a write.
 *
 * A one-field "Created person uuid: Name." led models to echo only the name. Spell out title,
 * company, location, and email, and say to confirm it in a sentence.
 */
function describeWrite(
  verb: "Created" | "Updated",
  kind: CrmKind,
  record: AnyRecord,
): string {
  const head = `${verb} ${kind} ${record.id}: ${labelOf(kind, record)}.`;
  if (kind !== "person") return head;
  const person = record as CrmPerson;
  const facts: string[] = [];
  if (person.jobTitle) facts.push(person.jobTitle);
  if (person.company?.name) facts.push(`at ${person.company.name}`);
  if (person.location) facts.push(`in ${person.location}`);
  if (person.emails[0]) facts.push(`email ${person.emails[0]}`);
  const factLine = facts.length > 0 ? ` ${facts.join(", ")}.` : "";
  return (
    `${head}${factLine} Confirm this save to the person in a sentence: name them, ` +
    `the company if there is one, and that they are in the CRM. Do not reply with only the name.`
  );
}

function summarise(kind: CrmKind, record: AnyRecord): string {
  if (kind === "person") {
    const person = record as CrmPerson;
    const emails =
      person.emails.length > 0 ? person.emails.join(", ") : "no email";
    const company = person.company?.name ?? "no company";
    return `${person.name} (${person.id})\n${emails}\n${company}\n${person.stageKey}${person.doNotContact ? " · DNC" : ""}\ncreated by ${person.createdBy.name}`;
  }
  if (kind === "company") {
    const company = record as CrmCompany;
    return `${company.name} (${company.id})\n${company.domain ?? "no domain"}\ncreated by ${company.createdBy.name}`;
  }
  if (kind === "opportunity") {
    const opportunity = record as CrmOpportunity;
    return `${opportunity.name} (${opportunity.id})\n${opportunity.stage}\n${opportunity.company?.name ?? "no company"}`;
  }
  if (kind === "campaign") {
    const campaign = record as CrmCampaign;
    return `${campaign.name} (${campaign.id})\n${campaign.status}`;
  }
  if (kind === "send") {
    const send = record as CrmSend;
    return `${send.kind} to ${send.toAddress} (${send.id})\n${send.status}\nopens ${send.tracking.uniqueOpens} clicks ${send.tracking.uniqueClicks}`;
  }
  const conversation = record as CrmConversation;
  return `${conversation.subject} (${conversation.id})\n${conversation.channel}\n${conversation.person?.name ?? "no person"}`;
}
