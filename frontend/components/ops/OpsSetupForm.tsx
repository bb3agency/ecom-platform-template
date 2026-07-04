"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import {
  OpsAlert,
  OpsCard,
  OpsCardHeader,
  OpsField,
  OpsInput,
} from "@/components/ops/ui/ops-ui";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatOpsDateTime } from "@/lib/ops-format";
import { isCompleteOtpCode, normalizeOtpCodeInput } from "@/lib/otp-code";
import {
  consumeOpsInvite,
  getOpsSetupErrorMessage,
  sendOpsSetupOtp,
} from "@/lib/ops-setup-api";

interface OpsSetupFormProps {
  token: string;
}

export function OpsSetupForm({ token }: OpsSetupFormProps) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function onSendOtp() {
    setError(null);
    setIsSubmitting(true);
    try {
      const response = await sendOpsSetupOtp({
        token,
        name,
        ...(phone.trim() ? { phone: phone.trim() } : {}),
      });
      setOtpSent(true);
      setExpiresAt(response.expiresAt);
    } catch (err) {
      setError(getOpsSetupErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function onCompleteSetup() {
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
      <OpsCard className="border-emerald-500/30 bg-emerald-500/5">
        <div className="flex flex-col items-center gap-4 py-4 text-center">
          <CheckCircle2 className="size-12 text-emerald-500" aria-hidden />
          <OpsCardHeader
            title="Setup complete"
            description="Sign in with your email and the OTP sent to your inbox."
          />
          <Link href="/ops/login" className={cn(buttonVariants(), "h-11 px-6")}>
            Continue to ops login
          </Link>
        </div>
      </OpsCard>
    );
  }

  return (
    <OpsCard>
      <OpsCardHeader
        title="Operator onboarding"
        description="Step 1: confirm your profile and request an email OTP. Step 2: verify and activate your account."
      />
      <div className="grid min-w-0 grid-cols-1 gap-5">
        <OpsField label="Full name" htmlFor="setup-name">
          <OpsInput
            id="setup-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            autoComplete="name"
          />
        </OpsField>
        <OpsField label="Phone (optional)" htmlFor="setup-phone" hint="Used for audit trail only">
          <OpsInput
            id="setup-phone"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            autoComplete="tel"
          />
        </OpsField>
        {!otpSent ? (
          <Button
            type="button"
            className="h-11 w-full"
            onClick={() => void onSendOtp()}
            disabled={isSubmitting || !name.trim()}
          >
            {isSubmitting ? "Sending…" : "Send OTP to invite email"}
          </Button>
        ) : (
          <>
            {expiresAt ? (
              <OpsAlert tone="info">OTP expires at {formatOpsDateTime(expiresAt)}</OpsAlert>
            ) : null}
            <OpsField label="6-digit code" htmlFor="setup-otp">
              <OpsInput
                id="setup-otp"
                value={otp}
                onChange={(event) => setOtp(normalizeOtpCodeInput(event.target.value))}
                minLength={6}
                maxLength={6}
                inputMode="numeric"
                required
                className="tracking-[0.3em]"
              />
            </OpsField>
            <Button
              type="button"
              className="h-11 w-full"
              onClick={() => void onCompleteSetup()}
              disabled={isSubmitting || !isCompleteOtpCode(otp)}
            >
              {isSubmitting ? "Activating…" : "Complete setup"}
            </Button>
          </>
        )}
        {error ? <OpsAlert tone="error">{error}</OpsAlert> : null}
      </div>
    </OpsCard>
  );
}
