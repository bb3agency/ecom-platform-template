"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { CircleCheck } from "lucide-react";
import { OpsField, formatClock, useSecondsUntil } from "@/components/ops/ui/ops-ui";
import { Notice } from "@/components/ui/console";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { isCompleteOtpCode, normalizeOtpCodeInput } from "@/lib/otp-code";
import { consumeOpsInvite, getOpsSetupErrorMessage, sendOpsSetupOtp } from "@/lib/ops-setup-api";

interface OpsSetupFormProps {
  token: string;
}

/** Two steps on one card: confirm your details → enter the emailed code. */
export function OpsSetupForm({ token }: OpsSetupFormProps) {
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const secondsLeft = useSecondsUntil(expiresAt);
  const otpSent = expiresAt !== null;
  const nameError = nameTouched && !name.trim() ? "Enter your full name." : null;

  async function onSendOtp(event?: FormEvent) {
    event?.preventDefault();
    setNameTouched(true);
    if (!name.trim()) return;
    setError(null);
    setIsSubmitting(true);
    try {
      const response = await sendOpsSetupOtp({
        token,
        name: name.trim(),
        ...(phone.trim() ? { phone: phone.trim() } : {}),
      });
      setExpiresAt(response.expiresAt);
    } catch (err) {
      setError(getOpsSetupErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function onCompleteSetup(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await consumeOpsInvite({ token, otp: normalizeOtpCodeInput(otp) });
      setCompleted(true);
    } catch (err) {
      setError(getOpsSetupErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  if (completed) {
    return (
      <div className="flex flex-col items-start gap-4" role="status">
        <CircleCheck className="size-6 text-success" aria-hidden />
        <div className="flex flex-col gap-1">
          <p className="text-base font-semibold text-foreground">Your ops account is ready</p>
          <p className="text-sm text-muted-foreground">Sign in with your email. We&apos;ll send a code each time.</p>
        </div>
        <Link href="/ops/login" className={cn(buttonVariants(), "h-10 w-full")}>
          Go to sign in
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={otpSent ? onCompleteSetup : onSendOtp} className="flex min-w-0 flex-col gap-4" noValidate>
      <fieldset disabled={otpSent} className="flex min-w-0 flex-col gap-4">
        <OpsField label="Full name" htmlFor="setup-name" error={nameError}>
          <Input
            id="setup-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onBlur={() => setNameTouched(true)}
            autoComplete="name"
            autoFocus
            aria-invalid={nameError ? true : undefined}
            className="h-10"
          />
        </OpsField>
        <OpsField label="Phone" htmlFor="setup-phone" optional hint="Kept on your account for the audit trail.">
          <Input
            id="setup-phone"
            type="tel"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            autoComplete="tel"
            className="h-10"
          />
        </OpsField>
      </fieldset>

      {otpSent ? (
        <OpsField
          label="Verification code"
          htmlFor="setup-otp"
          hint={
            secondsLeft === 0 ? (
              <span className="text-destructive">The invite link has expired. Ask for a new invite.</span>
            ) : (
              <>
                We emailed a code to your invite address. Invite expires in{" "}
                <span className="tabular font-medium text-foreground">{formatClock(secondsLeft ?? 0)}</span>.
              </>
            )
          }
        >
          <Input
            id="setup-otp"
            value={otp}
            onChange={(event) => setOtp(normalizeOtpCodeInput(event.target.value))}
            maxLength={6}
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            placeholder="000000"
            className="h-11 text-center font-mono text-lg tracking-widest tabular"
          />
        </OpsField>
      ) : null}

      {error ? <Notice tone="danger">{error}</Notice> : null}

      {otpSent ? (
        <Button type="submit" className="h-10 w-full" loading={isSubmitting} disabled={!isCompleteOtpCode(otp)}>
          Activate account
        </Button>
      ) : (
        <Button type="submit" className="h-10 w-full" loading={isSubmitting}>
          Email me a code
        </Button>
      )}
    </form>
  );
}
