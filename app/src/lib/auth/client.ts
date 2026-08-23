import { ssoClient } from "@better-auth/sso/client";
import { createAuthClient } from "better-auth/react";
import type { AuthProviderId } from "./queries";

export const authClient = createAuthClient({ plugins: [ssoClient()] });

/** What each provider is called on the button, since none of them are called by their id. */
const PROVIDER_NAMES: Record<AuthProviderId, string> = {
  google: "Google",
  microsoft: "Microsoft",
  okta: "Okta",
};

export function providerName(provider: AuthProviderId): string {
  return PROVIDER_NAMES[provider];
}

/** What a sign-in attempt came back with, which is either nothing or a reason. */
type SocialResult = { error?: { message?: string } | null };

/**
 * Start sign-in with one provider.
 *
 * One call for all three, including Okta. Okta is served by the generic OAuth plugin rather than as
 * a named provider, but the plugin registers under a provider id like any other, so the browser does
 * not need to know which kind it is asking for. Keeping that distinction on the server is the point:
 * a deployment can gain a provider without the app being rebuilt.
 *
 * `start` is injectable because Better Auth's client is a proxy, so a test cannot replace the method
 * on it. Named so it cannot shadow anything it defaults to.
 */
export async function signInWith(
  provider: AuthProviderId,
  start: (input: {
    provider: string;
    callbackURL: string;
    errorCallbackURL: string;
  }) => Promise<SocialResult> = (input) =>
    authClient.signIn.social(input as never) as Promise<SocialResult>,
) {
  const result = await start({
    provider,
    callbackURL: window.location.origin,
    errorCallbackURL: `${window.location.origin}/sign`,
  });

  if (result.error) {
    // Naming the provider matters more with three buttons than it did with one: "Could not start
    // sign-in" leaves somebody looking at three of them with no idea which one refused.
    throw new Error(
      result.error.message ||
        `Could not start ${providerName(provider)} sign-in.`,
    );
  }
}

/** What an email/password attempt came back with. */
type EmailResult = { error?: { message?: string } | null };

/**
 * Sign in with an email and a password.
 *
 * Injectable for the same reason as {@link signInWith}: the Better Auth client is a proxy.
 */
export async function signInWithEmail(
  input: { email: string; password: string },
  start: (credentials: {
    email: string;
    password: string;
    callbackURL: string;
  }) => Promise<EmailResult> = (credentials) =>
    authClient.signIn.email(credentials) as Promise<EmailResult>,
) {
  const result = await start({
    ...input,
    callbackURL: window.location.origin,
  });

  if (result.error) {
    throw new Error(result.error.message || "Could not sign in.");
  }
}

/**
 * Create an account with an email and a password.
 *
 * The organization is created afterwards, by the caller, so this stays a Better Auth call
 * and does not invent a second sign-up endpoint.
 */
export async function signUpWithEmail(
  input: { email: string; password: string; name: string },
  start: (credentials: {
    email: string;
    password: string;
    name: string;
    callbackURL: string;
  }) => Promise<EmailResult> = (credentials) =>
    authClient.signUp.email(credentials) as Promise<EmailResult>,
) {
  const result = await start({
    ...input,
    callbackURL: window.location.origin,
  });

  if (result.error) {
    throw new Error(result.error.message || "Could not create an account.");
  }
}

/**
 * Start sign-in through whichever identity provider covers this address.
 *
 * The email is not a credential here and no password is asked for: only the part after the @ is
 * used, to decide which registered provider to hand somebody to. A company with two IdPs mid-merger
 * has two domains, and this is how somebody reaches theirs without being asked which one they are.
 *
 * Injectable for the same reason as `signInWith`: the Better Auth client is a proxy.
 */
export async function signInWithEmailDomain(
  email: string,
  start: (input: {
    email: string;
    callbackURL: string;
    errorCallbackURL: string;
  }) => Promise<SocialResult> = (input) =>
    (
      authClient as unknown as {
        signIn: { sso: (i: unknown) => Promise<SocialResult> };
      }
    ).signIn.sso(input),
) {
  const result = await start({
    email,
    callbackURL: window.location.origin,
    errorCallbackURL: `${window.location.origin}/sign`,
  });

  if (result.error) {
    throw new Error(
      result.error.message ||
        "No identity provider is registered for that address.",
    );
  }
}
