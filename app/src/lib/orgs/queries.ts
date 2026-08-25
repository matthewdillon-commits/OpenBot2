import { queryOptions } from "@tanstack/react-query";
import { client, tryClient } from "@/lib/client";

export type OrganizationSummary = {
  id: string;
  slug: string;
  name: string;
  status: "active" | "suspended";
  plan: string;
  role: "owner" | "admin" | "member";
};

export type OrganizationList = {
  organizations: OrganizationSummary[];
  current: OrganizationSummary | null;
  platformSuperadmin: boolean;
  checkout: boolean;
};

export type CurrentOrganization = {
  id: string;
  slug: string;
  name: string;
  role: "owner" | "admin" | "member";
  status: string;
  plan: string;
  displayName: string;
  logoUrl: string | null;
  defaultModel: string | null;
  seatLimit: number;
  seatsUsed: number;
  seatMembers: number;
  pendingInvites: number;
  spendCapCents: number | null;
  spendUsedCents: number;
  checkout: boolean;
  sso: {
    googleEnabled: boolean;
    microsoftEnabled: boolean;
    oktaEnabled: boolean;
    emailEnabled: boolean;
    domains: string[];
  } | null;
};

export const orgKeys = {
  all: ["orgs"] as const,
  list: () => [...orgKeys.all, "list"] as const,
  current: () => [...orgKeys.all, "current"] as const,
  platform: () => [...orgKeys.all, "platform"] as const,
};

export function organizationListQueryOptions() {
  return queryOptions({
    queryKey: orgKeys.list(),
    queryFn: (): Promise<OrganizationList> =>
      client("/api/orgs", {
        fallback: "Could not load organizations",
      }).then((response) => response.json() as Promise<OrganizationList>),
  });
}

export function currentOrganizationQueryOptions() {
  return queryOptions({
    queryKey: orgKeys.current(),
    queryFn: async (): Promise<CurrentOrganization | null> => {
      const response = await tryClient("/api/orgs/current");
      if (response.status === 404) return null;
      if (!response.ok) {
        const message = await response
          .json()
          .then((body: { error?: string }) => body.error)
          .catch(() => undefined);
        throw new Error(message ?? "Could not load the organization");
      }
      const body = (await response.json()) as {
        organization?: CurrentOrganization;
      };
      return body.organization ?? null;
    },
  });
}

export function platformOrganizationListQueryOptions() {
  return queryOptions({
    queryKey: orgKeys.platform(),
    queryFn: (): Promise<
      { id: string; slug: string; name: string; status: string; plan: string }[]
    > =>
      client("/api/platform/organizations", "organizations", {
        fallback: "Could not load organizations",
      }),
  });
}
