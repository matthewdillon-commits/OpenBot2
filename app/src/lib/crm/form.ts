import { z } from "zod";

export const personFormSchema = z.object({
  name: z.string().trim().min(1, "A name is required."),
  emails: z.string(),
  phones: z.string(),
  jobTitle: z.string(),
  companyId: z.string(),
  stageKey: z.string(),
  notes: z.string(),
});

export const companyFormSchema = z.object({
  name: z.string().trim().min(1, "A name is required."),
  domain: z.string(),
  website: z.string(),
  industry: z.string(),
  phone: z.string(),
  notes: z.string(),
});

export const opportunityFormSchema = z.object({
  name: z.string().trim().min(1, "A name is required."),
  stage: z.string(),
  amount: z.string(),
  personId: z.string(),
  companyId: z.string(),
  notes: z.string(),
});

export const campaignFormSchema = z.object({
  name: z.string().trim().min(1, "A name is required."),
  status: z.string(),
  description: z.string(),
  notes: z.string(),
});

export const conversationFormSchema = z.object({
  subject: z.string().trim().min(1, "A subject is required."),
  channel: z.string(),
  body: z.string(),
  personId: z.string(),
  companyId: z.string(),
});

export const sendFormSchema = z.object({
  kind: z.enum(["email", "sms", "call"]),
  toAddress: z.string().trim().min(1, "An address or number is required."),
  subject: z.string(),
  body: z.string(),
  personId: z.string(),
  campaignId: z.string(),
});

export type PersonFormValues = z.infer<typeof personFormSchema>;
export type CompanyFormValues = z.infer<typeof companyFormSchema>;
export type OpportunityFormValues = z.infer<typeof opportunityFormSchema>;
export type CampaignFormValues = z.infer<typeof campaignFormSchema>;
export type ConversationFormValues = z.infer<typeof conversationFormSchema>;
export type SendFormValues = z.infer<typeof sendFormSchema>;

export function splitList(value: string): string[] {
  return value
    .split(/[,;\n]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}
