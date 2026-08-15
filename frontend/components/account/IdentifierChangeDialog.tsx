"use client";

import { useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  requestIdentifierChange,
  verifyIdentifierChange,
  type IdentifierChangeRequestResult,
  type IdentifierType,
} from "@/lib/users-api";
import type { User } from "@/types/user";
import { getApiErrorMessage } from "@/lib/error-messages";

/**
 * Confirms a change of login identifier with codes (pentest F-1, 2026-08-15).
 *
 * The account's EXISTING email/phone always receives a code — that is the proof
 * of ownership, and the reason a stolen access token is no longer enough to
 * rebind an account. When a new value is being set it receives a second code, so
 * a typo cannot hand account recovery to a stranger's mailbox.
 *
 * On success every session is revoked server-side, so the caller must send the
 * user back to sign-in.
 */

interface IdentifierChangeDialogProps {
  accessToken: string;
  type: IdentifierType;
  /** New value to bind, or null to remove a mobile number. */
  newValue: string | null;
  onCancel: () => void;
  onVerified: (user: User) => void;
}

export function IdentifierChangeDialog({
  accessToken,
  type,
  newValue,
  onCancel,
  onVerified,
}: IdentifierChangeDialogProps) {
  const [challenge, setChallenge] = useState<IdentifierChangeRequestResult | null>(null);
  const [currentOtp, setCurrentOtp] = useState("");
  const [newOtp, setNewOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const label = type === "email" ? "email address" : "mobile number";
  const removing = newValue === null;

  async function send() {
    setBusy(true);
    setError(null);
    try {
      const result = await requestIdentifierChange(accessToken, { type, newValue });
      setChallenge(result);
      setSent(true);
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const updated = await verifyIdentifierChange(accessToken, {
        type,
        currentOtp: currentOtp.trim(),
        ...(challenge?.newTargetMasked ? { newOtp: newOtp.trim() } : {}),
      });
      onVerified(updated);
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const needsNewCode = Boolean(challenge?.newTargetMasked);
  const canConfirm =
    currentOtp.trim().length === 6 && (!needsNewCode || newOtp.trim().length === 6);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="identifier-change-title"
    >
      <div className="w-full max-w-md rounded-2xl bg-card p-5 shadow-xl sm:p-6">
        <div className="mb-4 flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-primary">
            <ShieldCheck className="size-5" aria-hidden />
          </div>
          <div>
            <h2 id="identifier-change-title" className="font-heading text-base font-bold text-primary">
              {removing ? `Remove your ${label}` : `Confirm your new ${label}`}
            </h2>
            <p className="text-xs text-muted-foreground">
              For your security we confirm this change with a code sent to your current details.
            </p>
          </div>
        </div>

        {!sent ? (
          <>
            <p className="mb-4 text-sm text-muted-foreground">
              {removing
                ? `We'll send a code to your current ${label} to confirm you want to remove it.`
                : `We'll send one code to the ${label} already on your account and another to ${newValue}. Both are needed to make the change.`}
            </p>
            {error && <p className="mb-3 text-sm text-destructive">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={onCancel} disabled={busy}>
                Cancel
              </Button>
              <Button
                size="sm"
                className="bg-primary hover:bg-accent"
                onClick={() => void send()}
                disabled={busy}
              >
                {busy ? (
                  <>
                    <Loader2 className="size-4 animate-spin" aria-hidden /> Sending…
                  </>
                ) : (
                  "Send codes"
                )}
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="grid gap-4">
              <div className="grid gap-1.5">
                <label className="text-xs font-bold text-primary" htmlFor="identifier-current-otp">
                  Code sent to {challenge?.currentTargetMasked}
                </label>
                <input
                  id="identifier-current-otp"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={currentOtp}
                  onChange={(e) => setCurrentOtp(e.target.value.replace(/\D/g, ""))}
                  className="flex h-10 w-full rounded-lg border border-border bg-background px-3 text-sm tracking-widest text-primary focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/15"
                />
              </div>
              {needsNewCode && (
                <div className="grid gap-1.5">
                  <label className="text-xs font-bold text-primary" htmlFor="identifier-new-otp">
                    Code sent to {challenge?.newTargetMasked}
                  </label>
                  <input
                    id="identifier-new-otp"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    value={newOtp}
                    onChange={(e) => setNewOtp(e.target.value.replace(/\D/g, ""))}
                    className="flex h-10 w-full rounded-lg border border-border bg-background px-3 text-sm tracking-widest text-primary focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/15"
                  />
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Signing in again will be required after this change — all devices are signed out.
              </p>
              {error && <p className="text-sm text-destructive">{error}</p>}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={onCancel} disabled={busy}>
                Cancel
              </Button>
              <Button
                size="sm"
                className="bg-primary hover:bg-accent"
                onClick={() => void confirm()}
                disabled={busy || !canConfirm}
              >
                {busy ? (
                  <>
                    <Loader2 className="size-4 animate-spin" aria-hidden /> Confirming…
                  </>
                ) : (
                  "Confirm change"
                )}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
