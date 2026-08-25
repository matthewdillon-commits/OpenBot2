import { z } from "zod";
import type { AgentActor } from "../agents/profile-types";
import type { GrantedTool } from "../plugins/tools";
import {
  CRM_CREATE_TOOL,
  CRM_GET_TOOL,
  CRM_KINDS,
  CRM_SEARCH_TOOL,
  CRM_SEND_TOOL,
  CRM_UPDATE_TOOL,
  type CrmGateway,
  type CrmKind,
} from "./gateway";

const kindSchema = z
  .enum(CRM_KINDS)
  .describe(
    "Which CRM record: person, company, opportunity, campaign, conversation, or send.",
  );

const searchParameters = z.object({
  kind: kindSchema,
  query: z
    .string()
    .optional()
    .describe("Optional substring of the name, email, or other text fields."),
});

const getParameters = z.object({
  kind: kindSchema,
  id: z.string().describe("The record id."),
});

const createParameters = z.object({
  kind: kindSchema,
  name: z
    .string()
    .optional()
    .describe("Required for person, company, opportunity, and campaign."),
  subject: z.string().optional().describe("Required for a conversation."),
  emails: z.array(z.string()).optional(),
  phones: z.array(z.string()).optional(),
  job_title: z.string().optional(),
  linkedin_url: z.string().optional(),
  location: z.string().optional(),
  timezone: z.string().optional(),
  source: z.string().optional(),
  company_id: z.string().optional(),
  company_name: z
    .string()
    .optional()
    .describe(
      "Employer name when kind=person. Finds or creates that company and links it. Prefer this over putting the employer only in notes.",
    ),
  person_id: z.string().optional(),
  campaign_id: z.string().optional(),
  domain: z.string().optional(),
  website: z.string().optional(),
  industry: z.string().optional(),
  phone: z.string().optional(),
  notes: z.string().optional(),
  stage: z.string().optional(),
  stage_key: z.string().optional(),
  do_not_contact: z.boolean().optional(),
  amount_cents: z.number().optional(),
  currency: z.string().optional(),
  expected_close_at: z.string().optional(),
  status: z.string().optional(),
  description: z.string().optional(),
  started_at: z.string().optional(),
  ended_at: z.string().optional(),
  channel: z.string().optional(),
  body: z.string().optional(),
  occurred_at: z.string().optional(),
  to_address: z.string().optional(),
  send_kind: z.enum(["email", "sms", "call"]).optional(),
});

const updateParameters = createParameters.extend({
  id: z.string().describe("The record to update."),
});

const sendParameters = z.object({
  kind: z.enum(["email", "sms", "call"]),
  to_address: z.string().describe("Email address or phone number."),
  subject: z.string().optional(),
  body: z.string().optional(),
  person_id: z.string().optional(),
  company_id: z.string().optional(),
  campaign_id: z.string().optional(),
});

/**
 * The tools a Bot uses to read and write this organization's CRM.
 *
 * Offered to every Bot the way web search is: no per-Bot grant. The gateway still decides and
 * records every call. Policy can name `intent == "crm"` or a tool such as `crm_create`.
 */
export function crmTools(options: {
  crm: CrmGateway;
  botId: string;
  actor: AgentActor;
  publicOrigin?: string;
}): GrantedTool[] {
  const { crm, botId, actor, publicOrigin } = options;

  return [
    {
      name: CRM_SEARCH_TOOL,
      description:
        "Search this organization's CRM. Use kind=person, company, opportunity, campaign, conversation, or send. " +
        "Returns matching records with ids you can pass to crm_get or crm_update. " +
        "Search before creating a person so you update an existing row instead of duplicating it. " +
        "This is the customer record, not the signed-in directory.",
      parameters: searchParameters,
      execute: async (args: unknown) => {
        const parsed = searchParameters.safeParse(args);
        if (!parsed.success) {
          return "That search needs a kind: person, company, opportunity, campaign, conversation, or send.";
        }
        return crm.search({
          botId,
          actor,
          kind: parsed.data.kind,
          ...(parsed.data.query ? { query: parsed.data.query } : {}),
        });
      },
    },
    {
      name: CRM_GET_TOOL,
      description:
        "Read one CRM record by kind and id. Use after crm_search when you need the full fields.",
      parameters: getParameters,
      execute: async (args: unknown) => {
        const parsed = getParameters.safeParse(args);
        if (!parsed.success) {
          return "That lookup needs kind and id.";
        }
        return crm.get({
          botId,
          actor,
          kind: parsed.data.kind,
          id: parsed.data.id,
        });
      },
    },
    {
      name: CRM_CREATE_TOOL,
      description:
        "Create a CRM record. Search first (crm_search) so you do not duplicate a person or company that is already there. " +
        "kind=person needs name (emails, phones, job_title, location, notes, stage_key optional). " +
        "If a person with this email, or the same name at this company, already exists, that row is updated instead of duplicated. " +
        "If they have an employer, pass company_name (and website or domain if you have them) — the company is found or created and linked in this same call; do not only put the employer in notes. " +
        "source=web when this came from research. " +
        "kind=company needs name (domain, website, industry, phone optional). " +
        "kind=opportunity needs name (stage qualify|proposal|negotiation|won|lost, amount_cents, company_id, person_id optional). " +
        "kind=campaign needs name. kind=conversation needs subject. " +
        "kind=send needs to_address and send_kind=email|sms|call. " +
        "The row is recorded as created by this Bot. After a person is saved, tell the person watching what was saved: name, company, title, location — not only the name.",
      parameters: createParameters,
      execute: async (args: unknown) => {
        const parsed = createParameters.safeParse(args);
        if (!parsed.success) {
          return "That create needs a kind and the fields for it.";
        }
        return crm.create({
          botId,
          actor,
          kind: parsed.data.kind,
          fields: fieldsFrom(parsed.data.kind, parsed.data),
        });
      },
    },
    {
      name: CRM_UPDATE_TOOL,
      description:
        "Update a CRM record by kind and id. Pass only the fields that should change. " +
        "On a person, company_name finds or creates the employer and links it; company_id links an existing company. " +
        "Use stage_key to move a person, or stage to move an opportunity on the deal board.",
      parameters: updateParameters,
      execute: async (args: unknown) => {
        const parsed = updateParameters.safeParse(args);
        if (!parsed.success) {
          return "That update needs kind, id, and at least one field.";
        }
        return crm.update({
          botId,
          actor,
          kind: parsed.data.kind,
          id: parsed.data.id,
          fields: fieldsFrom(parsed.data.kind, parsed.data),
        });
      },
    },
    {
      name: CRM_SEND_TOOL,
      description:
        "Record an email, SMS, or call to a CRM contact. " +
        "When SMTP or Twilio is configured the message is delivered; otherwise it is logged. " +
        "Email opens and clicks are tracked. Use kind=email|sms|call and to_address.",
      parameters: sendParameters,
      execute: async (args: unknown) => {
        const parsed = sendParameters.safeParse(args);
        if (!parsed.success) {
          return "That send needs kind (email, sms, or call) and to_address.";
        }
        return crm.send({
          botId,
          actor,
          publicOrigin,
          fields: {
            kind: parsed.data.kind,
            toAddress: parsed.data.to_address,
            ...(parsed.data.subject ? { subject: parsed.data.subject } : {}),
            ...(parsed.data.body ? { body: parsed.data.body } : {}),
            ...(parsed.data.person_id
              ? { personId: parsed.data.person_id }
              : {}),
            ...(parsed.data.company_id
              ? { companyId: parsed.data.company_id }
              : {}),
            ...(parsed.data.campaign_id
              ? { campaignId: parsed.data.campaign_id }
              : {}),
          },
        });
      },
    },
  ];
}

function fieldsFrom(
  kind: CrmKind,
  data: z.infer<typeof createParameters>,
): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  if (data.name !== undefined) fields.name = data.name;
  if (data.subject !== undefined) fields.subject = data.subject;
  if (data.emails !== undefined) fields.emails = data.emails;
  if (data.phones !== undefined) fields.phones = data.phones;
  if (data.job_title !== undefined) fields.jobTitle = data.job_title;
  if (data.linkedin_url !== undefined) fields.linkedinUrl = data.linkedin_url;
  if (data.location !== undefined) fields.location = data.location;
  if (data.timezone !== undefined) fields.timezone = data.timezone;
  if (data.source !== undefined) fields.source = data.source;
  if (data.company_id !== undefined) fields.companyId = data.company_id;
  if (data.company_name !== undefined) fields.companyName = data.company_name;
  if (data.person_id !== undefined) fields.personId = data.person_id;
  if (data.campaign_id !== undefined) fields.campaignId = data.campaign_id;
  if (data.domain !== undefined) fields.domain = data.domain;
  if (data.website !== undefined) fields.website = data.website;
  if (data.industry !== undefined) fields.industry = data.industry;
  if (data.phone !== undefined) fields.phone = data.phone;
  if (data.notes !== undefined) fields.notes = data.notes;
  if (kind === "person") {
    if (data.stage_key !== undefined) fields.stageKey = data.stage_key;
    else if (data.stage !== undefined) fields.stageKey = data.stage;
  } else if (data.stage !== undefined) {
    fields.stage = data.stage;
  }
  if (data.do_not_contact !== undefined)
    fields.doNotContact = data.do_not_contact;
  if (data.amount_cents !== undefined) fields.amountCents = data.amount_cents;
  if (data.currency !== undefined) fields.currency = data.currency;
  if (data.expected_close_at !== undefined)
    fields.expectedCloseAt = data.expected_close_at;
  if (data.status !== undefined) fields.status = data.status;
  if (data.description !== undefined) fields.description = data.description;
  if (data.started_at !== undefined) fields.startedAt = data.started_at;
  if (data.ended_at !== undefined) fields.endedAt = data.ended_at;
  if (data.channel !== undefined) fields.channel = data.channel;
  if (data.body !== undefined) fields.body = data.body;
  if (data.occurred_at !== undefined) fields.occurredAt = data.occurred_at;
  if (data.to_address !== undefined) fields.toAddress = data.to_address;
  if (data.send_kind !== undefined) fields.kind = data.send_kind;
  if (kind === "conversation" && fields.subject === undefined && data.name) {
    fields.subject = data.name;
  }
  if (kind === "send" && fields.kind === undefined && data.send_kind) {
    fields.kind = data.send_kind;
  }
  return fields;
}
