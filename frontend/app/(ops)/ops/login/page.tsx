"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { OpsPublicLayout } from "@/components/ops/OpsPublicLayout";
import { OpsField, formatClock, useSecondsUntil } from "@/components/ops/ui/ops-ui";
import { TurnstileChallenge } from "@/components/auth/TurnstileChallenge";
import { Notice } from "@/components/ui/console";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TURNSTILE_MISCONFIGURED_MESSAGE, useAuthTurnstile } from "@/hooks/use-auth-turnstile";
import { getApiErrorMessage, getOpsLoginErrorMessage } from "@/lib/error-messages";
import { isCompleteOtpCode, normalizeOtpCodeInput } from "@/lib/otp-code";
import { requestOpsLoginOtp, verifyOpsLoginOtp } from "@/lib/ops-client-api";
import { emailSchema, otpSchema } from "@/lib/validators";
import { isAuthDevBypassUiEnabled, getAuthDevOtpHint } from "@/lib/dev-auth";

const emailStepSchema = z.object({
  email: emailSchema,
});

export default function OpsLoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<"email" | "otp">("email");
  const [error, setError] = useState<string | null>(null);
  const [otp, setOtp] = useState("");
  const [devOtpHint, setDevOtpHint] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const secondsLeft = useSecondsUntil(expiresAt);
  const expired = expiresAt !== null && secondsLeft === 0;
  const {
    required: turnstileRequired,
    ready: turnstileReady,
    misconfigured: turnstileMisconfigured,
    siteKey: turnstileSiteKey,
    turnstileField,
    onTurnstileTokenChange,
    turnstileLoadError,
    setTurnstileLoadError,
  } = useAuthTurnstile();
  const form = useForm<z.infer<typeof emailStepSchema>>({
    resolver: zodResolver(emailStepSchema),
    defaultValues: { email: "" },
    mode: "onTouched",
  });
  const emailError = form.formState.errors.email?.message;

  function applyDevOtpHint(apiDevOtp?: string) {
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
  }

  const handleRequestOtp = form.handleSubmit(async (values) => {
    if (turnstileMisconfigured) {
      setError(TURNSTILE_MISCONFIGURED_MESSAGE);
      return;
    }
    if (turnstileRequired && !turnstileReady) {
      setError("Complete the security check, then try again.");
      return;
    }
    try {
      setError(null);
      const response = await requestOpsLoginOtp({ ...values, ...turnstileField });
      setExpiresAt(response.expiresAt);
      applyDevOtpHint(response.devOtp);
      setStep("otp");
    } catch (err) {
      setError(getApiErrorMessage(err));
    }
  });

  async function handleVerify(event: React.FormEvent) {
    event.preventDefault();
    const email = form.getValues("email");
    const normalizedOtp = normalizeOtpCodeInput(otp);
    const parsed = z.object({ email: emailSchema, otp: otpSchema }).safeParse({ email, otp: normalizedOtp });
    if (!parsed.success) {
      setError("Enter the 6-digit code from the email.");
      return;
    }
    setVerifying(true);
    try {
      setError(null);
      await verifyOpsLoginOtp(parsed.data);
      router.replace("/ops");
    } catch (err) {
      setError(getOpsLoginErrorMessage(err));
      setVerifying(false);
    }
  }

  function backToEmail() {
    setStep("email");
    setOtp("");
    setExpiresAt(null);
    setDevOtpHint(null);
    setError(null);
  }

  return (
    <OpsPublicLayout
      title={step === "email" ? "Sign in to ops" : "Check your email"}
      description={
        step === "email" ? (
          "For platform operators. We'll email you a one-time code."
        ) : (
          <>
            We sent a 6-digit code to <span className="break-all font-medium text-foreground">{form.getValues("email")}</span>.
          </>
        )
      }
    >
      {step === "email" ? (
        <form onSubmit={handleRequestOtp} className="flex min-w-0 flex-col gap-4" noValidate>
          <OpsField label="Work email" htmlFor="ops-login-email" error={emailError}>
            <Input
              id="ops-login-email"
              type="email"
              autoComplete="email"
              inputMode="email"
              autoFocus
              placeholder="you@company.com"
              aria-invalid={emailError ? true : undefined}
              aria-describedby={emailError ? "ops-login-email-error" : undefined}
              className="h-10"
              {...form.register("email")}
            />
          </OpsField>
          <TurnstileChallenge
            siteKey={turnstileSiteKey}
            onTokenChange={onTurnstileTokenChange}
            onLoadError={setTurnstileLoadError}
          />
          {turnstileMisconfigured ? <Notice tone="danger">{TURNSTILE_MISCONFIGURED_MESSAGE}</Notice> : null}
          {turnstileLoadError ? <Notice tone="danger">{turnstileLoadError}</Notice> : null}
          {error ? <Notice tone="danger">{error}</Notice> : null}
          <Button
            type="submit"
            className="h-10 w-full"
            loading={form.formState.isSubmitting}
            disabled={turnstileRequired && !turnstileReady}
          >
            {form.formState.isSubmitting ? "Sending code…" : "Email me a code"}
          </Button>
        </form>
      ) : (
        <form onSubmit={handleVerify} className="flex min-w-0 flex-col gap-4" noValidate>
          {devOtpHint ? (
            <Notice tone="info" title="Development sign-in">
              Code filled in automatically: <span className="font-mono font-medium text-foreground">{devOtpHint}</span>
            </Notice>
          ) : null}
          <OpsField
            label="Verification code"
            htmlFor="ops-login-otp"
            hint={
              expired ? (
                <span className="text-destructive">This code has expired. Request a new one.</span>
              ) : (
                <>
                  Expires in <span className="tabular font-medium text-foreground">{formatClock(secondsLeft ?? 0)}</span>
                </>
              )
            }
          >
            <Input
              id="ops-login-otp"
              value={otp}
              onChange={(event) => setOtp(normalizeOtpCodeInput(event.target.value))}
              inputMode="numeric"
              maxLength={6}
              autoComplete="one-time-code"
              autoFocus
              placeholder="000000"
              aria-invalid={error ? true : undefined}
              className="h-11 text-center font-mono text-lg tracking-widest tabular"
            />
          </OpsField>
          {error ? <Notice tone="danger">{error}</Notice> : null}
          <Button type="submit" className="h-10 w-full" loading={verifying} disabled={expired || !isCompleteOtpCode(otp)}>
            Sign in
          </Button>
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <Button type="button" variant="link" className="h-auto px-0" onClick={backToEmail}>
              Use a different email
            </Button>
            <Button
              type="button"
              variant="link"
              className="h-auto px-0"
              onClick={() => void handleRequestOtp()}
              disabled={form.formState.isSubmitting}
            >
              Send a new code
            </Button>
          </div>
        </form>
      )}
    </OpsPublicLayout>
  );
}
