"use client";

import { OpsAlert, OpsCard, OpsCardHeader, OpsCodeBlock } from "@/components/ops/ui/ops-ui";

interface OpsMetricsPanelProps {
  metrics: string;
  error: string | null;
}

export function OpsMetricsPanel({ metrics, error }: OpsMetricsPanelProps) {
  if (error) {
    return (
      <OpsAlert tone="warning" title="Metrics unavailable">
        {error}
        <p className="mt-2 text-xs opacity-90">
          Server-side fetch uses <code>OPS_METRICS_TOKEN</code> or ops UI auth. Configure in VPS
          frontend env for production snapshots.
        </p>
      </OpsAlert>
    );
  }

  return (
    <OpsCard>
      <OpsCardHeader
        title="Prometheus exposition"
        description="Read-only text from GET /api/v1/ops/metrics"
      />
      <OpsCodeBlock>{metrics}</OpsCodeBlock>
    </OpsCard>
  );
}
