"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { OpsAlert, OpsBadge, OpsCard, OpsCardHeader } from "@/components/ops/ui/ops-ui";
import { Button } from "@/components/ui/button";
import { fetchOpsReadinessStatus } from "@/lib/ops-client-api";
import { getApiErrorMessageWithHint } from "@/lib/error-messages";
import type { ReadinessStatus } from "@/types/api";

interface OpsRuntimeReadinessCardProps {
  refreshSignal?: number;
}

export function OpsRuntimeReadinessCard({
  refreshSignal = 0,
}: OpsRuntimeReadinessCardProps) {
  const [readiness, setReadiness] = useState<ReadinessStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);

  const loadReadiness = useCallback(async (quiet = false) => {
    if (!quiet) {
      setIsLoading(true);
    }
    try {
      const next = await fetchOpsReadinessStatus();
      setReadiness(next);
      setError(null);
      setLastUpdatedAt(new Date().toISOString());
    } catch (err) {
      setError(getApiErrorMessageWithHint(err));
      setReadiness(null);
      setLastUpdatedAt(new Date().toISOString());
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadReadiness(false);
  }, [loadReadiness, refreshSignal]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void loadReadiness(true);
    }, 10000);
    return () => window.clearInterval(interval);
  }, [loadReadiness]);

  const isReady = readiness?.status === "ready";
  const missingKeys = readiness?.runtimeConfigMissingKeys ?? [];

  return (
    <OpsCard className="min-w-0" aria-live="polite">
      <OpsCardHeader
        title="Runtime readiness"
        description="GET /health/ready — polls every 10s"
        actions={
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void loadReadiness()}
            disabled={isLoading}
            className="w-full gap-2 sm:w-auto"
          >
            <RefreshCw className={isLoading ? "size-4 shrink-0 animate-spin" : "size-4 shrink-0"} />
            Refresh
          </Button>
        }
      />

      {error && !readiness ? <OpsAlert tone="error">{error}</OpsAlert> : null}

      {readiness ? (
        <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 lg:grid-cols-4 lg:gap-4">
          <div className="min-w-0 rounded-lg border border-border/60 bg-muted/20 p-4">
            <p className="text-xs text-muted-foreground">Status</p>
            <OpsBadge tone={isReady ? "success" : "warning"} className="mt-2">
              {readiness.status}
            </OpsBadge>
          </div>
          <div className="min-w-0 rounded-lg border border-border/60 bg-muted/20 p-4">
            <p className="text-xs text-muted-foreground">Database</p>
            <OpsBadge tone={readiness.database === "connected" ? "success" : "danger"} className="mt-2">
              {readiness.database}
            </OpsBadge>
          </div>
          <div className="min-w-0 rounded-lg border border-border/60 bg-muted/20 p-4">
            <p className="text-xs text-muted-foreground">Redis</p>
            <OpsBadge tone={readiness.redis === "connected" ? "success" : "danger"} className="mt-2">
              {readiness.redis}
            </OpsBadge>
          </div>
          <div className="min-w-0 rounded-lg border border-border/60 bg-muted/20 p-4 min-[420px]:col-span-2 lg:col-span-1">
            <p className="text-xs text-muted-foreground">Workers</p>
            <p className="mt-2 text-sm font-medium break-words">{readiness.queues.workerFreshness}</p>
          </div>
        </div>
      ) : !error ? (
        <p className="text-sm text-muted-foreground">Checking readiness…</p>
      ) : null}

      {!isReady && missingKeys.length > 0 ? (
        <OpsAlert tone="warning" className="mt-4" title="Missing runtime keys">
          {missingKeys.join(", ")}
        </OpsAlert>
      ) : null}

      {isReady ? (
        <OpsAlert tone="success" className="mt-4">
          All required runtime keys are configured and dependencies are healthy.
        </OpsAlert>
      ) : null}

      <p className="mt-4 text-xs text-muted-foreground">
        Last updated: {lastUpdatedAt ? new Date(lastUpdatedAt).toLocaleTimeString() : "—"}
      </p>
    </OpsCard>
  );
}
