"use client";

import { ExternalLink, RefreshCw } from "lucide-react";
import { useOpsOverview } from "@/components/ops/use-ops-overview";
import { OpsLoadError } from "@/components/ops/ui/ops-ui";
import {
  ConsolePage,
  DataTable,
  PageHeader,
  Panel,
  StatStrip,
  StatusDot,
  humanizeEnum,
  type DataColumn,
} from "@/components/ui/console";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getOpsQueuesBoardUrl, type OpsOverview } from "@/lib/ops-client-api";

type QueueRow = OpsOverview["queues"]["items"][number];

function queueLabel(name: string): string {
  return humanizeEnum(name.split("-").join("_"));
}

const columns: DataColumn<QueueRow>[] = [
  {
    key: "name",
    header: "Queue",
    cell: (row) => <span className="font-medium text-foreground">{queueLabel(row.name)}</span>,
    hideOnMobile: true,
  },
  { key: "waiting", header: "Waiting", align: "right", cell: (row) => row.waiting },
  { key: "active", header: "Running", align: "right", cell: (row) => row.active },
  { key: "delayed", header: "Scheduled", align: "right", cell: (row) => row.delayed },
  {
    key: "failed",
    header: "Failed",
    align: "right",
    cell: (row) => (row.failed > 0 ? <span className="font-medium text-destructive">{row.failed}</span> : 0),
  },
];

export function OpsQueuesPanel() {
  const { overview, error, loading, refreshing, reload } = useOpsOverview(30_000);
  const queues = overview?.queues;
  const totals = (queues?.items ?? []).reduce(
    (sum, q) => ({ waiting: sum.waiting + q.waiting, active: sum.active + q.active, failed: sum.failed + q.failed }),
    { waiting: 0, active: 0, failed: 0 },
  );

  return (
    <ConsolePage>
      <PageHeader
        title="Queues"
        description="Background work: emails, shipping, refunds, analytics. Refreshes every 30 seconds."
        actions={
          <>
            <Button type="button" variant="outline" onClick={() => void reload()} disabled={refreshing} className="gap-1.5">
              <RefreshCw className={refreshing ? "animate-spin" : undefined} aria-hidden />
              Refresh
            </Button>
            <a
              href={getOpsQueuesBoardUrl()}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(buttonVariants({ variant: "default" }), "gap-1.5")}
            >
              Open Bull Board
              <ExternalLink aria-hidden />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          </>
        }
      />

      {error && !overview ? <OpsLoadError message={error} onRetry={() => void reload()} /> : null}

      <StatStrip
        loading={loading}
        items={[
          { label: "Waiting", value: totals.waiting },
          { label: "Running", value: totals.active },
          { label: "Failed (retrying)", value: totals.failed },
          { label: "Dead-letter", value: queues?.deadLetterTotal ?? "—", hint: "Gave up after all retries" },
        ]}
      />

      <div className="grid min-w-0 grid-cols-1 items-start gap-5 sm:gap-6 lg:grid-cols-3">
        <Panel title="By queue" flush className="lg:col-span-2">
          <DataTable
            rows={queues?.items ?? []}
            columns={columns}
            rowKey={(row) => row.name}
            loading={loading}
            caption="Job counts by queue"
            mobileCard={(row) => (
              <div className="flex min-w-0 items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{queueLabel(row.name)}</p>
                  <p className="text-xs text-muted-foreground tabular">
                    {row.waiting} waiting · {row.active} running · {row.delayed} scheduled
                  </p>
                </div>
                {row.failed > 0 ? (
                  <StatusDot tone="danger" className="shrink-0">
                    {row.failed} failed
                  </StatusDot>
                ) : null}
              </div>
            )}
            empty={<p className="text-sm text-muted-foreground">No queues are registered on this API.</p>}
          />
        </Panel>

        <Panel
          title="Dead-letter queue"
          description="Jobs that failed every retry, by where they came from."
          flush
        >
          {loading ? null : (queues?.deadLetterBySource.length ?? 0) === 0 ? (
            <p className="px-4 py-4 text-sm text-muted-foreground sm:px-5">Empty — no jobs have given up.</p>
          ) : (
            <ul className="divide-y divide-border">
              {queues?.deadLetterBySource.map((entry) => (
                <li key={entry.queue} className="flex min-w-0 items-center justify-between gap-3 px-4 py-3 sm:px-5">
                  <span className="min-w-0 truncate text-sm text-foreground">{queueLabel(entry.queue)}</span>
                  <span className="shrink-0 text-sm font-medium tabular text-foreground">{entry.count}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <p className="text-sm text-muted-foreground">
        Bull Board opens on the API host and uses your ops session cookie. If it asks you to sign in, sign in here first in the
        same browser.
      </p>
    </ConsolePage>
  );
}
