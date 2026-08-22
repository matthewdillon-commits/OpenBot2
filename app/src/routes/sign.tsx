import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { motion, useReducedMotion } from "motion/react";
import { useState } from "react";
import AgentOrb from "@/components/agents/orb/agent-orb";
import { ProviderLogo } from "@/components/auth/provider-logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
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
import { queryClient } from "@/query-client";

const EASE_OUT = [0.23, 1, 0.32, 1] as const;

const ENTRANCE_SECONDS = 0.4;
const ENTRANCE_STAGGER_SECONDS = 0.08;
const ENTRANCE_OFFSET = "translateY(12px)";

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

  const prefersReducedMotion = useReducedMotion();
  const hidden = {
    opacity: 0,
    ...(prefersReducedMotion ? {} : { transform: ENTRANCE_OFFSET }),
  };
  const shown = {
    opacity: 1,
    ...(prefersReducedMotion ? {} : { transform: "translateY(0px)" }),
  };
  const hasOtherMethods = providers.length > 0 || options?.sso === true;
  const busy = opening !== null;

  return (
    <div className="flex min-h-dvh w-full items-center justify-center overflow-y-auto py-8">
      <motion.div
        animate="shown"
        className="flex w-full max-w-82 flex-col items-center justify-center p-4"
        initial="hidden"
        variants={{
          hidden: {},
          shown: { transition: { staggerChildren: ENTRANCE_STAGGER_SECONDS } },
        }}
      >
        <motion.div
          transition={{ duration: ENTRANCE_SECONDS, ease: EASE_OUT }}
          variants={{ hidden, shown }}
          className="flex items-center justify-center"
        >
          <AgentOrb size="56px" />
        </motion.div>
        <motion.h1
          className="text-2xl font-medium tracking-tight text-center mt-8"
          transition={{ duration: ENTRANCE_SECONDS, ease: EASE_OUT }}
          variants={{ hidden, shown }}
        >
          {mode === "up"
            ? `Create an account on ${appConfig.brand.productName}`
            : `Sign in to ${appConfig.brand.productName}`}
        </motion.h1>
        {mode === "up" ? (
          <motion.p
            className="mt-2 text-center text-sm text-muted-foreground"
            transition={{ duration: ENTRANCE_SECONDS, ease: EASE_OUT }}
            variants={{ hidden, shown }}
          >
            Your organization is the company workspace you will work in.
          </motion.p>
        ) : null}
        <motion.div
          className="mt-8 w-full"
          transition={{ duration: ENTRANCE_SECONDS, ease: EASE_OUT }}
          variants={{ hidden, shown }}
        >
          {providers.length > 0 ? (
            <div className="flex flex-col gap-2">
              {providers.map((provider) => (
                /*
                 * Every provider gets the same button, and it is the light-themed outline one
                 * rather than the app's filled primary. Google's guidelines require their button be
                 * at least as prominent as any other sign-in option and specify its fill and
                 * stroke, so making one provider the loud one would break that for the others. The
                 * same size and weight throughout is also the honest presentation: a deployment
                 * that configured three has three, and none of them is the recommended one.
                 */
                <Button
                  className="h-10 w-full justify-start gap-3 px-3 tracking-tight"
                  disabled={busy}
                  key={provider}
                  onClick={() => handleSignIn(provider)}
                  size="lg"
                  variant="outline"
                >
                  <ProviderLogo provider={provider} />
                  {/* Centred against the button, not against the space left of the mark. */}
                  <span className="flex-1 text-center">
                    {opening === provider
                      ? `Opening ${providerName(provider)}…`
                      : `Continue with ${providerName(provider)}`}
                  </span>
                  {/* Balances the mark so the label sits in the middle of the button. */}
                  <span aria-hidden="true" className="size-[18px]" />
                </Button>
              ))}
            </div>
          ) : options?.sso || emailPassword ? null : (
            <p className="text-center text-sm text-muted-foreground">
              No sign-in provider is configured for this deployment.
            </p>
          )}
          {emailPassword ? (
            <form
              className={hasOtherMethods ? "mt-3" : undefined}
              onSubmit={handleEmailAuth}
            >
              {hasOtherMethods ? (
                <div className="mb-3 flex items-center gap-3">
                  <Separator className="flex-1" />
                  <span className="text-muted-foreground text-xs">or</span>
                  <Separator className="flex-1" />
                </div>
              ) : null}
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="sign-email">Email</Label>
                  <Input
                    autoComplete="email"
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
                    id="sign-password"
                    minLength={8}
                    onChange={(event) => setPassword(event.target.value)}
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
                      id="sign-organization"
                      onChange={(event) => setOrganization(event.target.value)}
                      placeholder="Your company"
                      required
                      value={organization}
                    />
                  </div>
                ) : null}
              </div>
              <Button
                className="mt-3 h-10 w-full tracking-tight"
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
                    : "Sign in"}
              </Button>
            </form>
          ) : null}
          {/*
           * The way in for a company that runs its own identity provider.
           *
           * Below the buttons, because a deployment with both has more people arriving through the
           * buttons: the registered providers are for the companies whose IdP was added by hand.
           */}
          {options?.sso ? (
            <form className="mt-3" onSubmit={handleDomainSignIn}>
              {providers.length > 0 || emailPassword ? (
                <div className="mb-3 flex items-center gap-3">
                  <Separator className="flex-1" />
                  <span className="text-muted-foreground text-xs">or</span>
                  <Separator className="flex-1" />
                </div>
              ) : null}
              <Input
                autoComplete="email"
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@company.com"
                required
                type="email"
                value={email}
              />
              <Button
                className="mt-2 h-10 w-full tracking-tight"
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
          {emailPassword ? (
            <p className="mt-4 text-center text-sm text-muted-foreground">
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
          {error ? (
            <p className="mt-3 text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
        </motion.div>
      </motion.div>
    </div>
  );
}
