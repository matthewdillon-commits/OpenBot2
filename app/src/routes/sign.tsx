import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ProviderLogo } from "@/components/auth/provider-logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  providerName,
  signInWith,
  signInWithEmail,
  signInWithEmailDomain,
  signUpWithEmail,
} from "@/lib/auth/client";
import {
  type AuthProviderId,
  authKeys,
  authProvidersQueryOptions,
  currentUserQueryOptions,
} from "@/lib/auth/queries";
import { appConfig } from "@/lib/generated/application-config";
import { createOwnOrganizationMutationOptions } from "@/lib/orgs/mutations";
import { cn } from "@/lib/utils";
import { queryClient } from "@/query-client";

export const Route = createFileRoute("/sign")({
  beforeLoad: async ({ context }) => {
    const user = await context.queryClient.ensureQueryData(
      currentUserQueryOptions(),
    );
    if (user) {
      throw redirect({ to: user.orgId ? "/" : "/o" });
    }
    // Loaded here so the screen paints with its buttons rather than painting empty and then
    // growing them, which reads as "no providers" for exactly as long as the request takes.
    await context.queryClient.ensureQueryData(authProvidersQueryOptions());
  },
  component: SignScreen,
});

const fieldClassName =
  "h-11 rounded-xl border-border/50 bg-white dark:bg-background";

/**
 * The unauthenticated entrance.
 *
 * This screen is a deliberate exception to PageShell: it is not a configuration page. The layout
 * matches LimitlessAI-2 — a centred column, editorial heading, rounded-xl fields, navy primary
 * button, then Continue with Google under an "or".
 */
function SignScreen() {
  // Which provider is being opened, rather than whether one is: with three buttons, a single
  // boolean would put "Opening…" on all of them.
  const [opening, setOpening] = useState<
    AuthProviderId | "sso" | "email" | null
  >(null);
  const [mode, setMode] = useState<"in" | "up">("in");
  const [error, setError] = useState<string | null>(null);
  const { data: options } = useQuery(authProvidersQueryOptions());
  const providers = options?.providers ?? [];
  const emailPassword = options?.emailPassword === true;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [organization, setOrganization] = useState("");
  const navigate = useNavigate();
  const createOrg = useMutation(
    createOwnOrganizationMutationOptions(queryClient),
  );

  /**
   * Sign in through whichever identity provider covers this address.
   *
   * No password is asked for and none is checked here: only the part after the @ is used, to decide
   * which registered provider to hand somebody to.
   */
  async function handleDomainSignIn(submission: React.FormEvent) {
    submission.preventDefault();
    setError(null);
    setOpening("sso");

    try {
      await signInWithEmailDomain(email);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "No identity provider is registered for that address.",
      );
      setOpening(null);
    }
  }

  async function handleSignIn(provider: AuthProviderId) {
    setError(null);
    setOpening(provider);

    try {
      await signInWith(provider);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : `Could not start ${providerName(provider)} sign-in.`,
      );
      setOpening(null);
    }
  }

  async function handleEmailAuth(submission: React.FormEvent) {
    submission.preventDefault();
    setError(null);
    setOpening("email");

    try {
      if (mode === "up") {
        const name = email.split("@")[0] || email;
        await signUpWithEmail({ email, password, name });
        await queryClient.invalidateQueries({ queryKey: authKeys.all });
        if (organization.trim()) {
          await createOrg.mutateAsync({ name: organization.trim() });
        }
      } else {
        await signInWithEmail({ email, password });
        await queryClient.invalidateQueries({ queryKey: authKeys.all });
      }

      const user = await queryClient.fetchQuery(currentUserQueryOptions());
      await navigate({ to: user?.orgId ? "/" : "/o" });
    } catch (caughtError) {
      const signedIn = await queryClient
        .fetchQuery(currentUserQueryOptions())
        .catch(() => null);
      if (signedIn) {
        await navigate({ to: signedIn.orgId ? "/" : "/o" });
        return;
      }
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : mode === "up"
            ? "Could not create an account."
            : "Could not sign in.",
      );
      setOpening(null);
    }
  }

  const busy = opening !== null;
  const otherProviders = providers.filter((provider) => provider !== "google");
  const googleConfigured = providers.includes("google");

  return (
    <div className="sign-screen flex min-h-dvh w-full flex-col items-center justify-center overflow-y-auto p-6">
      <div aria-hidden="true" className="sign-screen-grain" />
      <div className="relative z-10 flex w-full max-w-sm flex-col space-y-8">
        <div className="flex flex-col items-center gap-4">
          <p className="text-lg font-semibold tracking-tight">
            {appConfig.brand.productName}
          </p>
          <div className="flex flex-col items-center gap-1.5">
            <h1 className="text-center text-2xl font-semibold tracking-tight">
              {mode === "up" ? "Create an account" : "Welcome Back"}
            </h1>
            <p className="text-center text-sm text-muted-foreground">
              {mode === "up"
                ? "Your organization is the company workspace you will work in."
                : "Sign in to your AI dashboard"}
            </p>
          </div>
        </div>

        <div className="space-y-4">
          {emailPassword ? (
            <form className="space-y-3" onSubmit={handleEmailAuth}>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="sign-email">Email</Label>
                <Input
                  autoComplete="email"
                  className={fieldClassName}
                  id="sign-email"
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@company.com"
                  required
                  type="email"
                  value={email}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="sign-password">Password</Label>
                <Input
                  autoComplete={
                    mode === "up" ? "new-password" : "current-password"
                  }
                  className={fieldClassName}
                  id="sign-password"
                  minLength={8}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Password"
                  required
                  type="password"
                  value={password}
                />
              </div>
              {mode === "up" ? (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="sign-organization">Organization</Label>
                  <Input
                    autoComplete="organization"
                    className={fieldClassName}
                    id="sign-organization"
                    onChange={(event) => setOrganization(event.target.value)}
                    placeholder="Your company"
                    required
                    value={organization}
                  />
                </div>
              ) : null}
              {error ? (
                <p
                  className="text-center text-sm text-destructive"
                  role="alert"
                >
                  {error}
                </p>
              ) : null}
              <Button
                className="h-11 w-full rounded-xl bg-[hsl(230_65%_28%)] text-white shadow-lg shadow-[hsl(230_65%_28%)/0.2] hover:bg-[hsl(230_65%_24%)]"
                disabled={
                  busy ||
                  email.trim().length === 0 ||
                  password.length < 8 ||
                  (mode === "up" && organization.trim().length === 0)
                }
                size="lg"
                type="submit"
              >
                {opening === "email"
                  ? mode === "up"
                    ? "Creating account…"
                    : "Signing in…"
                  : mode === "up"
                    ? "Create account"
                    : "Sign In"}
              </Button>
            </form>
          ) : null}

          {googleConfigured || otherProviders.length > 0 || options?.sso ? (
            <OrDivider shown={emailPassword} />
          ) : null}

          {googleConfigured ? (
            <Button
              className="h-11 w-full justify-center gap-2 rounded-xl"
              disabled={busy}
              onClick={() => handleSignIn("google")}
              size="lg"
              variant="outline"
            >
              <ProviderLogo provider="google" />
              {opening === "google"
                ? "Opening Google…"
                : "Continue with Google"}
            </Button>
          ) : null}

          {otherProviders.length > 0 ? (
            <div className="flex flex-col gap-2">
              {otherProviders.map((provider) => (
                <Button
                  className="h-11 w-full justify-center gap-2 rounded-xl"
                  disabled={busy}
                  key={provider}
                  onClick={() => handleSignIn(provider)}
                  size="lg"
                  variant="outline"
                >
                  <ProviderLogo provider={provider} />
                  {opening === provider
                    ? `Opening ${providerName(provider)}…`
                    : `Continue with ${providerName(provider)}`}
                </Button>
              ))}
            </div>
          ) : null}

          {options?.sso ? (
            <form className="space-y-3" onSubmit={handleDomainSignIn}>
              <Input
                autoComplete="email"
                className={fieldClassName}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@company.com"
                required
                type="email"
                value={email}
              />
              <Button
                className="h-11 w-full rounded-xl"
                disabled={busy || email.trim().length === 0}
                size="lg"
                type="submit"
                variant="outline"
              >
                {opening === "sso"
                  ? "Opening…"
                  : "Continue with your company account"}
              </Button>
            </form>
          ) : null}

          {!emailPassword &&
          !googleConfigured &&
          otherProviders.length === 0 &&
          !options?.sso ? (
            <p className="text-center text-sm text-muted-foreground">
              No sign-in provider is configured for this deployment.
            </p>
          ) : null}

          {emailPassword ? (
            <p className="text-center text-sm text-muted-foreground">
              {mode === "up" ? (
                <>
                  Already have an account?{" "}
                  <button
                    className="text-foreground underline-offset-4 hover:underline"
                    onClick={() => {
                      setMode("in");
                      setError(null);
                    }}
                    type="button"
                  >
                    Sign in
                  </button>
                </>
              ) : (
                <>
                  No account yet?{" "}
                  <button
                    className="text-foreground underline-offset-4 hover:underline"
                    onClick={() => {
                      setMode("up");
                      setError(null);
                    }}
                    type="button"
                  >
                    Create one
                  </button>
                </>
              )}
            </p>
          ) : null}

          {!emailPassword && error ? (
            <p className="text-center text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function OrDivider({ shown }: { shown: boolean }) {
  if (!shown) return null;
  return (
    <div className="relative">
      <div className="absolute inset-0 flex items-center">
        <span className="w-full border-t border-border/40" />
      </div>
      <div className="relative flex justify-center text-xs uppercase">
        <span
          className={cn(
            "bg-[hsl(220_18%_97%)] px-3 text-muted-foreground dark:bg-background",
          )}
        >
          or
        </span>
      </div>
    </div>
  );
}
