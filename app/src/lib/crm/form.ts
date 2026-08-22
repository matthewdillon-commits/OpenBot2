import { z } from "zod";
import type {
  CrmCampaign,
  CrmCompany,
  CrmConversation,
  CrmOpportunity,
  CrmPerson,
} from "./queries";

function csv(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

export const personFormSchema = z.object({
  name: z.string().trim().min(1, "A name is required."),
  emails: z.string(),
  phones: z.string(),
  jobTitle: z.string(),
  companyId: z.string(),
  notes: z.string(),
});

export type PersonFormValues = z.infer<typeof personFormSchema>;

export const emptyPersonForm: PersonFormValues = {
  name: "",
  emails: "",
  phones: "",
  jobTitle: "",
  companyId: "",
  notes: "",
};

export function personFormFrom(person: CrmPerson): PersonFormValues {
  return {
    name: person.name,
    emails: person.emails.join(", "),
    phones: person.phones.join(", "),
    jobTitle: person.jobTitle ?? "",
    companyId: person.companyId ?? "",
    notes: person.notes ?? "",
  };
}

export function personInputFrom(values: PersonFormValues) {
  return {
    name: values.name,
    emails: csv(values.emails),
    phones: csv(values.phones),
    jobTitle: values.jobTitle || null,
    companyId: values.companyId || null,
    notes: values.notes || null,
  };
}

export const companyFormSchema = z.object({
  name: z.string().trim().min(1, "A name is required."),
  domain: z.string(),
  website: z.string(),
  industry: z.string(),
  phone: z.string(),
  notes: z.string(),
});

export type CompanyFormValues = z.infer<typeof companyFormSchema>;

export const emptyCompanyForm: CompanyFormValues = {
  name: "",
  domain: "",
  website: "",
  industry: "",
  phone: "",
  notes: "",
};

export function companyFormFrom(company: CrmCompany): CompanyFormValues {
  return {
    name: company.name,
    domain: company.domain ?? "",
    website: company.website ?? "",
    industry: company.industry ?? "",
    phone: company.phone ?? "",
    notes: company.notes ?? "",
  };
}

export function companyInputFrom(values: CompanyFormValues) {
  return {
    name: values.name,
    domain: values.domain || null,
    website: values.website || null,
    industry: values.industry || null,
    phone: values.phone || null,
    notes: values.notes || null,
  };
}

export const opportunityFormSchema = z.object({
  name: z.string().trim().min(1, "A name is required."),
  stage: z.string(),
  amount: z.string(),
  currency: z.string(),
  companyId: z.string(),
  personId: z.string(),
  expectedCloseAt: z.string(),
  notes: z.string(),
});

export type OpportunityFormValues = z.infer<typeof opportunityFormSchema>;

export const emptyOpportunityForm: OpportunityFormValues = {
  name: "",
  stage: "new",
  amount: "",
  currency: "USD",
  companyId: "",
  personId: "",
  expectedCloseAt: "",
  notes: "",
};

export function opportunityFormFrom(
  opportunity: CrmOpportunity,
): OpportunityFormValues {
  return {
    name: opportunity.name,
    stage: opportunity.stage,
    amount:
      opportunity.amountCents === null
        ? ""
        : (opportunity.amountCents / 100).toString(),
    currency: opportunity.currency,
    companyId: opportunity.companyId ?? "",
    personId: opportunity.personId ?? "",
    expectedCloseAt: opportunity.expectedCloseAt
      ? opportunity.expectedCloseAt.slice(0, 10)
      : "",
    notes: opportunity.notes ?? "",
  };
}

export function opportunityInputFrom(values: OpportunityFormValues) {
  const amount = values.amount.trim();
  const parsed = amount === "" ? null : Number.parseFloat(amount);
  return {
    name: values.name,
    stage: values.stage || "new",
    amountCents:
      parsed === null || !Number.isFinite(parsed)
        ? null
        : Math.round(parsed * 100),
    currency: values.currency || "USD",
    companyId: values.companyId || null,
    personId: values.personId || null,
    expectedCloseAt: values.expectedCloseAt || null,
    notes: values.notes || null,
  };
}

export const campaignFormSchema = z.object({
  name: z.string().trim().min(1, "A name is required."),
  status: z.string(),
  description: z.string(),
  startedAt: z.string(),
  endedAt: z.string(),
  notes: z.string(),
});

export type CampaignFormValues = z.infer<typeof campaignFormSchema>;

export const emptyCampaignForm: CampaignFormValues = {
  name: "",
  status: "draft",
  description: "",
  startedAt: "",
  endedAt: "",
  notes: "",
};

export function campaignFormFrom(campaign: CrmCampaign): CampaignFormValues {
  return {
    name: campaign.name,
    status: campaign.status,
    description: campaign.description ?? "",
    startedAt: campaign.startedAt ? campaign.startedAt.slice(0, 10) : "",
    endedAt: campaign.endedAt ? campaign.endedAt.slice(0, 10) : "",
    notes: campaign.notes ?? "",
  };
}

export function campaignInputFrom(values: CampaignFormValues) {
  return {
    name: values.name,
    status: values.status || "draft",
    description: values.description || null,
    startedAt: values.startedAt || null,
    endedAt: values.endedAt || null,
    notes: values.notes || null,
  };
}

export const conversationFormSchema = z.object({
  subject: z.string().trim().min(1, "A subject is required."),
  channel: z.string(),
  body: z.string(),
  personId: z.string(),
  companyId: z.string(),
  occurredAt: z.string(),
});

export type ConversationFormValues = z.infer<typeof conversationFormSchema>;

export const emptyConversationForm: ConversationFormValues = {
  subject: "",
  channel: "note",
  body: "",
  personId: "",
  companyId: "",
  occurredAt: "",
};

export function conversationFormFrom(
  conversation: CrmConversation,
): ConversationFormValues {
  return {
    subject: conversation.subject,
    channel: conversation.channel,
    body: conversation.body ?? "",
    personId: conversation.personId ?? "",
    companyId: conversation.companyId ?? "",
    occurredAt: conversation.occurredAt
      ? conversation.occurredAt.slice(0, 16)
      : "",
  };
}

export function conversationInputFrom(values: ConversationFormValues) {
  return {
    subject: values.subject,
    channel: values.channel || "note",
    body: values.body || null,
    personId: values.personId || null,
    companyId: values.companyId || null,
    occurredAt: values.occurredAt || null,
  };
}
