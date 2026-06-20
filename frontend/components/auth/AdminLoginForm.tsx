"use client";

import { useEffect, useState, useCallback } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import {
  getAdminOtpChannelConfig,
  requestAdminLoginOtp,
  verifyAdminLoginOtp,
} from "@/lib/admin-auth-api";
import {
  getAdminLoginErrorMessage,
  getApiErrorMessageWithHint,
  isApiErrorWithCode,
} from "@/lib/error-messages";
import { isCompleteOtpCode, normalizeOtpCodeInput } from "@/lib/otp-code";
import { emailSchema, otpSchema, passwordSchema } from "@/lib/validators";
import { AuthErrorBanner } from "@/components/auth/AuthErrorBanner";
import { TurnstileChallenge } from "@/components/auth/TurnstileChallenge";
import { useAuthTurnstile } from "@/hooks/use-auth-turnstile";
import { Eye, EyeOff, Loader2, Send } from "lucide-react";
import { isTurnstileConfigured } from "@/lib/turnstile-config";
import type { AuthSession } from "@/types/user";
import { getAuthDevOtpHint, isAuthDevBypassUiEnabled } from "@/lib/dev-auth";

const credentialsSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
});

const verifySchema = z.object({
  email: emailSchema,
  otp: otpSchema,
});

type CredentialsValues = z.infer<typeof credentialsSchema>;

interface AdminLoginFormProps {
  onSuccess: (session: AuthSession) => Promise<void> | void;
  enrollmentHint?: boolean;
}

const RESEND_COOLDOWN_SEC = 60;

function TurnstileField({
  widgetKey,
  onTokenChange,
  loadError,
  onLoadError,
}: {
  widgetKey: string;
  onTokenChange: (token: string | null) => void;
  onLoadError: (message: string) => void;
  loadError: string | null;
}) {
  if (!isTurnstileConfigured()) {
    return null;
  }
  return (
    <>
      <TurnstileChallenge
        key={widgetKey}
        onTokenChange={onTokenChange}
        onLoadError={onLoadError}
      />
      {loadError ? (
        <p className="text-xs text-destructive" role="alert">
          {loadError}
        </p>
      ) : null}
    </>
  );
}

export function AdminLoginForm({ onSuccess, enrollmentHint }: AdminLoginFormProps) {
  const [step, setStep] = useState<"credentials" | "otp">("credentials");
  const [error, setError] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [otpChannel, setOtpChannel] = useState<"sms" | "whatsapp" | "email">("email");
  const [showPassword, setShowPassword] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [otpRemainingSec, setOtpRemainingSec] = useState(0);
  /** Bump to remount Turnstile (tokens are single-use; widget unmount clears state). */
  const [turnstileWidgetKey, setTurnstileWidgetKey] = useState(0);
  const credentialsForm = useForm<CredentialsValues>({
    resolver: zodResolver(credentialsSchema),
    defaultValues: { email: "", password: "" },
  });
  const [otp, setOtp] = useState("");
  const [devOtpHint, setDevOtpHint] = useState<string | null>(null);
  const {
    required: turnstileRequired,
    ready: turnstileReady,
    turnstileField,
    onTurnstileTokenChange,
    turnstileLoadError,
    setTurnstileLoadError,
  } = useAuthTurnstile();

  const applyDevOtpHint = useCallback((apiDevOtp?: string) => {
    if (apiDevOtp) {
      setDevOtpHint(apiDevOtp);
      setOtp(apiDevOtp);
      return;
    }
    if (isAuthDevBypassUiEnabled()) {
      const hint = getAuthDevOtpHint();
      setDevOtpHint(hint);
      setOtp((current) => current || hint);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void getAdminOtpChannelConfig()
      .then((response) => {
        if (!cancelled) {
          setOtpChannel(response.channel);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setOtpChannel("email");
        }
      })
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (step === "otp") {
      applyDevOtpHint();
    }
  }, [step, applyDevOtpHint]);

  useEffect(() => {
    if (turnstileRequired) {
      setTurnstileWidgetKey((k) => k + 1);
    }
  }, [step, turnstileRequired]);

  const bumpTurnstileWidget = useCallback(() => {
    setTurnstileWidgetKey((k) => k + 1);
  }, []);

  const startResendCooldown = useCallback(() => {
    setResendCooldown(RESEND_COOLDOWN_SEC);
    const interval = window.setInterval(() => {
      setResendCooldown((prev) => {
        if (prev <= 1) {
          window.clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  const startOtpCountdown = useCallback((expiryIso: string) => {
    const expiryMs = new Date(expiryIso).getTime();
    const nowMs = Date.now();
    const remaining = Math.max(0, Math.ceil((expiryMs - nowMs) / 1000));
    setOtpRemainingSec(remaining);

    const interval = window.setInterval(() => {
      setOtpRemainingSec((prev) => {
        if (prev <= 1) {
          window.clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  const handleRequestOtp = credentialsForm.handleSubmit(async (values) => {
    if (turnstileRequired && !turnstileReady) {
      setError(
        isTurnstileConfigured()
          ? "Complete the security check below, then try again."
          : "Security check is required by the API. Configure NEXT_PUBLIC_TURNSTILE_SITE_KEY or disable TURNSTILE_SECRET_KEY on the backend for local dev.",
      );
      return;
    }
    try {
      setError(null);
      const response = await requestAdminLoginOtp({ ...values, ...turnstileField });
      setExpiresAt(response.expiresAt);
      applyDevOtpHint(response.devOtp);
      setStep("otp");
      startResendCooldown();
      startOtpCountdown(response.expiresAt);
    } catch (err) {
      if (isApiErrorWithCode(err, "UNAUTHORISED")) {
        setStep("credentials");
        setOtp("");
        setError(
          "This admin account is deactivated. Ask Ops to send a merchant admin invite for this email (Invites → merchant admin section) to restore access."
        );
      } else if (isApiErrorWithCode(err, "INVALID_CREDENTIALS")) {
        setStep("credentials");
        setOtp("");
        setError(getAdminLoginErrorMessage(err));
      } else {
        setError(getApiErrorMessageWithHint(err) || getAdminLoginErrorMessage(err));
      }
    }
  });

  async function handleResendOtp() {
    if (resendCooldown > 0) return;
    if (turnstileRequired && !turnstileReady) {
      setError("Complete the security check below before resending the code.");
      return;
    }
    const email = credentialsForm.getValues("email");
    const password = credentialsForm.getValues("password");
    try {
      setError(null);
      const response = await requestAdminLoginOtp({ email, password, ...turnstileField });
      setExpiresAt(response.expiresAt);
      applyDevOtpHint(response.devOtp);
      bumpTurnstileWidget();
      startResendCooldown();
      startOtpCountdown(response.expiresAt);
    } catch (err) {
      if (isApiErrorWithCode(err, "UNAUTHORISED")) {
        setStep("credentials");
        setOtp("");
        setError(
          "This admin account is deactivated. Ask Ops to send a merchant admin invite for this email (Invites → merchant admin section) to restore access."
        );
      } else if (isApiErrorWithCode(err, "INVALID_CREDENTIALS")) {
        setStep("credentials");
        setOtp("");
        setError(getAdminLoginErrorMessage(err));
      } else {
        setError(getApiErrorMessageWithHint(err) || getAdminLoginErrorMessage(err));
      }
    }
  }

  async function handleVerifyOtp(event: React.FormEvent) {
    event.preventDefault();
    const email = credentialsForm.getValues("email");
    const parsed = verifySchema.safeParse({ email, otp });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid OTP.");
      return;
    }

    try {
      setError(null);
      const session = await verifyAdminLoginOtp(parsed.data);
      await onSuccess(session);
    } catch (err) {
      if (isApiErrorWithCode(err, "UNAUTHORISED")) {
        setStep("credentials");
        setOtp("");
        setError(
          "This account has been deactivated. Contact your administrator if you believe this is an error."
        );
      } else {
        setError(getAdminLoginErrorMessage(err));
      }
    }
  }

  return (
    <div className="grid gap-4">
      {enrollmentHint ? (
        <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          After invite setup, sign in with your admin email. A one-time code will be sent to your
          email.
        </p>
      ) : null}

      {step === "credentials" ? (
        <form onSubmit={handleRequestOtp} className="grid gap-4">
          <div className="grid gap-1">
            <label htmlFor="admin-email" className="text-sm font-medium">
              Admin email
            </label>
            <input
              id="admin-email"
              type="email"
              autoComplete="username"
              className="h-11 rounded-md border border-border bg-background px-3 text-sm"
              aria-invalid={Boolean(credentialsForm.formState.errors.email)}
              {...credentialsForm.register("email")}
            />
            {credentialsForm.formState.errors.email ? (
              <p className="text-xs text-destructive">
                {credentialsForm.formState.errors.email.message}
              </p>
            ) : null}
          </div>
          <div className="grid gap-1">
            <label htmlFor="admin-password" className="text-sm font-medium">
              Password
            </label>
            <div className="relative">
              <input
                id="admin-password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                className="h-11 w-full rounded-md border border-border bg-background px-3 pr-10 text-sm"
                aria-invalid={Boolean(credentialsForm.formState.errors.password)}
                {...credentialsForm.register("password")}
              />
              <button
                type="button"
                tabIndex={-1}
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
            {credentialsForm.formState.errors.password ? (
              <p className="text-xs text-destructive">
                {credentialsForm.formState.errors.password.message}
              </p>
            ) : null}
          </div>
          <TurnstileField
            widgetKey={`admin-login-creds-${turnstileWidgetKey}`}
            onTokenChange={onTurnstileTokenChange}
            onLoadError={setTurnstileLoadError}
            loadError={turnstileLoadError}
          />
          <button
            type="submit"
            className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-60"
            disabled={credentialsForm.formState.isSubmitting}
          >
            {credentialsForm.formState.isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Sending code…
              </>
            ) : (
              <>
                <Send className="h-4 w-4" />
                Send login code
              </>
            )}
          </button>
        </form>
      ) : (
        <form onSubmit={handleVerifyOtp} className="grid gap-4">
          {devOtpHint ? (
            <p
              className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
              role="status"
            >
              Development mode: use OTP{" "}
              <span className="font-mono font-semibold">{devOtpHint}</span> (no email/SMS
              sent). Ensure the API is running with{" "}
              <code className="text-xs">AUTH_DEV_BYPASS=true</code> and restart it after
              changing <code className="text-xs">backend/.env</code>.
            </p>
          ) : null}
          <p className="text-sm text-muted-foreground">
            Enter the 6-digit code sent via{" "}
            {otpChannel === "sms" ? "SMS" : otpChannel === "whatsapp" ? "WhatsApp" : "email"} to{" "}
            {otpChannel === "email" ? credentialsForm.getValues("email") : "your registered phone"}.
            {otpRemainingSec > 0 ? (
              <span className="ml-1 text-amber-600">
                Expires in {Math.floor(otpRemainingSec / 60)}:
                {(otpRemainingSec % 60).toString().padStart(2, "0")}
              </span>
            ) : expiresAt ? (
              <span className="ml-1 text-red-600">Expired</span>
            ) : null}
          </p>
          <label className="grid gap-1 text-sm" htmlFor="admin-otp">
            Login code
            <input
              id="admin-otp"
              value={otp}
              onChange={(event) => setOtp(normalizeOtpCodeInput(event.target.value))}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="000000"
              className="h-11 rounded-md border border-border bg-background px-3 text-center text-sm tracking-[0.3em]"
            />
          </label>
          <TurnstileField
            widgetKey={`admin-login-otp-${turnstileWidgetKey}`}
            onTokenChange={onTurnstileTokenChange}
            onLoadError={setTurnstileLoadError}
            loadError={turnstileLoadError}
          />
          <div className="flex items-center justify-between">
            <button
              type="button"
              className="text-sm text-muted-foreground underline-offset-4 hover:underline"
              onClick={() => setStep("credentials")}
            >
              Use different email
            </button>
            <button
              type="button"
              disabled={resendCooldown > 0 || (turnstileRequired && !turnstileReady)}
              onClick={() => void handleResendOtp()}
              className="text-sm text-primary underline-offset-4 hover:underline disabled:text-muted-foreground disabled:no-underline"
            >
              {resendCooldown > 0
                ? `Resend in ${resendCooldown}s`
                : turnstileRequired && !turnstileReady
                  ? "Complete security check to resend"
                  : "Resend code"}
            </button>
          </div>
          <button
            type="submit"
            className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-60"
            disabled={!isCompleteOtpCode(otp)}
          >
            Verify and sign in
          </button>
        </form>
      )}

      <AuthErrorBanner message={error} />
    </div>
  );
}
