import { OpsMetricsPanel } from "@/components/ops/OpsMetricsPanel";
import { OpsPageFrame } from "@/components/ops/ui/ops-ui";
import { getOpsMetricsSnapshot } from "@/lib/ops-api";

export default async function OpsMetricsPage() {
  let metrics = "";
  let message: string | null = null;

  try {
    metrics = await getOpsMetricsSnapshot();
  } catch (error) {
    message = error instanceof Error ? error.message : "Unable to load metrics snapshot";
  }

  return (
    <OpsPageFrame
      title="Metrics"
      description="Prometheus-format snapshot for platform observability. Protected endpoint — not for browser polling at high frequency."
    >
      <OpsMetricsPanel metrics={metrics} error={message} />
    </OpsPageFrame>
  );
}
