"use client";

import { useEffect, useState } from "react";
import { OpsConfigEditor } from "@/components/ops/OpsConfigEditor";
import { OpsRuntimeReadinessCard } from "@/components/ops/OpsRuntimeReadinessCard";
import { OpsAlert, OpsBadge, OpsCard, OpsLoadingBlock } from "@/components/ops/ui/ops-ui";
import { getApiErrorMessageWithHint } from "@/lib/error-messages";
import {
  getOpsConfigOverviewClient,
  getOpsStoredConfigClient,
  getWhatsappOtpCostClient,
  type OpsConfigOverview,
  type OpsStoredConfig,
  type WhatsappOtpCostEstimate,
} from "@/lib/ops-client-api";

function formatInr(paise: number): string {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(paise / 100);
}

export function OpsConfigPagePanel() {
  const [overview, setOverview] = useState<OpsConfigOverview | null>(null);
  const [stored, setStored] = useState<OpsStoredConfig | null>(null);
  const [whatsappOtpCost, setWhatsappOtpCost] = useState<WhatsappOtpCostEstimate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshSignal, setRefreshSignal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void Promise.all([getOpsConfigOverviewClient(), getOpsStoredConfigClient()])
      .then(([nextOverview, nextStored]) => {
        setOverview(nextOverview);
        setStored(nextStored);
        setError(null);
      })
      .catch((err) => setError(getApiErrorMessageWithHint(err)))
      .finally(() => setLoading(false));
    // Cost estimate is best-effort — never blocks the config page if it fails.
    void getWhatsappOtpCostClient()
      .then(setWhatsappOtpCost)
      .catch(() => setWhatsappOtpCost(null));
  }, [refreshSignal]);

  if (loading) {
    return <OpsLoadingBlock label="Loading configuration contract…" />;
  }

  if (error) {
    return <OpsAlert tone="error">{error}</OpsAlert>;
  }

  if (!overview || !stored) {
    return null;
  }

  return (
    <div className="grid gap-8">
      <OpsAlert tone="info">
        Bootstrap keys (<code className="text-xs">DATABASE_URL</code>,{" "}
        <code className="text-xs">OPS_DB_ENCRYPTION_KEY</code>) are read-only here — change via
        deployment environment. DB-overlay keys require OTP save and may need API/worker restart.
      </OpsAlert>
      <OpsRuntimeReadinessCard refreshSignal={refreshSignal} />
      <OpsCard padding="md">
        <div className="flex flex-wrap items-center gap-3">
          <OpsBadge tone={overview.runtimeProfile === "production-like" ? "info" : "warning"}>
            {overview.runtimeProfile}
          </OpsBadge>
          {!overview.strictProfileHealth.noPlaceholdersInStrict ? (
            <OpsBadge tone="warning">Placeholders in strict profile</OpsBadge>
          ) : (
            <OpsBadge tone="success">No placeholders</OpsBadge>
          )}
          {overview.strictProfileHealth.missingRequiredKeysInStrict.length > 0 ? (
            <OpsBadge tone="danger">
              {overview.strictProfileHealth.missingRequiredKeysInStrict.length} missing keys
            </OpsBadge>
          ) : null}
        </div>
      </OpsCard>
      {whatsappOtpCost ? (
        <OpsCard padding="md">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                WhatsApp OTP cost (estimate)
              </p>
              <p className="text-sm">
                This cycle:{" "}
                <span className="font-semibold">{formatInr(whatsappOtpCost.currentCycle.costPaise)}</span>{" "}
                ({whatsappOtpCost.currentCycle.count} sent) · All time:{" "}
                <span className="font-semibold">{formatInr(whatsappOtpCost.allTime.costPaise)}</span>{" "}
                ({whatsappOtpCost.allTime.count} sent)
              </p>
            </div>
            <OpsBadge tone="info">{formatInr(whatsappOtpCost.costPerMessagePaise)}/msg</OpsBadge>
          </div>
        </OpsCard>
      ) : null}
      <OpsConfigEditor
        overview={overview}
        stored={stored}
        onConfigSaved={() => setRefreshSignal((prev) => prev + 1)}
      />
    </div>
  );
}
