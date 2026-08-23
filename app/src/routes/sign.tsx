import { useQuery } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
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

const fieldChrome =
  "flex h-[52px] items-center gap-3 rounded-[12px] border border-[#e6e6e6] bg-white px-3.5 transition-[border-color,box-shadow] focus-within:border-[#111] focus-within:shadow-[0_0_0_3px_rgba(0,0,0,0.04)]";
const fieldInput =
  "w-full bg-transparent text-[15px] text-[#111] outline-none placeholder:text-[#b0b0b0]";
const socialButton =
  "relative z-10 flex h-12 min-h-12 w-full touch-manipulation items-center justify-center gap-2.5 rounded-[12px] border border-[#e6e6e6] bg-white text-[14px] font-medium text-[#222] transition-colors hover:bg-[#fafafa] disabled:opacity-50";

/**
 * Copied from os.limitlessai.ca/login: split form and aerial hero, Inter Tight,
 * labelled fields, black Sign In, Google + Apple Soon.
 *
 * This screen is a deliberate exception to PageShell — it is the unauthenticated entrance.
 */
function SignScreen() {
  const [opening, setOpening] = useState<
    AuthProviderId | "sso" | "email" | null
  >(null);
  const [mode, setMode] = useState<"in" | "up">("in");
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const { data: options } = useQuery(authProvidersQueryOptions());
  const providers = options?.providers ?? [];
  const emailPassword = options?.emailPassword === true;
  const googleConfigured = providers.includes("google");
  const otherProviders = providers.filter((provider) => provider !== "google");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const navigate = useNavigate();
  const busy = opening !== null;
  const year = new Date().getFullYear();

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
        const accountName = name.trim() || email.split("@")[0] || email;
        await signUpWithEmail({ email, password, name: accountName });
        await queryClient.invalidateQueries({ queryKey: authKeys.all });
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
    <div className="sign-screen flex min-h-dvh w-full bg-white">
      <div className="relative flex w-full min-w-0 flex-col px-4 py-6 sm:px-10 lg:w-[46%] lg:px-12 xl:px-16">
        <div className="mx-auto flex w-full min-w-0 max-w-[420px] flex-1 flex-col">
          <div className="flex items-center">
            <div className="flex min-w-0 items-center gap-2.5">
              <img
                alt="LimitlessAI"
                className="ui-logo block shrink-0 object-contain !rounded-none"
                decoding="async"
                draggable={false}
                height={32}
                src="/logo.webp"
                style={{ width: 32, height: 32 }}
                width={32}
              />
              <span className="truncate text-[15px] font-semibold leading-none tracking-[-0.02em] text-[#111]">
                LimitlessAI
              </span>
            </div>
          </div>

          <div className="flex min-w-0 flex-1 flex-col justify-center py-8 sm:py-10">
            <div className="min-w-0">
              <h1 className="text-[28px] font-semibold leading-[1.15] tracking-[-0.03em] text-[#111] sm:text-[34px]">
                {mode === "up" ? "Create Your Account" : "Welcome back"}
              </h1>
              <p className="mt-2.5 text-[15px] leading-relaxed text-[#6b6b6b] text-pretty">
                {mode === "up"
                  ? "Welcome to LimitlessAI. Put agents to work in your workspace."
                  : "Sign in to LimitlessAI and pick up where you left off."}
              </p>

              {emailPassword ? (
                <form className="mt-8 min-w-0 space-y-4" onSubmit={handleEmailAuth}>
                  {mode === "up" ? (
                    <Field label="Full Name">
                      <UserMark />
                      <input
                        autoComplete="name"
                        className={fieldInput}
                        name="name"
                        onChange={(event) => setName(event.target.value)}
                        placeholder="Alex Morgan"
                        value={name}
                      />
                    </Field>
                  ) : null}
                  <Field label="Email Address">
                    <MailMark />
                    <input
                      autoComplete="email"
                      className={fieldInput}
                      data-testid="input-login-email"
                      name="email"
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder="alex@company.com"
                      required
                      type="email"
                      value={email}
                    />
                  </Field>
                  <Field
                    extra={
                      mode === "in" ? (
                        <button
                          className="font-normal text-[#6b6b6b] underline-offset-2 hover:underline"
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
                      ) : null
                    }
                    label="Password"
                  >
                    <LockMark />
                    <input
                      autoComplete={
                        mode === "up" ? "new-password" : "current-password"
                      }
                      className={fieldInput}
                      data-testid="input-login-password"
                      minLength={8}
                      name="password"
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder="At least 8 characters"
                      required
                      type={showPassword ? "text" : "password"}
                      value={password}
                    />
                    <button
                      aria-label={
                        showPassword ? "Hide password" : "Show password"
                      }
                      className="shrink-0 text-[#9a9a9a] hover:text-[#444]"
                      onClick={() => setShowPassword((value) => !value)}
                      type="button"
                    >
                      {showPassword ? <EyeOffMark /> : <EyeMark />}
                    </button>
                  </Field>
                  {error ? (
                    <p className="text-sm text-[#c00]" role="alert">
                      {error}
                    </p>
                  ) : null}
                  <button
                    className="mt-2 flex h-[52px] w-full items-center justify-center gap-2 rounded-[12px] bg-[#111] text-[15px] font-medium text-white transition-opacity enabled:hover:opacity-90 disabled:bg-[#d4d4d4] disabled:text-white"
                    data-testid="button-client-login"
                    disabled={
                      busy ||
                      email.trim().length === 0 ||
                      password.length < 8 ||
                      (mode === "up" && name.trim().length === 0)
                    }
                    type="submit"
                  >
                    {opening === "email"
                      ? mode === "up"
                        ? "Creating account…"
                        : "Signing in…"
                      : mode === "up"
                        ? "Create Account"
                        : "Sign In"}
                  </button>
                </form>
              ) : null}

              <div className="my-6 flex items-center gap-3">
                <div className="h-px flex-1 bg-[#e8e8e8]" />
                <span className="text-[13px] text-[#9a9a9a]">Or</span>
                <div className="h-px flex-1 bg-[#e8e8e8]" />
              </div>

              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                <button
                  className={socialButton}
                  data-testid="button-login-google"
                  disabled={busy}
                  onClick={handleGoogle}
                  type="button"
                >
                  <span className="inline-flex h-[18px] w-[18px] items-center justify-center">
                    <GoogleMark />
                  </span>
                  {opening === "google"
                    ? "Opening Google…"
                    : mode === "up"
                      ? "Sign up with Google"
                      : "Continue with Google"}
                </button>
                <button
                  className="relative flex h-[48px] items-center justify-center gap-2.5 rounded-[12px] border border-[#e6e6e6] bg-white text-[14px] font-medium text-[#222] transition-colors hover:bg-[#fafafa] disabled:opacity-50"
                  disabled
                  type="button"
                >
                  <span className="inline-flex h-[18px] w-[18px] items-center justify-center text-[#111]">
                    <AppleMark />
                  </span>
                  Continue with Apple
                  <span className="absolute -top-2 right-2 rounded-full bg-[#111] px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.04em] text-white">
                    Soon
                  </span>
                </button>
              </div>

              {otherProviders.length > 0 ? (
                <div className="mt-2.5 space-y-2.5">
                  {otherProviders.map((provider) => (
                    <button
                      className={socialButton}
                      disabled={busy}
                      key={provider}
                      onClick={() => handleSignIn(provider)}
                      type="button"
                    >
                      {opening === provider
                        ? `Opening ${providerName(provider)}…`
                        : `Continue with ${providerName(provider)}`}
                    </button>
                  ))}
                </div>
              ) : null}

              {options?.sso ? (
                <form className="mt-4 space-y-4" onSubmit={handleDomainSignIn}>
                  <Field label="Work email">
                    <MailMark />
                    <input
                      autoComplete="email"
                      className={fieldInput}
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder="alex@company.com"
                      required
                      type="email"
                      value={email}
                    />
                  </Field>
                  <button
                    className={socialButton}
                    disabled={busy || email.trim().length === 0}
                    type="submit"
                  >
                    {opening === "sso"
                      ? "Opening…"
                      : "Continue with your company account"}
                  </button>
                </form>
              ) : null}

              {emailPassword ? (
                <p className="mt-6 text-center text-[14px] text-[#6b6b6b]">
                  {mode === "up" ? (
                    <>
                      Already have an account?{" "}
                      <button
                        className="font-semibold text-[#111] underline-offset-2 hover:underline"
                        onClick={() => {
                          setMode("in");
                          setError(null);
                        }}
                        type="button"
                      >
                        Sign In
                      </button>
                    </>
                  ) : (
                    <>
                      Need an account?{" "}
                      <button
                        className="font-semibold text-[#111] underline-offset-2 hover:underline"
                        onClick={() => {
                          setMode("up");
                          setError(null);
                        }}
                        type="button"
                      >
                        Create Account
                      </button>
                    </>
                  )}
                </p>
              ) : null}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pb-[max(0.25rem,env(safe-area-inset-bottom))] text-[12px] text-[#9a9a9a]">
            <span>© {year} LimitlessAI</span>
            <a
              className="text-[#666] transition-colors hover:text-[#111]"
              href="mailto:support@limitlessai.ca"
            >
              Need help? Contact Support
            </a>
          </div>
        </div>
      </div>

      <div className="auth-hero relative hidden overflow-hidden lg:block lg:w-[54%]">
        <div className="auth-hero-bg absolute inset-0 scale-[1.02] blur-[2px]" />
        <div className="absolute inset-0 bg-black/20" />
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.35] mix-blend-overlay"
          style={{
            backgroundImage:
              "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
            backgroundSize: "180px 180px",
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-black/10" />
        <div className="absolute inset-x-0 bottom-0 p-10 xl:p-14">
          <p
            className="max-w-[520px] text-[22px] font-medium leading-[1.35] tracking-[-0.02em] text-white xl:text-[24px]"
            style={{
              fontFamily: "ui-serif, Georgia, 'Times New Roman', serif",
            }}
          >
            LimitlessAI puts agents to work across research, CRM, and outreach —
            so your team ships while you stay in control.
          </p>
          <div className="mt-8 flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-full bg-white/15 ring-1 ring-white/30 backdrop-blur-sm">
              <img
                alt="LimitlessAI"
                className="ui-logo block shrink-0 object-contain"
                decoding="async"
                draggable={false}
                height={26}
                src="/logo.webp"
                style={{ width: 26, height: 26 }}
                width={26}
              />
            </div>
            <div>
              <div className="text-[14px] font-semibold text-white">
                Your workspace
              </div>
              <div className="text-[13px] text-white/75">
                Agents · CRM · drafts — shared with your team
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({
  extra,
  label,
  children,
}: {
  extra?: ReactNode;
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span
        className={
          extra
            ? "mb-1.5 flex items-center justify-between text-[13px] font-medium text-[#222]"
            : "mb-1.5 block text-[13px] font-medium text-[#222]"
        }
      >
        {extra ? (
          <>
            <span>
              {label} <span className="text-[#111]">*</span>
            </span>
            {extra}
          </>
        ) : (
          <>
            {label} <span className="text-[#111]">*</span>
          </>
        )}
      </span>
      <div className={fieldChrome}>{children}</div>
    </label>
  );
}

function MailMark() {
  return (
    <svg
      aria-hidden="true"
      className="h-[18px] w-[18px] shrink-0 text-[#9a9a9a]"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.75"
      viewBox="0 0 24 24"
    >
      <path d="m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7" />
      <rect height="16" rx="2" width="20" x="2" y="4" />
    </svg>
  );
}

function LockMark() {
  return (
    <svg
      aria-hidden="true"
      className="h-[18px] w-[18px] shrink-0 text-[#9a9a9a]"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.75"
      viewBox="0 0 24 24"
    >
      <rect height="11" rx="2" ry="2" width="18" x="3" y="11" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function UserMark() {
  return (
    <svg
      aria-hidden="true"
      className="h-[18px] w-[18px] shrink-0 text-[#9a9a9a]"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.75"
      viewBox="0 0 24 24"
    >
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function EyeMark() {
  return (
    <svg
      aria-hidden="true"
      className="h-[18px] w-[18px]"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.75"
      viewBox="0 0 24 24"
    >
      <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffMark() {
  return (
    <svg
      aria-hidden="true"
      className="h-[18px] w-[18px]"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.75"
      viewBox="0 0 24 24"
    >
      <path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49" />
      <path d="M14.084 14.158a3 3 0 0 1-4.242-4.242" />
      <path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.073" />
      <path d="m2 2 20 20" />
    </svg>
  );
}

function GoogleMark() {
  return (
    <svg aria-hidden="true" height="18" viewBox="0 0 18 18" width="18">
      <path
        d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615Z"
        fill="#4285F4"
      />
      <path
        d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18Z"
        fill="#34A853"
      />
      <path
        d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332Z"
        fill="#FBBC05"
      />
      <path
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58Z"
        fill="#EA4335"
      />
    </svg>
  );
}

function AppleMark() {
  return (
    <svg
      aria-hidden="true"
      fill="currentColor"
      height="18"
      viewBox="0 0 24 24"
      width="18"
    >
      <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83ZM13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11Z" />
    </svg>
  );
}
