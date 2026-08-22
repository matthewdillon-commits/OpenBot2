import { mutationOptions, type QueryClient } from "@tanstack/react-query";
import { client } from "@/lib/client";
import {
  type CrmCampaign,
  type CrmCompany,
  type CrmConversation,
  crmKeys,
  type CrmOpportunity,
  type CrmPerson,
} from "./queries";

const FALLBACK = "CRM operation failed";

function invalidateCrm(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: crmKeys.all });
}

export type CrmPersonInput = {
  name: string;
  emails?: string[];
  phones?: string[];
  jobTitle?: string | null;
  companyId?: string | null;
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
  startedAt?: string | null;
  endedAt?: string | null;
  notes?: string | null;
};

export type CrmConversationInput = {
  subject: string;
  channel?: string;
  body?: string | null;
  personId?: string | null;
  companyId?: string | null;
  occurredAt?: string | null;
};

export function createPersonMutationOptions(queryClient: QueryClient) {
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

export function updatePersonMutationOptions(queryClient: QueryClient) {
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

export function createCompanyMutationOptions(queryClient: QueryClient) {
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

export function updateCompanyMutationOptions(queryClient: QueryClient) {
  return mutationOptions({
    mutationFn: (variables: {
      id: string;
      input: Partial<CrmCompanyInput>;
    }): Promise<CrmCompany> =>
      client(`/api/crm/companies/${variables.id}`, "company", {
        method: "PATCH",
        body: variables.input,
        fallback: FALLBACK,
      }),
    onSuccess: () => invalidateCrm(queryClient),
  });
}

export function createOpportunityMutationOptions(queryClient: QueryClient) {
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

export function updateOpportunityMutationOptions(queryClient: QueryClient) {
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

export function createCampaignMutationOptions(queryClient: QueryClient) {
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

export function updateCampaignMutationOptions(queryClient: QueryClient) {
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

export function createConversationMutationOptions(queryClient: QueryClient) {
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

export function updateConversationMutationOptions(queryClient: QueryClient) {
  return mutationOptions({
    mutationFn: (variables: {
      id: string;
      input: Partial<CrmConversationInput>;
    }): Promise<CrmConversation> =>
      client(`/api/crm/conversations/${variables.id}`, "conversation", {
        method: "PATCH",
        body: variables.input,
        fallback: FALLBACK,
      }),
    onSuccess: () => invalidateCrm(queryClient),
  });
}
