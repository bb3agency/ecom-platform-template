"use client";

import { useEffect, useState } from "react";
import { OpsCriticalOtpForm } from "@/components/ops/OpsCriticalOtpForm";
import { OpsAlert, OpsBadge, OpsCard, OpsField, OpsLoadingBlock, OpsSelect, OpsTextarea } from "@/components/ops/ui/ops-ui";
import { getApiErrorMessageWithHint } from "@/lib/error-messages";
import { loadShedBadgeTone } from "@/lib/ops-status-maps";
import {
  getOpsLoadShedStatusClient,
  setOpsLoadShedMode,
  type OpsLoadShedStatus,
} from "@/lib/ops-client-api";
import { useOpsCanWrite } from "@/components/ops/OpsSessionProvider";

const MODE_DESCRIPTIONS: Record<OpsLoadShedStatus["mode"], string> = {
  normal: "Full traffic — every storefront, admin, and ops route is reachable.",
  reduced: "Non-critical admin reports, analytics, and inventory dashboards are temporarily shed. Catalogue browsing and checkout remain live.",
  emergency: "Strict protection — checkout mutations, cart writes, and admin writes are blocked. Use only under severe pressure (DB pressure, payment provider outage, etc.).",
  maintenance: "Planned downtime. Starts with a 2-minute warning window during which payment-in-flight jobs drain; afterwards the storefront serves a static maintenance page until ops switches back. Ops console stays reachable.",
};

function formatRelativeSeconds(targetIso: string | null): string | null {
  if (!targetIso) return null;
  const target = new Date(targetIso).getTime();
  const diff = target - Date.now();
  if (!Number.isFinite(target)) return null;
  if (diff <= 0) return "now";
  const totalSeconds = Math.ceil(diff / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
}

export function OpsLoadShedPanel() {
  const canWrite = useOpsCanWrite();
  const [status, setStatus] = useState<OpsLoadShedStatus | null>(null);
  const [targetMode, setTargetMode] = useState<OpsLoadShedStatus["mode"]>("reduced");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [countdownTick, setCountdownTick] = useState(0);

  useEffect(() => {
    void getOpsLoadShedStatusClient()
      .then((next) => {
        setStatus(next);
        setError(null);
      })
      .catch((err) => setError(getApiErrorMessageWithHint(err)))
      .finally(() => setLoading(false));
  }, []);

  // While maintenance is pending, refresh the panel + countdown frequently
  // so the operator sees the cutover time tick down accurately.
  useEffect(() => {
    if (status?.mode !== "maintenance" || status.phase !== "pending") return;
    const interval = setInterval(() => {
      setCountdownTick((t) => t + 1);
      void getOpsLoadShedStatusClient()
        .then((next) => setStatus(next))
        .catch(() => {
          // Silent — banner-style polling, transient failures are fine.
        });
    }, 5_000);
    return () => clearInterval(interval);
  }, [status?.mode, status?.phase]);

  if (loading) {
    return <OpsLoadingBlock label="Fetching load-shed status…" />;
  }

  const mode = status?.mode ?? null;
  const phase = status?.phase ?? null;
  const countdownText =
    status?.mode === "maintenance" && status.phase === "pending"
      ? formatRelativeSeconds(status.pendingUntil)
      : null;

  return (
    <div className="grid min-w-0 grid-cols-1 gap-6">
      {error ? <OpsAlert tone="error">{error}</OpsAlert> : null}
      {mode ? (
        <OpsCard padding="md" className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm text-muted-foreground">Current runtime mode</p>
              <p className="font-heading mt-1 text-2xl font-semibold capitalize">
                {mode}
                {phase ? ` · ${phase}` : ""}
              </p>
            </div>
            <OpsBadge tone={loadShedBadgeTone(mode)}>{mode}</OpsBadge>
          </div>
          {mode === "maintenance" && phase === "pending" ? (
            <OpsAlert tone="warning">
              Maintenance cutover in <strong>{countdownText ?? "moments"}</strong>
              {countdownTick >= 0 ? "" : ""}. Payment-in-flight jobs are draining; new checkout mutations are blocked.
              Switch the mode below before the timer elapses to abort the maintenance window.
            </OpsAlert>
          ) : null}
          {mode === "maintenance" && phase === "active" ? (
            <OpsAlert tone="error">
              Site is in maintenance — the storefront and admin surfaces are returning the maintenance page. The ops console
              and provider webhooks remain reachable. Switch the mode below to <strong>normal</strong>, <strong>reduced</strong>,
              or <strong>emergency</strong> to restore traffic.
            </OpsAlert>
          ) : null}
          {status?.reason ? (
            <p className="text-xs text-muted-foreground">
              <span className="font-medium">Last reason:</span> {status.reason}
            </p>
          ) : null}
        </OpsCard>
      ) : null}

      {!canWrite ? (
        <OpsAlert tone="warning">You have read-only access. Load-shed changes require ops:write.</OpsAlert>
      ) : (
        <OpsCriticalOtpForm
          actionType="load-shed-change"
          title="Change load-shed mode"
          description="Applies immediately after OTP verification. Maintenance mode starts a 2-minute warning window before the site goes offline."
          buttonLabel="Apply mode change"
          onExecute={async ({ challengeId, otpCode }) => {
            const trimmedReason = reason.trim();
            if (trimmedReason.length < 10) {
              throw new Error("Reason must be at least 10 characters.");
            }
            const result = await setOpsLoadShedMode({
              mode: targetMode,
              reason: trimmedReason,
              challengeId,
              otpCode,
            });
            setStatus({
              mode: result.mode,
              phase: result.phase,
              pendingUntil: result.pendingUntil,
              activatedAt: status?.activatedAt ?? null,
              reason: trimmedReason,
            });
          }}
        >
          <div className="grid min-w-0 grid-cols-1 gap-4">
            <OpsField label="Target mode" htmlFor="load-shed-mode">
              <OpsSelect
                id="load-shed-mode"
                name="mode"
                value={targetMode}
                onChange={(event) => {
                  setTargetMode(event.target.value as OpsLoadShedStatus["mode"]);
                }}
              >
                <option value="normal">Normal — full traffic</option>
                <option value="reduced">Reduced — defer non-critical work</option>
                <option value="emergency">Emergency — strict protection</option>
                <option value="maintenance">Maintenance — planned downtime (2-min warning)</option>
              </OpsSelect>
            </OpsField>
            <p className="text-xs text-muted-foreground">{MODE_DESCRIPTIONS[targetMode]}</p>
            <OpsField label="Reason" htmlFor="load-shed-reason" hint="Minimum 10 characters for audit">
              <OpsTextarea
                id="load-shed-reason"
                name="reason"
                minLength={10}
                required
                placeholder="Describe why this mode change is required…"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </OpsField>
          </div>
        </OpsCriticalOtpForm>
      )}
    </div>
  );
}
