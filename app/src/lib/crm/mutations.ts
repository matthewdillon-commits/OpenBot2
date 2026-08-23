import { mutationOptions, type QueryClient } from "@tanstack/react-query";
import { client } from "@/lib/client";
import {
  type CrmCampaign,
  type CrmCampaignList,
  type CrmCompany,
  type CrmConversation,
  type CrmOpportunity,
  type CrmPerson,
  type CrmSend,
  crmKeys,
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
  linkedinUrl?: string | null;
  location?: string | null;
  timezone?: string | null;
  source?: string | null;
};

export type CrmCompanyInput = {
  name: string;
  domain?: string | null;
  website?: string | null;
  industry?: string | null;
  phone?: string | null;
  location?: string | null;
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

export function createCrmCampaignListMutationOptions(queryClient: QueryClient) {
  return mutationOptions({
    mutationFn: (variables: {
      campaignId: string;
      name: string;
      description?: string | null;
    }): Promise<CrmCampaignList> =>
      client(`/api/crm/campaigns/${variables.campaignId}/lists`, "list", {
        method: "POST",
        body: {
          name: variables.name,
          description: variables.description,
        },
        fallback: FALLBACK,
      }),
    onSuccess: () => invalidateCrm(queryClient),
  });
}

export function addCrmListMembersMutationOptions(queryClient: QueryClient) {
  return mutationOptions({
    mutationFn: (variables: {
      listId: string;
      personIds: string[];
    }): Promise<{ added: number }> =>
      client(`/api/crm/lists/${variables.listId}/members`, {
        method: "POST",
        body: { personIds: variables.personIds },
        fallback: FALLBACK,
      }).then(async (response) => {
        const body = (await response.json()) as { added: number };
        return body;
      }),
    onSuccess: () => invalidateCrm(queryClient),
  });
}

export function removeCrmListMembersMutationOptions(queryClient: QueryClient) {
  return mutationOptions({
    mutationFn: (variables: {
      listId: string;
      personIds: string[];
    }): Promise<{ removed: number }> =>
      client(`/api/crm/lists/${variables.listId}/members`, {
        method: "DELETE",
        body: { personIds: variables.personIds },
        fallback: FALLBACK,
      }).then(async (response) => {
        const body = (await response.json()) as { removed: number };
        return body;
      }),
    onSuccess: () => invalidateCrm(queryClient),
  });
}

/** Look up a company by exact name, or write one, so New contact can take a name. */
export async function findOrCreateCrmCompany(
  name: string,
): Promise<CrmCompany> {
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
