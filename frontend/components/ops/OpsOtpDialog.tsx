"use client";

/**
 * Confirmation dialog for the OTP-protected ops actions (config save, traffic
 * mode, restart, deactivations, invite revoke).
 *
 * Flow: optional details (e.g. a reason) → "Email me a code" → enter the
 * 6-digit code before the countdown ends → confirm. The code is requested only
 * when the operator asks for it, so opening and cancelling never sends email.
 *
 * Handles: wrong code (attempts left), expired/consumed challenge (ask for a
 * new code), and 503 `ops_audit_chain_lock_timeout` (retried automatically
 * after 1.5 s, up to three times).
 */

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { KeyRound, MailCheck } from "lucide-react";
import { Notice } from "@/components/ui/console";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { OPS_POPUP_CLASS, OpsField, formatClock, useSecondsUntil } from "@/components/ops/ui/ops-ui";
import { cn } from "@/lib/utils";
import { ApiError } from "@/lib/api";
import { getApiErrorMessageWithHint, isOpsOtpChallengeConsumed, isOpsOtpVerificationError } from "@/lib/error-messages";
import { isCompleteOtpCode, normalizeOtpCodeInput } from "@/lib/otp-code";
import { requestOpsOtpChallenge, type OpsOtpActionType } from "@/lib/ops-client-api";

/** Backend allows this many wrong codes per challenge (OPS_OTP_MAX_ATTEMPTS). */
const MAX_ATTEMPTS = 3;
const LOCK_RETRY_DELAY_MS = 1500;
const LOCK_MAX_RETRIES = 3;

export interface OpsOtpPayload {
  challengeId: string;
  otpCode: string;
}

interface OpsOtpDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  action: OpsOtpActionType;
  title: string;
  description: ReactNode;
  /** Final button, e.g. "Deactivate account". */
  confirmLabel: string;
  tone?: "default" | "danger";
  /** Extra inputs shown above the code step, e.g. a reason. */
  children?: ReactNode;
  /** False while those inputs are incomplete — blocks sending the code. */
  canProceed?: boolean;
  /** Message under the details when `canProceed` is false. */
  proceedHint?: string;
  /** Runs the protected request. Throw to keep the dialog open with the error. */
  onConfirm: (payload: OpsOtpPayload) => Promise<void>;
}

export function OpsOtpDialog(props: OpsOtpDialogProps) {
  const { open, onOpenChange } = props;
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy && !next) return; // never abandon an in-flight protected request
        onOpenChange(next);
      }}
    >
      {/* Portalled to <body>: re-apply the console scope so tokens match the shell. */}
      <DialogContent className={cn(OPS_POPUP_CLASS, "max-w-md!")} hideCloseButton={busy}>
        {open ? <OtpDialogBody {...props} onBusyChange={setBusy} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function readAttemptsRemaining(error: unknown): number | null {
  if (!(error instanceof ApiError) || typeof error.details !== "object" || error.details === null) return null;
  const value = (error.details as { attemptsRemaining?: unknown }).attemptsRemaining;
  return typeof value === "number" ? value : null;
}

function isLockTimeout(error: unknown): boolean {
  return error instanceof ApiError && error.code.toLowerCase() === "ops_audit_chain_lock_timeout";
}

function OtpDialogBody({
  onOpenChange,
  action,
  title,
  description,
  confirmLabel,
  tone = "default",
  children,
  canProceed = true,
  proceedHint,
  onConfirm,
  onBusyChange,
}: OpsOtpDialogProps & { onBusyChange: (busy: boolean) => void }) {
  const [challenge, setChallenge] = useState<{ id: string; expiresAt: string } | null>(null);
  const [code, setCode] = useState("");
  const [attemptsLeft, setAttemptsLeft] = useState(MAX_ATTEMPTS);
  const [sending, setSending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const codeInputRef = useRef<HTMLInputElement | null>(null);
  const lockRetries = useRef(0);
  const secondsLeft = useSecondsUntil(challenge?.expiresAt);
  const expired = challenge !== null && secondsLeft === 0;

  useEffect(() => {
    onBusyChange(sending || confirming);
  }, [sending, confirming, onBusyChange]);

  useEffect(() => {
    if (challenge) codeInputRef.current?.focus();
  }, [challenge]);

  async function sendCode() {
    setError(null);
    setStatus(null);
    setSending(true);
    try {
      const next = await requestOpsOtpChallenge(action);
      setChallenge({ id: next.challengeId, expiresAt: next.expiresAt });
      setCode("");
      setAttemptsLeft(MAX_ATTEMPTS);
      setStatus("We emailed a 6-digit code to your ops address.");
    } catch (err) {
      setError(getApiErrorMessageWithHint(err));
    } finally {
      setSending(false);
    }
  }

  async function confirm(): Promise<void> {
    if (!challenge) return;
    if (expired) {
      setError("This code has expired. Send a new one.");
      return;
    }
    if (!isCompleteOtpCode(code)) {
      setError("Enter the 6-digit code from the email.");
      return;
    }
    setError(null);
    setConfirming(true);
    try {
      await onConfirm({ challengeId: challenge.id, otpCode: normalizeOtpCodeInput(code) });
      lockRetries.current = 0;
      setConfirming(false);
      onOpenChange(false);
      return;
    } catch (err) {
      if (isLockTimeout(err) && lockRetries.current < LOCK_MAX_RETRIES) {
        lockRetries.current += 1;
        setStatus("The system is busy recording another action. Retrying…");
        window.setTimeout(() => void confirm(), LOCK_RETRY_DELAY_MS);
        return;
      }
      lockRetries.current = 0;
      if (isOpsOtpChallengeConsumed(err)) {
        setChallenge(null);
        setCode("");
        setStatus(null);
        setError("That code can no longer be used. Send a new code and try again.");
      } else if (isOpsOtpVerificationError(err)) {
        const remaining = readAttemptsRemaining(err) ?? Math.max(0, attemptsLeft - 1);
        setAttemptsLeft(remaining);
        setCode("");
        setStatus(null);
        if (remaining <= 0) {
          setChallenge(null);
          setError("Too many wrong codes. Send a new code to try again.");
        } else {
          setError(`That code is incorrect. ${remaining} ${remaining === 1 ? "attempt" : "attempts"} left.`);
        }
        codeInputRef.current?.focus();
      } else {
        setStatus(null);
        setError(getApiErrorMessageWithHint(err));
      }
    }
    setConfirming(false);
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!challenge) {
      if (canProceed) void sendCode();
      return;
    }
    void confirm();
  }

  const working = sending || confirming;

  return (
    <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col" noValidate>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      <DialogBody className="flex flex-col gap-4">
        {children ? <fieldset disabled={challenge !== null || working} className="flex min-w-0 flex-col gap-4">{children}</fieldset> : null}
        {!canProceed && proceedHint && !challenge ? <p className="text-xs text-muted-foreground">{proceedHint}</p> : null}

        {challenge ? (
          <div className="flex min-w-0 flex-col gap-3 border-t border-border pt-4 first:border-t-0 first:pt-0">
            <OpsField
              label="Verification code"
              htmlFor="ops-otp-code"
              hint={
                expired ? (
                  <span className="text-destructive">Code expired — send a new one.</span>
                ) : (
                  <span aria-live="off">
                    Expires in <span className="tabular font-medium text-foreground">{formatClock(secondsLeft ?? 0)}</span>
                    {attemptsLeft < MAX_ATTEMPTS ? ` · ${attemptsLeft} ${attemptsLeft === 1 ? "attempt" : "attempts"} left` : null}
                  </span>
                )
              }
            >
              <Input
                id="ops-otp-code"
                ref={codeInputRef}
                value={code}
                onChange={(event) => setCode(normalizeOtpCodeInput(event.target.value))}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="000000"
                aria-invalid={error ? true : undefined}
                className="h-11 max-w-48 text-center font-mono text-lg tracking-widest tabular"
                disabled={confirming}
              />
            </OpsField>
            <div>
              <Button type="button" variant="link" size="sm" className="h-auto px-0" onClick={() => void sendCode()} disabled={working}>
                Send a new code
              </Button>
            </div>
          </div>
        ) : null}

        <div aria-live="polite" className="flex min-w-0 flex-col gap-3">
          {status && !error ? (
            <Notice tone="info" icon={MailCheck}>
              {status}
            </Notice>
          ) : null}
          {error ? <Notice tone="danger">{error}</Notice> : null}
        </div>
      </DialogBody>
      <DialogFooter className="flex-wrap">
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={working}>
          Cancel
        </Button>
        {challenge ? (
          <Button
            type="submit"
            variant={tone === "danger" ? "destructive" : "default"}
            loading={confirming}
            disabled={expired || !isCompleteOtpCode(code)}
          >
            {confirmLabel}
          </Button>
        ) : (
          <Button type="submit" loading={sending} disabled={!canProceed} className="gap-1.5">
            {!sending ? <KeyRound aria-hidden /> : null}
            Email me a code
          </Button>
        )}
      </DialogFooter>
    </form>
  );
}
