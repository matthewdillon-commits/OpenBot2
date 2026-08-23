import { mutationOptions, type QueryClient } from "@tanstack/react-query";
import { client } from "@/lib/client";
import {
  type CrmCampaign,
  type CrmCompany,
  type CrmConversation,
  crmKeys,
  type CrmOpportunity,
  type CrmPerson,
  type CrmSend,
} from "./queries";

const FALLBACK = "CRM write failed";

function invalidateCrm(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: crmKeys.all });
}

export type CrmPersonInput = {
  name: string;
  emails?: string[];
  phones?: string[];
  jobTitle?: string | null;
  companyId?: string | null;
  stageKey?: string | null;
  doNotContact?: boolean;
  notes?: string | null;
};

export type CrmCompanyInput = {
  name: string;
  domain?: string | null;
  website?: string | null;
  industry?: string | null;
  phone?: string | null;
  notes?: string | null;
};

export type CrmOpportunityInput = {
  name: string;
  stage?: string;
  amountCents?: number | null;
  currency?: string;
  companyId?: string | null;
  personId?: string | null;
  expectedCloseAt?: string | null;
  notes?: string | null;
};

export type CrmCampaignInput = {
  name: string;
  status?: string;
  description?: string | null;
  notes?: string | null;
};

export type CrmConversationInput = {
  subject: string;
  channel?: string;
  body?: string | null;
  personId?: string | null;
  companyId?: string | null;
};

export type CrmSendInput = {
  kind: "email" | "sms" | "call";
  toAddress: string;
  subject?: string | null;
  body?: string | null;
  personId?: string | null;
  companyId?: string | null;
  campaignId?: string | null;
};

export function updateCrmPersonMutationOptions(queryClient: QueryClient) {
  return mutationOptions({
    mutationFn: (variables: {
      id: string;
      input: Partial<CrmPersonInput>;
    }): Promise<CrmPerson> =>
      client(`/api/crm/people/${variables.id}`, "person", {
        method: "PATCH",
        body: variables.input,
        fallback: FALLBACK,
      }),
    onSuccess: () => invalidateCrm(queryClient),
  });
}

export function updateCrmOpportunityMutationOptions(queryClient: QueryClient) {
  return mutationOptions({
    mutationFn: (variables: {
      id: string;
      input: Partial<CrmOpportunityInput>;
    }): Promise<CrmOpportunity> =>
      client(`/api/crm/opportunities/${variables.id}`, "opportunity", {
        method: "PATCH",
        body: variables.input,
        fallback: FALLBACK,
      }),
    onSuccess: () => invalidateCrm(queryClient),
  });
}

export function createCrmPersonMutationOptions(queryClient: QueryClient) {
  return mutationOptions({
    mutationFn: (input: CrmPersonInput): Promise<CrmPerson> =>
      client("/api/crm/people", "person", {
        method: "POST",
        body: input,
        fallback: FALLBACK,
      }),
    onSuccess: () => invalidateCrm(queryClient),
  });
}

export function createCrmCompanyMutationOptions(queryClient: QueryClient) {
  return mutationOptions({
    mutationFn: (input: CrmCompanyInput): Promise<CrmCompany> =>
      client("/api/crm/companies", "company", {
        method: "POST",
        body: input,
        fallback: FALLBACK,
      }),
    onSuccess: () => invalidateCrm(queryClient),
  });
}

export function createCrmOpportunityMutationOptions(queryClient: QueryClient) {
  return mutationOptions({
    mutationFn: (input: CrmOpportunityInput): Promise<CrmOpportunity> =>
      client("/api/crm/opportunities", "opportunity", {
        method: "POST",
        body: input,
        fallback: FALLBACK,
      }),
    onSuccess: () => invalidateCrm(queryClient),
  });
}

export function createCrmCampaignMutationOptions(queryClient: QueryClient) {
  return mutationOptions({
    mutationFn: (input: CrmCampaignInput): Promise<CrmCampaign> =>
      client("/api/crm/campaigns", "campaign", {
        method: "POST",
        body: input,
        fallback: FALLBACK,
      }),
    onSuccess: () => invalidateCrm(queryClient),
  });
}

export function createCrmConversationMutationOptions(queryClient: QueryClient) {
  return mutationOptions({
    mutationFn: (input: CrmConversationInput): Promise<CrmConversation> =>
      client("/api/crm/conversations", "conversation", {
        method: "POST",
        body: input,
        fallback: FALLBACK,
      }),
    onSuccess: () => invalidateCrm(queryClient),
  });
}

export function createCrmSendMutationOptions(queryClient: QueryClient) {
  return mutationOptions({
    mutationFn: (input: CrmSendInput): Promise<CrmSend> =>
      client("/api/crm/sends", "send", {
        method: "POST",
        body: input,
        fallback: FALLBACK,
      }),
    onSuccess: () => invalidateCrm(queryClient),
  });
}

export function updateCrmCampaignMutationOptions(queryClient: QueryClient) {
  return mutationOptions({
    mutationFn: (variables: {
      id: string;
      input: Partial<CrmCampaignInput>;
    }): Promise<CrmCampaign> =>
      client(`/api/crm/campaigns/${variables.id}`, "campaign", {
        method: "PATCH",
        body: variables.input,
        fallback: FALLBACK,
      }),
    onSuccess: () => invalidateCrm(queryClient),
  });
}

/** Look up a company by exact name, or write one, so New contact can take a name. */
export async function findOrCreateCrmCompany(name: string): Promise<CrmCompany> {
  const trimmed = name.trim();
  const body = (await (
    await client(
      `/api/crm/companies?search=${encodeURIComponent(trimmed)}&limit=50`,
      { fallback: FALLBACK },
    )
  ).json()) as { companies: CrmCompany[] };
  const match = (body.companies || []).find(
    (company) => company.name.toLowerCase() === trimmed.toLowerCase(),
  );
  if (match) return match;
  return client("/api/crm/companies", "company", {
    method: "POST",
    body: { name: trimmed },
    fallback: FALLBACK,
  });
}
