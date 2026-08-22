import { queryOptions } from "@tanstack/react-query";
import { client } from "@/lib/client";

/**
 * A CRM record as the browser sees it.
 *
 * Created-by is a server-written fact: the screen renders `createdBy.name` (or "System") rather
 * than recomputing who wrote the row from other fields.
 */
export type CrmCreatedBy = {
  kind: "user" | "bot" | "system";
  id: string;
  name: string;
};

export type CrmCompany = {
  id: string;
  name: string;
  domain: string | null;
  website: string | null;
  industry: string | null;
  phone: string | null;
  notes: string | null;
  createdBy: CrmCreatedBy;
  createdAt: string;
  updatedAt: string;
};

export type CrmPerson = {
  id: string;
  name: string;
  emails: string[];
  phones: string[];
  jobTitle: string | null;
  companyId: string | null;
  company: { id: string; name: string; domain: string | null } | null;
  notes: string | null;
  createdBy: CrmCreatedBy;
  createdAt: string;
  updatedAt: string;
};

export type CrmOpportunity = {
  id: string;
  name: string;
  stage: string;
  amountCents: number | null;
  currency: string;
  companyId: string | null;
  personId: string | null;
  company: { id: string; name: string } | null;
  person: { id: string; name: string } | null;
  expectedCloseAt: string | null;
  notes: string | null;
  createdBy: CrmCreatedBy;
  createdAt: string;
  updatedAt: string;
};

export type CrmCampaign = {
  id: string;
  name: string;
  status: string;
  description: string | null;
  startedAt: string | null;
  endedAt: string | null;
  notes: string | null;
  createdBy: CrmCreatedBy;
  createdAt: string;
  updatedAt: string;
};

export type CrmConversation = {
  id: string;
  subject: string;
  channel: string;
  body: string | null;
  personId: string | null;
  companyId: string | null;
  person: { id: string; name: string } | null;
  company: { id: string; name: string } | null;
  occurredAt: string;
  createdBy: CrmCreatedBy;
  createdAt: string;
  updatedAt: string;
};

export type CrmPage<T> = {
  items: T[];
  nextCursor: string | null;
  total: number;
};

export const crmKeys = {
  all: ["crm"] as const,
  people: (search = "") => ["crm", "people", { search }] as const,
  person: (id: string) => ["crm", "person", id] as const,
  companies: (search = "") => ["crm", "companies", { search }] as const,
  company: (id: string) => ["crm", "company", id] as const,
  opportunities: (search = "") => ["crm", "opportunities", { search }] as const,
  opportunity: (id: string) => ["crm", "opportunity", id] as const,
  campaigns: (search = "") => ["crm", "campaigns", { search }] as const,
  campaign: (id: string) => ["crm", "campaign", id] as const,
  conversations: (search = "") => ["crm", "conversations", { search }] as const,
  conversation: (id: string) => ["crm", "conversation", id] as const,
};

function searchQuery(search: string): string {
  const trimmed = search.trim();
  return trimmed ? `?search=${encodeURIComponent(trimmed)}` : "";
}

export function crmPeopleQueryOptions(search = "") {
  return queryOptions({
    queryKey: crmKeys.people(search),
    queryFn: async (): Promise<CrmPage<CrmPerson>> => {
      const body = (await (
        await client(`/api/crm/people${searchQuery(search)}`, {
          fallback: "Could not load people",
        })
      ).json()) as {
        people: CrmPerson[];
        nextCursor: string | null;
        total: number;
      };
      return {
        items: body.people,
        nextCursor: body.nextCursor,
        total: body.total,
      };
    },
  });
}

export function crmPersonQueryOptions(id: string) {
  return queryOptions({
    queryKey: crmKeys.person(id),
    queryFn: (): Promise<CrmPerson> =>
      client(`/api/crm/people/${id}`, "person", {
        fallback: "Could not load this person",
      }),
  });
}

export function crmCompaniesQueryOptions(search = "") {
  return queryOptions({
    queryKey: crmKeys.companies(search),
    queryFn: async (): Promise<CrmPage<CrmCompany>> => {
      const body = (await (
        await client(`/api/crm/companies${searchQuery(search)}`, {
          fallback: "Could not load companies",
        })
      ).json()) as {
        companies: CrmCompany[];
        nextCursor: string | null;
        total: number;
      };
      return {
        items: body.companies,
        nextCursor: body.nextCursor,
        total: body.total,
      };
    },
  });
}

export function crmCompanyQueryOptions(id: string) {
  return queryOptions({
    queryKey: crmKeys.company(id),
    queryFn: (): Promise<CrmCompany> =>
      client(`/api/crm/companies/${id}`, "company", {
        fallback: "Could not load this company",
      }),
  });
}

export function crmOpportunitiesQueryOptions(search = "") {
  return queryOptions({
    queryKey: crmKeys.opportunities(search),
    queryFn: async (): Promise<CrmPage<CrmOpportunity>> => {
      const body = (await (
        await client(`/api/crm/opportunities${searchQuery(search)}`, {
          fallback: "Could not load opportunities",
        })
      ).json()) as {
        opportunities: CrmOpportunity[];
        nextCursor: string | null;
        total: number;
      };
      return {
        items: body.opportunities,
        nextCursor: body.nextCursor,
        total: body.total,
      };
    },
  });
}

export function crmOpportunityQueryOptions(id: string) {
  return queryOptions({
    queryKey: crmKeys.opportunity(id),
    queryFn: (): Promise<CrmOpportunity> =>
      client(`/api/crm/opportunities/${id}`, "opportunity", {
        fallback: "Could not load this opportunity",
      }),
  });
}

export function crmCampaignsQueryOptions(search = "") {
  return queryOptions({
    queryKey: crmKeys.campaigns(search),
    queryFn: async (): Promise<CrmPage<CrmCampaign>> => {
      const body = (await (
        await client(`/api/crm/campaigns${searchQuery(search)}`, {
          fallback: "Could not load campaigns",
        })
      ).json()) as {
        campaigns: CrmCampaign[];
        nextCursor: string | null;
        total: number;
      };
      return {
        items: body.campaigns,
        nextCursor: body.nextCursor,
        total: body.total,
      };
    },
  });
}

export function crmCampaignQueryOptions(id: string) {
  return queryOptions({
    queryKey: crmKeys.campaign(id),
    queryFn: (): Promise<CrmCampaign> =>
      client(`/api/crm/campaigns/${id}`, "campaign", {
        fallback: "Could not load this campaign",
      }),
  });
}

export function crmConversationsQueryOptions(search = "") {
  return queryOptions({
    queryKey: crmKeys.conversations(search),
    queryFn: async (): Promise<CrmPage<CrmConversation>> => {
      const body = (await (
        await client(`/api/crm/conversations${searchQuery(search)}`, {
          fallback: "Could not load conversations",
        })
      ).json()) as {
        conversations: CrmConversation[];
        nextCursor: string | null;
        total: number;
      };
      return {
        items: body.conversations,
        nextCursor: body.nextCursor,
        total: body.total,
      };
    },
  });
}

export function crmConversationQueryOptions(id: string) {
  return queryOptions({
    queryKey: crmKeys.conversation(id),
    queryFn: (): Promise<CrmConversation> =>
      client(`/api/crm/conversations/${id}`, "conversation", {
        fallback: "Could not load this conversation",
      }),
  });
}
