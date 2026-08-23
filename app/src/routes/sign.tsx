import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { createOwnOrganizationMutationOptions } from "@/lib/orgs/mutations";
import { queryClient } from "@/query-client";

export const Route = createFileRoute("/sign")({
  beforeLoad: async ({ context }) => {
    const user = await context.queryClient.ensureQueryData(
      currentUserQueryOptions(),
    );
    if (user) {
      throw redirect({ to: user.orgId ? "/" : "/o" });
    }
    await context.queryClient.ensureQueryData(authProvidersQueryOptions());
  },
  component: SignScreen,
});

const fieldClassName = "h-11 bg-white border-border/50 rounded-xl";

/**
 * Copied from LimitlessAI-2's `/login` (app.limitlessai.ca): grain, logo, Welcome Back,
 * unlabeled rounded fields, navy Sign In with a lock, then Continue with Google.
 *
 * This screen is a deliberate exception to PageShell — it is the unauthenticated entrance.
 */
function SignScreen() {
  const [opening, setOpening] = useState<
    AuthProviderId | "sso" | "email" | null
  >(null);
  const [mode, setMode] = useState<"in" | "up">("in");
  const [error, setError] = useState<string | null>(null);
  const { data: options } = useQuery(authProvidersQueryOptions());
  const providers = options?.providers ?? [];
  const emailPassword = options?.emailPassword === true;
  const googleConfigured = providers.includes("google");
  const otherProviders = providers.filter((provider) => provider !== "google");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [organization, setOrganization] = useState("");
  const navigate = useNavigate();
  const createOrg = useMutation(
    createOwnOrganizationMutationOptions(queryClient),
  );
  const busy = opening !== null;

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

  async function handleGoogle() {
    setError(null);
    setOpening("google");

    if (!googleConfigured) {
      setError(
        "Google sign-in is not configured yet. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.",
      );
      setOpening(null);
      return;
    }

    try {
      await signInWith("google");
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Could not start Google sign-in.",
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
            : "Invalid email or password.",
      );
      setOpening(null);
    }
  }

  return (
    <div className="sign-screen min-h-screen bg-background flex flex-col items-center justify-center p-6">
      <div className="grain-overlay" />
      <div className="w-full max-w-sm space-y-8 relative z-10">
        <div className="flex flex-col items-center gap-4">
          <img alt="Logo" className="h-12 w-auto" src="/limitless-logo.png" />
          <h1 className="text-2xl font-semibold tracking-tight font-editorial">
            {mode === "up" ? "Create an account" : "Welcome Back"}
          </h1>
          <p className="text-sm text-muted-foreground text-center">
            {mode === "up"
              ? "Your organization is the company workspace you will work in."
              : "Sign in to your AI dashboard"}
          </p>
        </div>

        {emailPassword ? (
          <form className="space-y-4" onSubmit={handleEmailAuth}>
            <Input
              autoComplete="email"
              className={fieldClassName}
              data-testid="input-login-email"
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              required
              type="email"
              value={email}
            />
            <Input
              autoComplete={mode === "up" ? "new-password" : "current-password"}
              className={fieldClassName}
              data-testid="input-login-password"
              minLength={8}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Password"
              required
              type="password"
              value={password}
            />
            {mode === "up" ? (
              <Input
                autoComplete="organization"
                className={fieldClassName}
                onChange={(event) => setOrganization(event.target.value)}
                placeholder="Your company"
                required
                value={organization}
              />
            ) : (
              <div className="flex justify-end -mt-1">
                <button
                  className="text-xs text-muted-foreground hover:text-primary transition-colors"
                  data-testid="link-forgot-password"
                  onClick={() =>
                    setError(
                      "Password reset is not available on this deployment yet.",
                    )
                  }
                  type="button"
                >
                  Forgot password?
                </button>
              </div>
            )}
            {error ? (
              <p className="text-sm text-destructive text-center" role="alert">
                {error}
              </p>
            ) : null}
            <Button
              className="w-full h-11 rounded-xl shadow-lg shadow-primary/20"
              data-testid="button-client-login"
              disabled={
                busy ||
                email.trim().length === 0 ||
                password.length < 8 ||
                (mode === "up" && organization.trim().length === 0)
              }
              type="submit"
            >
              {opening === "email" ? (
                mode === "up" ? (
                  "Creating account…"
                ) : (
                  "Signing in…"
                )
              ) : (
                <>
                  <SignInMark />
                  {mode === "up" ? "Create account" : "Sign In"}
                </>
              )}
            </Button>
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-border/40" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-background px-3 text-muted-foreground">
                  or
                </span>
              </div>
            </div>
            <Button
              className="w-full h-11 rounded-xl"
              data-testid="button-login-google"
              disabled={busy}
              onClick={handleGoogle}
              type="button"
              variant="outline"
            >
              <GoogleMark />
              {opening === "google"
                ? "Opening Google…"
                : "Continue with Google"}
            </Button>
          </form>
        ) : (
          <div className="space-y-4">
            <Button
              className="w-full h-11 rounded-xl"
              data-testid="button-login-google"
              disabled={busy}
              onClick={handleGoogle}
              type="button"
              variant="outline"
            >
              <GoogleMark />
              {opening === "google"
                ? "Opening Google…"
                : "Continue with Google"}
            </Button>
            {error ? (
              <p className="text-sm text-destructive text-center" role="alert">
                {error}
              </p>
            ) : null}
          </div>
        )}

        {otherProviders.length > 0 ? (
          <div className="space-y-2">
            {otherProviders.map((provider) => (
              <Button
                className="w-full h-11 rounded-xl"
                disabled={busy}
                key={provider}
                onClick={() => handleSignIn(provider)}
                type="button"
                variant="outline"
              >
                {opening === provider
                  ? `Opening ${providerName(provider)}…`
                  : `Continue with ${providerName(provider)}`}
              </Button>
            ))}
          </div>
        ) : null}

        {options?.sso ? (
          <form className="space-y-4" onSubmit={handleDomainSignIn}>
            <Input
              autoComplete="email"
              className={fieldClassName}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              required
              type="email"
              value={email}
            />
            <Button
              className="w-full h-11 rounded-xl"
              disabled={busy || email.trim().length === 0}
              type="submit"
              variant="outline"
            >
              {opening === "sso"
                ? "Opening…"
                : "Continue with your company account"}
            </Button>
          </form>
        ) : null}

        {emailPassword ? (
          <div className="flex items-center justify-center gap-4 text-sm text-muted-foreground">
            {mode === "up" ? (
              <>
                Already have an account?{" "}
                <button
                  className="hover:text-primary transition-colors"
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
                  className="hover:text-primary transition-colors"
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
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Lucide `log-in`, the icon LimitlessAI-2 puts on Sign In. */
function SignInMark() {
  return (
    <svg
      aria-hidden="true"
      className="mr-2 h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <path d="m10 17 5-5-5-5" />
      <path d="M15 12H3" />
      <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
    </svg>
  );
}

/** Google's four-colour G, same paths LimitlessAI-2 uses on Continue with Google. */
function GoogleMark() {
  return (
    <svg aria-hidden="true" className="mr-2 h-4 w-4" viewBox="0 0 24 24">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  );
}
