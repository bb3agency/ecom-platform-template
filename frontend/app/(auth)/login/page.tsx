"use client";

import Link from "next/link";
import { Suspense, useState, useCallback, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { RefreshCw } from "lucide-react";
import { APP_NAME } from "@/lib/constants";
import { useAuthStore } from "@/stores/auth";
import { mergeGuestCartAfterAuth } from "@/lib/post-auth-cart-merge";
import {
  checkIdentifier,
  loginWithEmail,
  sendOtp,
  verifyOtp,
  getOtpChannelConfig,
  type OtpChannelConfigResponse,
} from "@/lib/auth-api";
import { getApiErrorMessage } from "@/lib/error-messages";
import { AuthErrorBanner } from "@/components/auth/AuthErrorBanner";
import { TurnstileChallenge } from "@/components/auth/TurnstileChallenge";
import { useAuthTurnstile } from "@/hooks/use-auth-turnstile";
import type { AuthSession } from "@/types/user";
import { otpSchema, passwordSchema } from "@/lib/validators";

const OTP_RESEND_COOLDOWN = 60;

// ── form schemas ─────────────────────────────────────────────────────────────
const identifierSchema = z.object({
  identifier: z.string().min(1, "Enter your mobile number or email").max(255),
});
const passwordFormSchema = z.object({
  password: passwordSchema,
});
const otpFormSchema = z.object({
  otp: otpSchema,
});

type IdentifierValues = z.infer<typeof identifierSchema>;
type PasswordValues = z.infer<typeof passwordFormSchema>;
type OtpValues = z.infer<typeof otpFormSchema>;

// ── step types ────────────────────────────────────────────────────────────────
type Step =
  | { kind: "identifier" }
  | { kind: "otp"; phone: string }
  | { kind: "password"; identifier: string };

// ─────────────────────────────────────────────────────────────────────────────

function LoginPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const setSession = useAuthStore((s) => s.setSession);
  const justReset = searchParams.get("reset") === "success";
  const rawRedirect = searchParams.get("redirect") ?? "";
  const redirectTo = rawRedirect.startsWith("/") && !rawRedirect.startsWith("//") ? rawRedirect : "/dashboard";

  const [step, setStep] = useState<Step>({ kind: "identifier" });
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [resending, setResending] = useState(false);
  const [otpConfig, setOtpConfig] = useState<OtpChannelConfigResponse | null>(null);

  const {
    required: turnstileRequired,
    ready: turnstileReady,
    widgetKey,
    turnstileField,
    onTurnstileTokenChange,
    bumpTurnstileWidget,
    turnstileLoadError,
    setTurnstileLoadError,
  } = useAuthTurnstile();

  // Load OTP config once (needed to know which channel to use for SMS resend)
  useEffect(() => {
    getOtpChannelConfig()
      .then(setOtpConfig)
      .catch(() => {/* non-fatal */ });
  }, []);

  // Countdown timer for OTP resend
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const id = setTimeout(() => setResendCooldown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [resendCooldown]);

  // ── forms ──────────────────────────────────────────────────────────────────
  const identifierForm = useForm<IdentifierValues>({
    resolver: zodResolver(identifierSchema),
    defaultValues: { identifier: "" },
  });

  const passwordForm = useForm<PasswordValues>({
    resolver: zodResolver(passwordFormSchema),
    defaultValues: { password: "" },
  });

  const otpForm = useForm<OtpValues>({
    resolver: zodResolver(otpFormSchema),
    defaultValues: { otp: "" },
  });

  // ── helpers ────────────────────────────────────────────────────────────────
  const handleSuccess = useCallback(
    async (session: AuthSession) => {
      setSession(session.accessToken, session.user);
      await mergeGuestCartAfterAuth(session.accessToken);
      router.push(redirectTo);
    },
    [redirectTo, router, setSession],
  );

  const effectiveChannel = otpConfig?.channel ?? "sms";

  const doSendOtp = useCallback(
    async (phone: string) => {
      return sendOtp({
        phone,
        channel: effectiveChannel,
        ...turnstileField,
      });
    },
    [effectiveChannel, turnstileField],
  );

  // ── Step 1: check identifier ───────────────────────────────────────────────
  const handleContinue = identifierForm.handleSubmit(async (values) => {
    if (turnstileRequired && !turnstileReady) {
      setError("Complete the security check, then try again.");
      return;
    }
    const raw = values.identifier.trim();
    try {
      setError(null);
      setInfo(null);
      setChecking(true);

      const check = await checkIdentifier({ identifier: raw });
      if (!check.exists) {
        const label = check.identifierType === "phone" ? "Mobile number" : "Email";
        setError(`${label} not registered. Please create an account first.`);
        return;
      }

      if (check.identifierType === "phone") {
        // Send OTP immediately and move to OTP step
        const result = await doSendOtp(raw);
        setInfo(result.message);
        setResendCooldown(OTP_RESEND_COOLDOWN);
        setStep({ kind: "otp", phone: raw });
      } else {
        // Email — move to password step
        setStep({ kind: "password", identifier: raw });
      }
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setChecking(false);
    }
  });

  // ── Step 2a: verify OTP ────────────────────────────────────────────────────
  const handleVerifyOtp = otpForm.handleSubmit(async (values) => {
    if (step.kind !== "otp") return;
    try {
      setError(null);
      const session = await verifyOtp({ phone: step.phone, otp: values.otp });
      await handleSuccess(session);
    } catch (err) {
      const raw = getApiErrorMessage(err);
      setError(
        raw.toLowerCase().includes("invalid credentials") ||
          raw.toLowerCase().includes("email or password")
          ? "Invalid or expired OTP. Please try again."
          : raw,
      );
    }
  });

  // ── Step 2a: resend OTP ────────────────────────────────────────────────────
  const handleResend = async () => {
    if (step.kind !== "otp" || resendCooldown > 0 || resending) return;
    setResending(true);
    setError(null);
    setInfo(null);
    bumpTurnstileWidget?.();
    await new Promise((r) => setTimeout(r, 300));
    try {
      const result = await doSendOtp(step.phone);
      setInfo(`OTP resent. ${result.message}`);
      setResendCooldown(OTP_RESEND_COOLDOWN);
      otpForm.resetField("otp");
    } catch (err) {
      const raw = getApiErrorMessage(err);
      const match = /retry after (\d+)/i.exec(raw);
      if (match) setResendCooldown(Number(match[1]));
      setError(raw);
    } finally {
      setResending(false);
    }
  };

  // ── Step 2b: password login ────────────────────────────────────────────────
  const handlePasswordLogin = passwordForm.handleSubmit(async (values) => {
    if (step.kind !== "password") return;
    if (turnstileRequired && !turnstileReady) {
      setError("Complete the security check, then try again.");
      return;
    }
    try {
      setError(null);
      const session = await loginWithEmail({
        identifier: step.identifier,
        password: values.password,
        ...turnstileField,
      });
      await handleSuccess(session);
    } catch (err) {
      setError(getApiErrorMessage(err));
    }
  });

  // ── shared back handler ───────────────────────────────────────────────────
  const goBack = () => {
    setStep({ kind: "identifier" });
    setError(null);
    setInfo(null);
    otpForm.reset();
    passwordForm.reset();
  };

  // ─────────────────────────────────────────────────────────────────────────

  const inputCls =
    "h-12 w-full rounded-full border border-border bg-muted px-4 text-sm font-medium text-primary placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary";
  const primaryBtnCls =
    "mt-2 h-12 w-full rounded-full bg-primary px-8 text-sm font-bold text-white transition-transform hover:-translate-y-1 hover:bg-accent hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0";

  return (
    <div className="flex flex-col gap-6 p-5 sm:gap-8 sm:p-8 lg:p-12">
      {justReset && (
        <p className="rounded-2xl border border-border bg-secondary px-4 py-3 text-sm font-medium text-primary">
          Password reset successful. Please sign in with your new password.
        </p>
      )}

      <div className="text-center">
        <h1 className="font-heading text-2xl font-bold text-primary sm:text-3xl">
          Welcome Back
        </h1>
        <p className="mt-2 text-sm font-medium text-muted-foreground">
          Sign in to your {APP_NAME} account.
        </p>
      </div>

      {/* ── Step 1: identifier ─────────────────────────────────────────────── */}
      {step.kind === "identifier" && (
        <form onSubmit={handleContinue} className="grid gap-5">
          <div className="grid gap-1.5">
            <label htmlFor="identifier" className="text-sm font-bold text-primary">
              Mobile or Email
            </label>
            <input
              id="identifier"
              type="text"
              autoComplete="username"
              autoFocus
              placeholder="9876543210 or name@email.com"
              className={inputCls}
              {...identifierForm.register("identifier")}
            />
            {identifierForm.formState.errors.identifier && (
              <p className="text-xs font-bold text-red-500">
                {identifierForm.formState.errors.identifier.message}
              </p>
            )}
          </div>

          <TurnstileChallenge
            key={widgetKey}
            onTokenChange={onTurnstileTokenChange}
            onLoadError={setTurnstileLoadError}
          />
          {turnstileLoadError && (
            <p className="text-xs font-bold text-red-500" role="alert">{turnstileLoadError}</p>
          )}

          <AuthErrorBanner message={error} />

          <button
            type="submit"
            className={primaryBtnCls}
            disabled={checking || identifierForm.formState.isSubmitting || (turnstileRequired && !turnstileReady)}
          >
            {checking ? "Checking…" : "Continue"}
          </button>
        </form>
      )}

      {/* ── Step 2a: OTP ───────────────────────────────────────────────────── */}
      {step.kind === "otp" && (
        <form onSubmit={handleVerifyOtp} className="grid gap-5">
          {/* Summary row */}
          <div className="flex items-center justify-between rounded-2xl border border-border bg-secondary px-4 py-3">
            <div>
              <p className="text-xs font-medium text-muted-foreground">OTP sent to</p>
              <p className="text-sm font-bold text-primary">{step.phone}</p>
            </div>
            <button type="button" onClick={goBack} className="ml-3 shrink-0 text-xs font-bold text-accent hover:text-primary">
              Change
            </button>
          </div>

          {info && (
            <p className="text-xs font-bold text-success">{info}</p>
          )}

          <div className="grid gap-1.5">
            <label htmlFor="otp" className="text-sm font-bold text-primary">
              Enter OTP
            </label>
            <input
              id="otp"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              autoFocus
              className="h-12 w-full rounded-full border border-border bg-muted px-4 text-center text-lg font-bold tracking-[0.5em] text-primary focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              {...otpForm.register("otp")}
            />
            {otpForm.formState.errors.otp && (
              <p className="text-xs font-bold text-red-500">{otpForm.formState.errors.otp.message}</p>
            )}
          </div>

          <AuthErrorBanner message={error} />

          {/* Resend row */}
          <div className="flex items-center gap-2">
            {turnstileRequired && (
              <TurnstileChallenge
                key={widgetKey}
                onTokenChange={onTurnstileTokenChange}
                onLoadError={setTurnstileLoadError}
              />
            )}
            <button
              type="button"
              onClick={() => void handleResend()}
              disabled={resendCooldown > 0 || resending || (turnstileRequired && !turnstileReady)}
              className="flex items-center gap-1.5 text-xs font-bold text-accent transition-colors hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RefreshCw className="size-3" aria-hidden />
              {resending ? "Resending…" : resendCooldown > 0 ? `Resend in ${resendCooldown}s` : "Resend OTP"}
            </button>
          </div>

          <button
            type="submit"
            className={primaryBtnCls}
            disabled={otpForm.formState.isSubmitting}
          >
            {otpForm.formState.isSubmitting ? "Verifying…" : "Verify OTP"}
          </button>
        </form>
      )}

      {/* ── Step 2b: password ──────────────────────────────────────────────── */}
      {step.kind === "password" && (
        <form onSubmit={handlePasswordLogin} className="grid gap-5">
          {/* Summary row */}
          <div className="flex items-center justify-between rounded-2xl border border-border bg-secondary px-4 py-3">
            <div>
              <p className="text-xs font-medium text-muted-foreground">Signing in as</p>
              <p className="text-sm font-bold text-primary break-all">{step.identifier}</p>
            </div>
            <button type="button" onClick={goBack} className="ml-3 shrink-0 text-xs font-bold text-accent hover:text-primary">
              Change
            </button>
          </div>

          <div className="grid gap-1.5">
            <label htmlFor="password" className="text-sm font-bold text-primary">
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              autoFocus
              className={inputCls}
              {...passwordForm.register("password")}
            />
            {passwordForm.formState.errors.password && (
              <p className="text-xs font-bold text-red-500">{passwordForm.formState.errors.password.message}</p>
            )}
          </div>

          <TurnstileChallenge
            onTokenChange={onTurnstileTokenChange}
            onLoadError={setTurnstileLoadError}
          />
          {turnstileLoadError && (
            <p className="text-xs font-bold text-red-500" role="alert">{turnstileLoadError}</p>
          )}

          <AuthErrorBanner message={error} />

          <button
            type="submit"
            className={primaryBtnCls}
            disabled={passwordForm.formState.isSubmitting || (turnstileRequired && !turnstileReady)}
          >
            {passwordForm.formState.isSubmitting ? "Signing in…" : "Sign in"}
          </button>
        </form>
      )}

      {/* ── footer links ───────────────────────────────────────────────────── */}
      <div className="grid gap-4 text-center">
        <Link
          href={`/register${redirectTo !== "/dashboard" ? `?redirect=${encodeURIComponent(redirectTo)}` : ""}`}
          className="text-sm font-bold text-accent transition-colors hover:text-primary"
        >
          New customer? Create an account
        </Link>
        {(step.kind === "identifier" || step.kind === "password") && (
          <Link
            href="/forgot-password"
            className="text-sm font-bold text-muted-foreground transition-colors hover:text-primary"
          >
            Forgot password?
          </Link>
        )}
      </div>

      <div className="border-t border-border pt-6">
        <Link
          href="/"
          className="block text-center text-sm font-bold text-primary transition-colors hover:text-accent"
        >
          &larr; Back to store
        </Link>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex flex-col gap-6 p-5 sm:gap-8 sm:p-8 lg:p-12">
          <p className="text-center text-sm text-muted-foreground">Loading…</p>
        </div>
      }
    >
      <LoginPageContent />
    </Suspense>
  );
}
