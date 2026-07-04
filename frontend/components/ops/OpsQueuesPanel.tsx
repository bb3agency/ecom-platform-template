"use client";

import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import {
  OpsAlert,
  OpsBadge,
  OpsCard,
  OpsCardHeader,
  OpsEmptyState,
  OpsLoadingBlock,
  OpsStatCard,
} from "@/components/ops/ui/ops-ui";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getApiErrorMessageWithHint } from "@/lib/error-messages";
import {
  getOpsDlqSummaryClient,
  getOpsQueuesBoardUrl,
  type OpsDlqSummary,
} from "@/lib/ops-client-api";

export function OpsQueuesPanel() {
  const [summary, setSummary] = useState<OpsDlqSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void getOpsDlqSummaryClient()
      .then(setSummary)
      .catch((err) => setError(getApiErrorMessageWithHint(err)))
      .finally(() => setLoading(false));
  }, []);

  const boardUrl = getOpsQueuesBoardUrl();

  return (
    <div className="grid min-w-0 grid-cols-1 gap-6">
      <OpsCard>
        <OpsCardHeader
          title="Bull Board"
          description="Opens on the API host — your ops_session cookie must be present."
          actions={
            <a
              href={boardUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(buttonVariants({ size: "sm" }), "inline-flex gap-2")}
            >
              Open queue monitor
              <ExternalLink className="size-4" />
            </a>
          }
        />
        <OpsAlert tone="info">
          If Bull Board shows 401, sign in here first, then open the link in the same browser profile.
        </OpsAlert>
      </OpsCard>

      {loading ? <OpsLoadingBlock label="Loading DLQ summary…" /> : null}
      {error ? <OpsAlert tone="error">{error}</OpsAlert> : null}

      {summary ? (
        <>
          <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
            <OpsStatCard
              label="Dead-letter total"
              value={summary.total}
              hint={summary.total > 0 ? "Needs review" : "Clear"}
              tone={summary.total > 0 ? "warning" : "success"}
            />
            <OpsStatCard
              label="Source queues"
              value={Object.keys(summary.bySourceQueue ?? {}).length}
              tone="muted"
            />
          </div>

          {summary.total > 0 ? (
            <OpsCard>
              <OpsCardHeader title="Breakdown by source queue" />
              <ul className="grid min-w-0 grid-cols-1 gap-2">
                {Object.entries(summary.bySourceQueue ?? {}).map(([queue, count]) => (
                  <li
                    key={queue}
                    className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/20 px-4 py-3 text-sm"
                  >
                    <code>{queue}</code>
                    <OpsBadge tone="warning">{count} jobs</OpsBadge>
                  </li>
                ))}
              </ul>
            </OpsCard>
          ) : (
            <OpsEmptyState
              title="No dead-letter jobs"
              description="DLQ is empty in the current inspection window (waiting + recent completed)."
            />
          )}
        </>
      ) : null}
    </div>
  );
}
