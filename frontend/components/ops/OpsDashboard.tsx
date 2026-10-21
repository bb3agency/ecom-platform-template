"use client";

import Link from "next/link";
import { ChevronRight, CircleCheck, RefreshCw } from "lucide-react";
import { useState } from "react";
import { DEGRADATION_COPY, OpsServiceHealthPanel } from "@/components/ops/OpsServiceHealthPanel";
import { useOpsOverview } from "@/components/ops/use-ops-overview";
import { OpsLinesSkeleton, OpsLoadError, formatRelativeTime } from "@/components/ops/ui/ops-ui";
import {
  ConsolePage,
  KeyValueList,
  Monogram,
  PageHeader,
  Panel,
  StatStrip,
  StatusDot,
  type StatusTone,
} from "@/components/ui/console";
import { Button } from "@/components/ui/button";
import { auditActionLabel, auditStatusTone, loadShedLabel, loadShedTone } from "@/lib/ops-status-maps";
import type { OpsOverview } from "@/lib/ops-client-api";
import type { ReadinessStatus } from "@/types/api";

interface AttentionItem {
  key: string;
  tone: StatusTone;
  text: string;
  href: string;
  cta: string;
}

/** What an operator should look at next, most severe first. */
function buildAttention(overview: OpsOverview, readiness: ReadinessStatus | null): AttentionItem[] {
  const items: AttentionItem[] = [];
  if (readiness && readiness.status !== "ready") {
    items.push({
      key: "health",
      tone: "danger",
      text: DEGRADATION_COPY[readiness.degradationMode],
      href: "#service-health",
      cta: "Details",
    });
  }
  const { loadShed, config, queues, audit, people } = overview;
  if (config.missingRequiredKeys.length > 0) {
    const n = config.missingRequiredKeys.length;
    items.push({
      key: "missing",
      tone: "danger",
      text: `${n} required ${n === 1 ? "setting is" : "settings are"} missing: ${config.missingRequiredKeys.slice(0, 3).join(", ")}${n > 3 ? "…" : ""}`,
      href: "/ops/config?show=missing",
      cta: "Fix settings",
    });
  }
  if (loadShed.mode === "emergency" || loadShed.mode === "reduced") {
    items.push({
      key: "mode",
      tone: loadShed.mode === "emergency" ? "danger" : "warning",
      text: `Traffic is in ${loadShed.mode} mode${loadShed.reason ? ` — “${loadShed.reason}”` : ""}.`,
      href: "/ops/load-shed",
      cta: "Review",
    });
  }
  if (config.restartPendingKeys.length > 0) {
    const n = config.restartPendingKeys.length;
    items.push({
      key: "restart",
      tone: "warning",
      text: `${n} saved ${n === 1 ? "setting waits" : "settings wait"} for a restart before they take effect.`,
      href: "/ops/system",
      cta: "Schedule restart",
    });
  }
  if (queues.deadLetterTotal > 0) {
    items.push({
      key: "dlq",
      tone: "warning",
      text: `${queues.deadLetterTotal} background ${queues.deadLetterTotal === 1 ? "job" : "jobs"} failed after all retries.`,
      href: "/ops/queues",
      cta: "Inspect",
    });
  }
  if (audit.failedLast24h > 0) {
    items.push({
      key: "audit",
      tone: "info",
      text: `${audit.failedLast24h} privileged ${audit.failedLast24h === 1 ? "action" : "actions"} failed in the last 24 hours.`,
      href: "/ops/audit?status=FAILED",
      cta: "View",
    });
  }
  const pendingInvites = people.pendingOpsInvites + people.pendingAdminInvites;
  if (pendingInvites > 0) {
    items.push({
      key: "invites",
      tone: "neutral",
      text: `${pendingInvites} ${pendingInvites === 1 ? "invite is" : "invites are"} waiting to be accepted.`,
      href: "/ops/invites",
      cta: "View",
    });
  }
  return items;
}

export function OpsDashboard() {
  const { overview, error, loading, refreshing, reload } = useOpsOverview(60_000);
  const [readiness, setReadiness] = useState<ReadinessStatus | null>(null);
  const attention = overview ? buildAttention(overview, readiness) : [];
  const failedJobs = overview?.queues.items.reduce((sum, q) => sum + q.failed, 0) ?? 0;

  return (
    <ConsolePage>
      <PageHeader
        title="Overview"
        description="Platform health and anything that needs an operator."
        actions={
          <Button type="button" variant="outline" onClick={() => void reload()} disabled={refreshing} className="gap-1.5">
            <RefreshCw className={refreshing ? "animate-spin" : undefined} aria-hidden />
            Refresh
          </Button>
        }
      />

      {error && !overview ? <OpsLoadError message={error} onRetry={() => void reload()} /> : null}

      <Panel title="Needs attention" flush>
        {loading ? (
          <div className="p-4 sm:p-5">
            <OpsLinesSkeleton lines={2} />
          </div>
        ) : attention.length === 0 && overview ? (
          <p className="flex items-center gap-2 px-4 py-4 text-sm text-muted-foreground sm:px-5">
            <CircleCheck className="size-4 shrink-0 text-success" aria-hidden />
            Nothing needs attention right now.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {attention.map((item) => (
              <li key={item.key} className="min-w-0">
                <Link
                  href={item.href}
                  className="group flex min-w-0 items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50 sm:px-5"
                >
                  {/* Dot and text are separate: .console-status is nowrap, and these lines must wrap. */}
                  <StatusDot tone={item.tone} aria-hidden className="shrink-0 self-start pt-2" />
                  <span className="min-w-0 flex-1 break-words text-sm text-foreground">{item.text}</span>
                  <span className="hidden shrink-0 text-sm font-medium text-primary sm:inline">{item.cta}</span>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <StatStrip
        loading={loading}
        items={[
          {
            label: "Traffic mode",
            value: overview ? (
              <StatusDot tone={loadShedTone(overview.loadShed.mode)} className="text-xl font-semibold sm:text-2xl">
                {loadShedLabel(overview.loadShed)}
              </StatusDot>
            ) : (
              "—"
            ),
            hint: overview?.loadShed.activatedAt ? `Since ${formatRelativeTime(overview.loadShed.activatedAt)}` : undefined,
            href: "/ops/load-shed",
          },
          {
            label: "Failed background jobs",
            value: overview ? overview.queues.deadLetterTotal + failedJobs : "—",
            hint: overview ? `${overview.queues.deadLetterTotal} in dead-letter queue` : undefined,
            href: "/ops/queues",
          },
          {
            label: "Failed actions · 24 h",
            value: overview?.audit.failedLast24h ?? "—",
            href: "/ops/audit?status=FAILED",
          },
          {
            label: "Waiting for restart",
            value: overview?.config.restartPendingKeys.length ?? "—",
            hint: "Saved settings not live yet",
            href: "/ops/system",
          },
        ]}
      />

      <div className="grid min-w-0 grid-cols-1 items-start gap-5 sm:gap-6 lg:grid-cols-5">
        <OpsServiceHealthPanel id="service-health" className="scroll-mt-4 lg:col-span-2" onReadiness={setReadiness} />
        <Panel
          className="lg:col-span-3"
          title="Recent activity"
          flush
          actions={
            <Link href="/ops/audit" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
              Audit log
            </Link>
          }
        >
          {loading ? (
            <div className="p-4 sm:p-5">
              <OpsLinesSkeleton lines={5} />
            </div>
          ) : overview && overview.audit.recent.length > 0 ? (
            <ul className="divide-y divide-border">
              {overview.audit.recent.map((entry) => (
                <li key={entry.id} className="flex min-w-0 items-center gap-3 px-4 py-3 sm:px-5">
                  <Monogram name={entry.actor?.name ?? "?"} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">{auditActionLabel(entry.actionType)}</p>
                    <p className="truncate text-xs text-muted-foreground" title={entry.actor?.email}>
                      {entry.actor?.name ?? "Unknown operator"} · {formatRelativeTime(entry.createdAt)}
                    </p>
                  </div>
                  {entry.actionStatus === "FAILED" ? (
                    <StatusDot tone={auditStatusTone(entry.actionStatus)} className="shrink-0 text-xs">
                      Failed
                    </StatusDot>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-4 py-4 text-sm text-muted-foreground sm:px-5">No privileged actions recorded yet.</p>
          )}
        </Panel>
      </div>

      <Panel title="Access">
        {overview ? (
          <KeyValueList
            className="lg:grid-cols-3"
            items={[
              {
                label: "Operators",
                value: (
                  <Link href="/ops/users" className="hover:underline">
                    {overview.people.operatorsActive} active
                    {overview.people.operatorsTotal > overview.people.operatorsActive
                      ? ` · ${overview.people.operatorsTotal - overview.people.operatorsActive} deactivated`
                      : ""}
                  </Link>
                ),
              },
              {
                label: "Merchant admins",
                value: (
                  <Link href="/ops/admin-users" className="hover:underline">
                    {overview.people.merchantAdminsActive} active
                    {overview.people.merchantAdminsTotal > overview.people.merchantAdminsActive
                      ? ` · ${overview.people.merchantAdminsTotal - overview.people.merchantAdminsActive} deactivated`
                      : ""}
                  </Link>
                ),
              },
              {
                label: "Open invites",
                value: (
                  <Link href="/ops/invites" className="hover:underline">
                    {overview.people.pendingOpsInvites} operator · {overview.people.pendingAdminInvites} merchant admin
                  </Link>
                ),
              },
            ]}
          />
        ) : (
          <OpsLinesSkeleton lines={2} />
        )}
      </Panel>
    </ConsolePage>
  );
}
