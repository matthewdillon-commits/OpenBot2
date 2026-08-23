import { queryOptions } from "@tanstack/react-query";
import { client } from "@/lib/client";

/**
 * A CRM record as the browser sees it.
 *
 * Created-by is a server-written fact: the screen renders `createdBy.name` rather than recomputing
 * who wrote the row. Tracking counts are server-derived too.
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
  stageKey: string;
  doNotContact: boolean;
  notes: string | null;
  createdBy: CrmCreatedBy;
  createdAt: string;
  updatedAt: string;
};

export type CrmOpportunity = {
  id: string;
  name: string;
  stage: string;
  position: number;
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

export type CrmSend = {
  id: string;
  kind: "email" | "sms" | "call";
  status: string;
  subject: string | null;
  body: string | null;
  toAddress: string;
  personId: string | null;
  companyId: string | null;
  campaignId: string | null;
  person: { id: string; name: string } | null;
  company: { id: string; name: string } | null;
  campaign: { id: string; name: string } | null;
  provider: string;
  sentAt: string | null;
  tracking: {
    opens: number;
    clicks: number;
    uniqueOpens: number;
    uniqueClicks: number;
    lastEventAt: string | null;
  };
  createdBy: CrmCreatedBy;
  createdAt: string;
  updatedAt: string;
};

export type CrmPage<T> = {
  items: T[];
  nextCursor: string | null;
  total: number;
  stageCounts?: Record<string, number>;
  totalAllStages?: number;
};

export type CrmThreadStatus =
  | "none"
  | "draft"
  | "queued"
  | "logged"
  | "sent"
  | "opened"
  | "clicked"
  | "failed"
  | "answered"
  | "no_answer";

export type CrmThread = {
  person: CrmPerson;
  latestSend: CrmSend | null;
  outboundCount: number;
  status: CrmThreadStatus;
};

export type CrmStages = {
  people: Array<{ key: string; label: string; position: number; playbook: string }>;
  opportunities: Array<{ key: string; label: string; position: number }>;
};

export const crmKeys = {
  all: ["crm"] as const,
  people: (search = "", stage = "") =>
    ["crm", "people", { search, stage }] as const,
  companies: (search = "") => ["crm", "companies", { search }] as const,
  opportunities: (search = "") => ["crm", "opportunities", { search }] as const,
  campaigns: (search = "") => ["crm", "campaigns", { search }] as const,
  conversations: (search = "") => ["crm", "conversations", { search }] as const,
  threads: (search = "") => ["crm", "threads", { search }] as const,
  stages: ["crm", "stages"] as const,
  person: (id: string) => ["crm", "person", id] as const,
  sends: (search = "", kind = "", personId = "", campaignId = "") =>
    ["crm", "sends", { search, kind, personId, campaignId }] as const,
};

function listParams(search: string, extra?: Record<string, string>) {
  const params = new URLSearchParams();
  if (search.trim()) params.set("search", search.trim());
  if (extra) {
    for (const [key, value] of Object.entries(extra)) {
      if (value) params.set(key, value);
    }
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

export function crmPeopleQueryOptions(search = "", stage = "") {
  return queryOptions({
    queryKey: crmKeys.people(search, stage),
    queryFn: async (): Promise<CrmPage<CrmPerson>> => {
      const body = (await (
        await client(
          `/api/crm/people${listParams(search, {
            limit: "200",
            ...(stage ? { stage } : {}),
          })}`,
          {
            fallback: "Could not load people",
          },
        )
      ).json()) as {
        people: CrmPerson[];
        nextCursor: string | null;
        total: number;
        stageCounts?: Record<string, number>;
        totalAllStages?: number;
      };
      return {
        items: body.people,
        nextCursor: body.nextCursor,
        total: body.total,
        stageCounts: body.stageCounts ?? {},
        totalAllStages: body.totalAllStages ?? body.total,
      };
    },
  });
}

export function crmCompaniesQueryOptions(search = "") {
  return queryOptions({
    queryKey: crmKeys.companies(search),
    queryFn: async (): Promise<CrmPage<CrmCompany>> => {
      const body = (await (
        await client(`/api/crm/companies${listParams(search, { limit: "200" })}`, {
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

export function crmOpportunitiesQueryOptions(search = "") {
  return queryOptions({
    queryKey: crmKeys.opportunities(search),
    queryFn: async (): Promise<CrmPage<CrmOpportunity>> => {
      const body = (await (
        await client(
          `/api/crm/opportunities${listParams(search, { limit: "200" })}`,
          {
            fallback: "Could not load opportunities",
          },
        )
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

export function crmCampaignsQueryOptions(search = "") {
  return queryOptions({
    queryKey: crmKeys.campaigns(search),
    queryFn: async (): Promise<CrmPage<CrmCampaign>> => {
      const body = (await (
        await client(`/api/crm/campaigns${listParams(search, { limit: "200" })}`, {
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

export function crmThreadsQueryOptions(search = "") {
  return queryOptions({
    queryKey: crmKeys.threads(search),
    queryFn: async (): Promise<CrmPage<CrmThread>> => {
      const body = (await (
        await client(`/api/crm/threads${listParams(search, { limit: "200" })}`, {
          fallback: "Could not load conversations",
        })
      ).json()) as {
        threads: CrmThread[];
        nextCursor: string | null;
        total: number;
      };
      return {
        items: body.threads,
        nextCursor: body.nextCursor,
        total: body.total,
      };
    },
  });
}

export function crmStagesQueryOptions() {
  return queryOptions({
    queryKey: crmKeys.stages,
    queryFn: async (): Promise<CrmStages> => {
      const body = (await (
        await client("/api/crm/stages", {
          fallback: "Could not load stages",
        })
      ).json()) as CrmStages;
      return body;
    },
  });
}

export function crmConversationsQueryOptions(search = "") {
  return queryOptions({
    queryKey: crmKeys.conversations(search),
    queryFn: async (): Promise<CrmPage<CrmConversation>> => {
      const body = (await (
        await client(`/api/crm/conversations${listParams(search)}`, {
          fallback: "Could not load activity",
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

export function crmPersonQueryOptions(id: string) {
  return queryOptions({
    queryKey: crmKeys.person(id),
    enabled: Boolean(id),
    queryFn: (): Promise<CrmPerson> =>
      client(`/api/crm/people/${id}`, "person", {
        fallback: "Could not load person",
      }),
  });
}

export function crmSendsQueryOptions(
  search = "",
  kind = "",
  personId = "",
  campaignId = "",
) {
  return queryOptions({
    queryKey: crmKeys.sends(search, kind, personId, campaignId),
    queryFn: async (): Promise<CrmPage<CrmSend>> => {
      const body = (await (
        await client(
          `/api/crm/sends${listParams(search, {
            limit: "200",
            ...(kind ? { kind } : {}),
            ...(personId ? { personId } : {}),
            ...(campaignId ? { campaignId } : {}),
          })}`,
          { fallback: "Could not load sends" },
        )
      ).json()) as {
        sends: CrmSend[];
        nextCursor: string | null;
        total: number;
      };
      return {
        items: body.sends,
        nextCursor: body.nextCursor,
        total: body.total,
      };
    },
  });
}
