import { queryOptions } from "@tanstack/react-query";
import { client, tryClient } from "@/lib/client";

export type AuthenticatedUser = {
  id: string;
  email: string;
  name?: string | null;
  image?: string | null;
  role: "admin" | "user";
  orgId?: string;
  orgSlug?: string;
  orgName?: string;
  orgRole?: "owner" | "admin" | "member";
  platformSuperadmin?: boolean;
  /**
   * Deployment-wide `/admin`. Server-decided: PLATFORM_SUPERADMINS,
   * INITIAL_ADMIN_EMAILS, or a user_roles administrator. Org owner is not enough.
   * The browser renders this flag; it does not recompute it.
   */
  deploymentAdmin?: boolean;
  /**
   * Operator door. Server-decided: org owner/admin or deployment admin.
   * The browser renders this flag; it does not recompute it.
   */
  canSeeTheWork?: boolean;
  /**
   * Whether this session may open `/admin`. Server-decided from
   * {@link deploymentAdmin} / platform superadmin. Org owner is not enough.
   */
  canOpenDeploymentAdmin?: boolean;
};

export const authKeys = {
  all: ["auth"] as const,
  currentUser: () => [...authKeys.all, "current-user"] as const,
  providers: () => [...authKeys.all, "providers"] as const,
};

/** An identity provider this deployment can sign somebody in with. */
export type AuthProviderId = "google" | "microsoft" | "okta";

/** What the sign-in screen may offer, answered by the process that knows. */
export type SignInOptions = {
  providers: AuthProviderId[];
  /**
   * Whether any enterprise identity provider is registered.
   *
   * A boolean, not a list: naming them would tell anybody who loads the sign-in page which companies
   * use this deployment, before they have signed in.
   */
  sso: boolean;
  /** Whether this deployment accepts an email and a password. */
  emailPassword: boolean;
};

export type SsoForEmail = {
  orgId: string | null;
  google: boolean;
  microsoft: boolean;
  okta: boolean;
  email: boolean;
};

async function signInOptions(): Promise<SignInOptions> {
  // The whole body, so both fields arrive together. Reading a field off the Response `client`
  // returns without a key quietly yields undefined: the screen would say no provider is configured
  // while the server was saying it has one.
  const body = (await (
    await client("/api/capabilities", { fallback: "Could not load sign-in" })
  ).json()) as {
    authProviders?: AuthProviderId[];
    ssoConfigured?: boolean;
    emailPassword?: boolean;
  };

  return {
    providers: body.authProviders ?? [],
    sso: body.ssoConfigured === true,
    emailPassword: body.emailPassword === true,
  };
}

/**
 * Which providers the sign-in screen may offer.
 *
 * From the server rather than from the build. The image is built once with no deployment
 * environment, so a list compiled into the bundle can only ever describe the build machine.
 */
export function authProvidersQueryOptions() {
  return queryOptions({
    queryKey: authKeys.providers(),
    queryFn: signInOptions,
    // Configuration, not data. It cannot change without the process restarting.
    staleTime: Number.POSITIVE_INFINITY,
  });
}

async function currentUser(): Promise<AuthenticatedUser | null> {
  /*
   * `tryClient` rather than `client`: not being signed in is an answer here, not a failure, and it
   * arrives as a 401 that has to be read before anything decides the request went wrong.
   */
  const response = await tryClient("/api/me");
  if (response.status === 401) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`Could not load the current user (${response.status})`);
  }

  const body = (await response.json()) as { user: AuthenticatedUser };
  return body.user;
}

export function currentUserQueryOptions() {
  return queryOptions({
    queryKey: authKeys.currentUser(),
    queryFn: currentUser,
    staleTime: 60_000,
  });
}

export function ssoForEmailQueryOptions(email: string) {
  return queryOptions({
    queryKey: [...authKeys.all, "sso-for-email", email] as const,
    enabled: email.includes("@"),
    queryFn: async (): Promise<SsoForEmail> => {
      const response = await tryClient(
        `/api/auth/sso-for-email?email=${encodeURIComponent(email)}`,
      );
      if (!response.ok) {
        return {
          orgId: null,
          google: true,
          microsoft: true,
          okta: true,
          email: true,
        };
      }
      return (await response.json()) as SsoForEmail;
    },
  });
}
