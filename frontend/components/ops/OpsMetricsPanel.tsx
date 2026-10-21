"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Activity, RefreshCw } from "lucide-react";
import { OpsCodeBlock, OpsLinesSkeleton, OpsLoadError, formatRelativeTime } from "@/components/ops/ui/ops-ui";
import { ConsolePage, FilterBar, PageHeader, Panel } from "@/components/ui/console";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { getApiErrorMessageWithHint } from "@/lib/error-messages";
import { parsePrometheusText } from "@/lib/ops-metrics";
import { getOpsMetricsTextClient } from "@/lib/ops-client-api";

const SAMPLE_PREVIEW = 12;

/**
 * Prometheus snapshot, fetched in the browser (the ops session cookie is scoped
 * to /api/v1/ops, so a server render can't authenticate). One snapshot per visit
 * or click — the endpoint isn't meant for tight polling.
 */
export function OpsMetricsPanel() {
  const [metrics, setMetrics] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [takenAt, setTakenAt] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [showRaw, setShowRaw] = useState(false);
  const families = useMemo(() => parsePrometheusText(metrics), [metrics]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return families;
    return families.filter((f) => f.name.toLowerCase().includes(q) || f.help.toLowerCase().includes(q));
  }, [families, query]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setMetrics(await getOpsMetricsTextClient());
      setTakenAt(new Date().toISOString());
      setError(null);
    } catch (err) {
      setError(getApiErrorMessageWithHint(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  let body: ReactNode;
  if (error && !metrics) {
    body = <OpsLoadError message={error} onRetry={() => void load()} />;
  } else if (loading && !metrics) {
    body = (
      <Panel>
        <OpsLinesSkeleton lines={6} />
      </Panel>
    );
  } else if (families.length === 0) {
    body = <EmptyState icon={Activity} headline="No metrics yet" description="The API returned an empty snapshot." />;
  } else {
    body = (
      <>
        <FilterBar
          search={{ value: query, onChange: setQuery, placeholder: "Search metrics", label: "Search metrics" }}
          trailing={
            <Button type="button" variant="outline" onClick={() => setShowRaw((v) => !v)} aria-pressed={showRaw}>
              {showRaw ? "Show grouped" : "Show raw text"}
            </Button>
          }
        />
        {showRaw ? (
          <Panel title="Raw exposition" flush>
            <OpsCodeBlock className="max-h-screen rounded-none border-0">{metrics}</OpsCodeBlock>
          </Panel>
        ) : (
          <Panel title={`${filtered.length} of ${families.length} metrics`} flush>
            {filtered.length === 0 ? (
              <p className="px-4 py-4 text-sm text-muted-foreground sm:px-5">No metric matches “{query}”.</p>
            ) : (
              <ul className="divide-y divide-border">
                {filtered.map((f) => (
                  <li key={f.name} className="flex min-w-0 flex-col gap-1.5 px-4 py-3 sm:px-5">
                    <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span className="min-w-0 break-all font-mono text-sm font-medium text-foreground">{f.name}</span>
                      <span className="text-xs text-muted-foreground">{f.type}</span>
                    </div>
                    {f.help ? <p className="text-sm text-muted-foreground">{f.help}</p> : null}
                    {f.samples.length > 0 ? (
                      <details className="min-w-0">
                        <summary className="cursor-pointer py-1 text-xs font-medium text-primary">
                          {f.samples.length} {f.samples.length === 1 ? "sample" : "samples"}
                        </summary>
                        <OpsCodeBlock className="mt-2 max-h-64">
                          {f.samples.slice(0, SAMPLE_PREVIEW).join("\n") +
                            (f.samples.length > SAMPLE_PREVIEW ? `\n… ${f.samples.length - SAMPLE_PREVIEW} more` : "")}
                        </OpsCodeBlock>
                      </details>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        )}
      </>
    );
  }

  return (
    <ConsolePage>
      <PageHeader
        title="Metrics"
        description={`Prometheus snapshot from the API${takenAt ? `, taken ${formatRelativeTime(takenAt)}` : ""}.`}
        actions={
          <Button type="button" variant="outline" onClick={() => void load()} disabled={loading} className="gap-1.5">
            <RefreshCw className={loading ? "animate-spin" : undefined} aria-hidden />
            New snapshot
          </Button>
        }
      />
      {body}
    </ConsolePage>
  );
}
