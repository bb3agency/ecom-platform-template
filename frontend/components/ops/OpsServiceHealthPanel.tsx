"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { OpsLinesSkeleton, OpsLoadError, formatRelativeTime } from "@/components/ops/ui/ops-ui";
import { Panel, StatusDot, type StatusTone } from "@/components/ui/console";
import { Button } from "@/components/ui/button";
import { fetchOpsReadinessStatus } from "@/lib/ops-client-api";
import { getApiErrorMessageWithHint } from "@/lib/error-messages";
import type { ReadinessStatus } from "@/types/api";

const POLL_MS = 10_000;

export const DEGRADATION_COPY: Record<ReadinessStatus["degradationMode"], string> = {
  none: "API, database, cache and workers are all healthy.",
  database_down: "The API can't reach the database. Orders and sign-ins will fail until it's back.",
  redis_down: "The API can't reach Redis. Sessions, rate limits and queues are affected.",
  queue_stale:
    "Background workers haven't checked in recently. Emails, shipping updates and refunds are queuing up — check the worker process.",
  runtime_config_missing: "Required settings are missing, so the API won't serve traffic. Add them in Configuration.",
};

function formatAge(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

interface HealthRow {
  label: string;
  tone: StatusTone;
  value: string;
  detail?: string;
}

function buildRows(readiness: ReadinessStatus): HealthRow[] {
  const { queues } = readiness;
  return [
    {
      label: "Database",
      tone: readiness.database === "connected" ? "success" : "danger",
      value: readiness.database === "connected" ? "Connected" : "Unreachable",
    },
    {
      label: "Redis",
      tone: readiness.redis === "connected" ? "success" : "danger",
      value: readiness.redis === "connected" ? "Connected" : "Unreachable",
    },
    {
      label: "Workers",
      tone: queues.workerFreshness === "fresh" ? "success" : queues.workerFreshness === "stale" ? "danger" : "warning",
      value: queues.workerFreshness === "fresh" ? "Running" : queues.workerFreshness === "stale" ? "Not responding" : "Unknown",
    },
    {
      label: "Job backlog",
      tone: queues.waiting === 0 ? "success" : queues.oldestWaitingAgeSeconds > 300 ? "warning" : "neutral",
      value: queues.waiting === 0 ? "Empty" : `${queues.waiting} waiting · ${queues.active} running`,
      detail: queues.waiting > 0 ? `Oldest waiting ${formatAge(queues.oldestWaitingAgeSeconds)}` : undefined,
    },
  ];
}

/**
 * Live dependency health from `GET /health/ready` (public, so it is polled every
 * 10 s without touching the ops rate limit). A 503 still carries the payload.
 */
interface OpsServiceHealthPanelProps {
  id?: string;
  className?: string;
  /** Called with every successful check, so a parent can surface problems elsewhere. */
  onReadiness?: (readiness: ReadinessStatus) => void;
}

export function OpsServiceHealthPanel({ id, className, onReadiness }: OpsServiceHealthPanelProps) {
  const [readiness, setReadiness] = useState<ReadinessStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);

  const load = useCallback(async () => {
    setChecking(true);
    try {
      const next = await fetchOpsReadinessStatus();
      setReadiness(next);
      onReadiness?.(next);
      setError(null);
    } catch (err) {
      setError(getApiErrorMessageWithHint(err));
    } finally {
      setCheckedAt(new Date().toISOString());
      setChecking(false);
    }
  }, [onReadiness]);

  useEffect(() => {
    const first = window.setTimeout(() => void load(), 0);
    const timer = window.setInterval(() => void load(), POLL_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [load]);

  const ready = readiness?.status === "ready";

  return (
    <Panel
      id={id}
      className={className}
      title="Service health"
      description={
        readiness ? (
          <StatusDot tone={ready ? "success" : "danger"} className="text-muted-foreground">
            {ready ? "Ready to serve traffic" : "Not ready"}
            {readiness.version ? ` · v${readiness.version}` : ""}
          </StatusDot>
        ) : (
          "Checks every 10 seconds"
        )
      }
      actions={
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => void load()}
          disabled={checking}
          aria-label="Check service health now"
          title="Check now"
        >
          <RefreshCw className={checking ? "animate-spin" : undefined} aria-hidden />
        </Button>
      }
      footer={
        <p className="text-xs text-muted-foreground" aria-live="off">
          Last checked {checkedAt ? formatRelativeTime(checkedAt) : "—"}
        </p>
      }
    >
      {!readiness && error ? <OpsLoadError message={error} onRetry={() => void load()} /> : null}
      {!readiness && !error ? <OpsLinesSkeleton lines={4} /> : null}
      {readiness ? (
        <div className="flex min-w-0 flex-col gap-4" aria-live="polite">
          {!ready ? <p className="text-sm text-foreground">{DEGRADATION_COPY[readiness.degradationMode]}</p> : null}
          <dl className="divide-y divide-border">
            {buildRows(readiness).map((row) => (
              <div key={row.label} className="flex min-w-0 items-start justify-between gap-4 py-2.5 first:pt-0 last:pb-0">
                <dt className="text-sm text-muted-foreground">{row.label}</dt>
                <dd className="min-w-0 text-right">
                  <StatusDot tone={row.tone}>
                    {row.value}
                  </StatusDot>
                  {row.detail ? <p className="mt-0.5 text-xs text-muted-foreground">{row.detail}</p> : null}
                </dd>
              </div>
            ))}
          </dl>
          {readiness.runtimeConfigMissingKeys.length > 0 ? (
            <p className="break-words text-xs text-muted-foreground">
              Missing: <span className="font-mono text-foreground">{readiness.runtimeConfigMissingKeys.join(", ")}</span>
            </p>
          ) : null}
        </div>
      ) : null}
    </Panel>
  );
}
