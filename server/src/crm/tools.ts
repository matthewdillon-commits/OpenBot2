import { z } from "zod";
import type { AgentActor } from "../agents/profile-types";
import type { GrantedTool } from "../plugins/tools";
import {
  CRM_CREATE_TOOL,
  CRM_GET_TOOL,
  CRM_KINDS,
  CRM_SEARCH_TOOL,
  CRM_UPDATE_TOOL,
  type CrmGateway,
  type CrmKind,
} from "./gateway";

const kindSchema = z
  .enum(CRM_KINDS)
  .describe(
    "Which CRM record: person, company, opportunity, campaign, or conversation.",
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
  company_id: z.string().optional(),
  person_id: z.string().optional(),
  domain: z.string().optional(),
  website: z.string().optional(),
  industry: z.string().optional(),
  phone: z.string().optional(),
  notes: z.string().optional(),
  stage: z.string().optional(),
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
});

const updateParameters = createParameters.extend({
  id: z.string().describe("The record to update."),
});

/**
 * The four tools a Bot uses to read and write this deployment's CRM.
 *
 * Offered to every Bot the way web search is: no per-Bot grant. The gateway still decides and
 * records every call. Policy can name `intent == "crm"` or a tool such as `crm_create`.
 */
export function crmTools(options: {
  crm: CrmGateway;
  botId: string;
  actor: AgentActor;
}): GrantedTool[] {
  const { crm, botId, actor } = options;

  return [
    {
      name: CRM_SEARCH_TOOL,
      description:
        "Search this deployment's CRM. Use kind=person, company, opportunity, campaign, or conversation. " +
        "Returns matching records with ids you can pass to crm_get or crm_update. " +
        "This is the customer record, not the signed-in directory.",
      parameters: searchParameters,
      execute: async (args: unknown) => {
        const parsed = searchParameters.safeParse(args);
        if (!parsed.success) {
          return "That search needs a kind: person, company, opportunity, campaign, or conversation.";
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
        "Create a CRM record. kind=person needs name (emails, phones, job_title, company_id optional). " +
        "kind=company needs name (domain, website, industry, phone optional). " +
        "kind=opportunity needs name (stage, amount_cents, company_id, person_id optional). " +
        "kind=campaign needs name. kind=conversation needs subject. " +
        "The row is recorded as created by this Bot.",
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
        "Use company_id on a person to link them to a company.",
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
  if (data.company_id !== undefined) fields.companyId = data.company_id;
  if (data.person_id !== undefined) fields.personId = data.person_id;
  if (data.domain !== undefined) fields.domain = data.domain;
  if (data.website !== undefined) fields.website = data.website;
  if (data.industry !== undefined) fields.industry = data.industry;
  if (data.phone !== undefined) fields.phone = data.phone;
  if (data.notes !== undefined) fields.notes = data.notes;
  if (data.stage !== undefined) fields.stage = data.stage;
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
  if (kind === "conversation" && fields.subject === undefined && data.name) {
    fields.subject = data.name;
  }
  return fields;
}
