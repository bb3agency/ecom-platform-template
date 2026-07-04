"use client";

import { useEffect, useState } from "react";
import { KeyRound } from "lucide-react";
import {
  OpsAlert,
  OpsCard,
  OpsCardHeader,
  OpsField,
  OpsInput,
} from "@/components/ops/ui/ops-ui";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import {
  getApiErrorMessageWithHint,
  getOpsErrorDetail,
  isOpsOtpChallengeConsumed,
} from "@/lib/error-messages";
import { isCompleteOtpCode, normalizeOtpCodeInput } from "@/lib/otp-code";
import {
  requestOpsOtpChallenge,
  type OpsOtpActionType,
} from "@/lib/ops-client-api";

interface OpsCriticalOtpFormProps {
  actionType: OpsOtpActionType;
  title: string;
  description: string;
  buttonLabel: string;
  onExecute: (payload: { challengeId: string; otpCode: string }) => Promise<void>;
  children?: React.ReactNode;
  variant?: "default" | "danger";
}

export function OpsCriticalOtpForm({
  actionType,
  title,
  description,
  buttonLabel,
  onExecute,
  children,
  variant = "default",
}: OpsCriticalOtpFormProps) {
  const [challengeId, setChallengeId] = useState("");
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [otpCode, setOtpCode] = useState("");
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!expiresAt) {
      return;
    }
    const tick = () => {
      const remaining = Math.max(
        0,
        Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000),
      );
      setSecondsLeft(remaining);
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [expiresAt]);

  async function handleRequestOtp() {
    setError(null);
    setErrorDetail(null);
    setMessage(null);
    setIsLoading(true);
    try {
      const challenge = await requestOpsOtpChallenge(actionType);
      setChallengeId(challenge.challengeId);
      setExpiresAt(challenge.expiresAt);
      setMessage("A 6-digit code was sent to your ops email.");
    } catch (err) {
      setError(getApiErrorMessageWithHint(err));
      setErrorDetail(getOpsErrorDetail(err));
    } finally {
      setIsLoading(false);
    }
  }

  async function executeAction() {
    if (!challengeId || !isCompleteOtpCode(otpCode)) {
      setError("Request an OTP and enter the 6-digit code.");
      setErrorDetail(null);
      return;
    }
    if (secondsLeft <= 0) {
      setError("OTP expired. Request a new code.");
      setErrorDetail(null);
      return;
    }

    setError(null);
    setErrorDetail(null);
    setMessage(null);
    setIsLoading(true);
    try {
      await onExecute({ challengeId, otpCode: normalizeOtpCodeInput(otpCode) });
      setMessage("Action completed successfully.");
      setOtpCode("");
      setChallengeId("");
      setExpiresAt(null);
    } catch (err) {
      if (err instanceof ApiError && err.code === "ops_audit_chain_lock_timeout") {
        setError(getApiErrorMessageWithHint(err));
        setErrorDetail(getOpsErrorDetail(err));
        window.setTimeout(() => {
          void executeAction();
        }, 1500);
        return;
      }
      if (err instanceof ApiError && err.code === "INVALID_CREDENTIALS" && isOpsOtpChallengeConsumed(err)) {
        setError(getApiErrorMessageWithHint(err));
        setErrorDetail(getOpsErrorDetail(err));
        setChallengeId("");
        setOtpCode("");
        setExpiresAt(null);
        return;
      }
      if (err instanceof ApiError && err.status === 409 && err.code === "CONFLICT") {
        setError(
          "This OTP is no longer valid for this action. Click \"Send OTP to email\" to request a fresh code, then retry.",
        );
        setErrorDetail(getOpsErrorDetail(err));
        setChallengeId("");
        setOtpCode("");
        setExpiresAt(null);
        return;
      }
      setError(getApiErrorMessageWithHint(err));
      setErrorDetail(getOpsErrorDetail(err));
      // If the OTP challenge is no longer usable (already verified by a prior
      // attempt, expired, or concurrently consumed), clear the OTP/challenge
      // state so the user MUST request a fresh code. Without this, the user
      // would re-click the same button and hit the same 409 forever.
      if (isOpsOtpChallengeConsumed(err)) {
        setChallengeId("");
        setOtpCode("");
        setExpiresAt(null);
      }
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    await executeAction();
  }

  return (
    <OpsCard
      className={
        variant === "danger" ? "border-destructive/30 bg-destructive/5" : undefined
      }
    >
      <OpsCardHeader
        title={title}
        description={description}
        actions={
          <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <KeyRound className="size-5" aria-hidden />
          </div>
        }
      />
      <form onSubmit={handleSubmit} className="grid min-w-0 grid-cols-1 gap-5">
        {children}
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => void handleRequestOtp()} disabled={isLoading}>
            {isLoading ? "Sending…" : "Send OTP to email"}
          </Button>
          {challengeId && secondsLeft > 0 ? (
            <span className="self-center text-xs text-muted-foreground" role="status">
              Expires in {secondsLeft}s
            </span>
          ) : null}
          {challengeId && secondsLeft <= 0 ? (
            <span className="self-center text-xs text-destructive">OTP expired</span>
          ) : null}
        </div>
        <OpsField label="Verification code" htmlFor="ops-otp-code">
          <OpsInput
            id="ops-otp-code"
            value={otpCode}
            onChange={(event) => setOtpCode(normalizeOtpCodeInput(event.target.value))}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="000000"
            className="tracking-[0.3em]"
          />
        </OpsField>
        <Button
          type="submit"
          variant={variant === "danger" ? "destructive" : "default"}
          disabled={isLoading || secondsLeft <= 0 || !challengeId}
          className="w-fit"
        >
          {isLoading ? "Working…" : buttonLabel}
        </Button>
        {message ? <OpsAlert tone="success">{message}</OpsAlert> : null}
        {error ? (
          <OpsAlert tone="error">
            <div className="grid min-w-0 grid-cols-1 gap-1">
              <span>{error}</span>
              {errorDetail ? (
                <span className="font-mono text-xs text-destructive/80">{errorDetail}</span>
              ) : null}
            </div>
          </OpsAlert>
        ) : null}
      </form>
    </OpsCard>
  );
}
