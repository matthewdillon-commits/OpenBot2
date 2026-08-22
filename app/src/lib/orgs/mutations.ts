import { mutationOptions, type QueryClient } from "@tanstack/react-query";
import { client } from "@/lib/client";
import { orgKeys } from "./queries";

const FALLBACK = "Could not update the organization";

function invalidateOrgs(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: orgKeys.all });
}

export function activateOrganizationMutationOptions(queryClient: QueryClient) {
  return mutationOptions({
    mutationFn: (input: { slug: string }): Promise<void> =>
      client("/api/orgs/current", {
        method: "POST",
        body: input,
        fallback: FALLBACK,
      }).then(() => undefined),
    onSuccess: () => invalidateOrgs(queryClient),
  });
}

export function createOrganizationMutationOptions(queryClient: QueryClient) {
  return mutationOptions({
    mutationFn: (input: {
      name: string;
      slug?: string;
    }): Promise<{ id: string; slug: string; name: string }> =>
      client("/api/platform/organizations", "organization", {
        method: "POST",
        body: input,
        fallback: FALLBACK,
      }),
    onSuccess: () => invalidateOrgs(queryClient),
  });
}

export function inviteToOrganizationMutationOptions(queryClient: QueryClient) {
  return mutationOptions({
    mutationFn: (input: {
      orgId: string;
      email: string;
      role: "owner" | "admin" | "member";
    }): Promise<{ token: string }> =>
      client(`/api/platform/organizations/${input.orgId}/invites`, {
        method: "POST",
        body: { email: input.email, role: input.role },
        fallback: FALLBACK,
      }).then((response) => response.json() as Promise<{ token: string }>),
    onSuccess: () => invalidateOrgs(queryClient),
  });
}

export function setOrganizationStatusMutationOptions(queryClient: QueryClient) {
  return mutationOptions({
    mutationFn: (input: {
      orgId: string;
      status: "active" | "suspended";
    }): Promise<void> =>
      client(`/api/platform/organizations/${input.orgId}/status`, {
        method: "POST",
        body: { status: input.status },
        fallback: FALLBACK,
      }).then(() => undefined),
    onSuccess: () => invalidateOrgs(queryClient),
  });
}

export function acceptInviteMutationOptions(queryClient: QueryClient) {
  return mutationOptions({
    mutationFn: (token: string): Promise<void> =>
      client(`/api/orgs/invites/${token}/accept`, {
        method: "POST",
        body: {},
        fallback: "Could not accept that invite",
      }).then(() => undefined),
    onSuccess: () => invalidateOrgs(queryClient),
  });
}

export function inviteOrgMemberMutationOptions(queryClient: QueryClient) {
  return mutationOptions({
    mutationFn: (input: {
      email: string;
      role: "owner" | "admin" | "member";
    }): Promise<{ token: string }> =>
      client("/api/orgs/invites", {
        method: "POST",
        body: input,
        fallback: FALLBACK,
      }).then((response) => response.json() as Promise<{ token: string }>),
    onSuccess: () => invalidateOrgs(queryClient),
  });
}
