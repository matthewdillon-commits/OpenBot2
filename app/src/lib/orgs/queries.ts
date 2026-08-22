import { queryOptions } from "@tanstack/react-query";
import { client } from "@/lib/client";

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
};

export type CurrentOrganization = {
  id: string;
  slug: string;
  name: string;
  role: "owner" | "admin" | "member";
  status: string;
  displayName: string;
  logoUrl: string | null;
  defaultModel: string | null;
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
      const body = (await (
        await client("/api/orgs/current", {
          fallback: "Could not load the organization",
        })
      ).json()) as { organization?: CurrentOrganization };
      return body.organization ?? null;
    },
  });
}

export function platformOrganizationListQueryOptions() {
  return queryOptions({
    queryKey: orgKeys.platform(),
    queryFn: (): Promise<{ id: string; slug: string; name: string; status: string; plan: string }[]> =>
      client("/api/platform/organizations", "organizations", {
        fallback: "Could not load organizations",
      }),
  });
}
