"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import { useOpsSession } from "@/components/ops/OpsSessionProvider";
import {
  OpsAlert,
  OpsBadge,
  OpsCard,
  OpsCardHeader,
  OpsLoadingBlock,
  OpsStatCard,
} from "@/components/ops/ui/ops-ui";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatOpsDateTime } from "@/lib/ops-format";
import { getApiErrorMessageWithHint } from "@/lib/error-messages";
import { loadShedBadgeTone } from "@/lib/ops-status-maps";
import { OpsRuntimeReadinessCard } from "@/components/ops/OpsRuntimeReadinessCard";
import {
  getOpsAuditLogsClient,
  getOpsDlqSummaryClient,
  getOpsLoadShedStatusClient,
  getOpsPendingOtps,
  type OpsAuditRecord,
  type OpsLoadShedStatus,
} from "@/lib/ops-client-api";

function formatPermissionsHint(permissions: string[]): string {
  if (permissions.length === 0) {
    return "No permissions";
  }
  if (permissions.length <= 2) {
    return permissions.join(", ");
  }
  return `${permissions.length} permissions (${permissions.slice(0, 2).join(", ")}…)`;
}

export function OpsDashboard() {
  const session = useOpsSession();
  const [loadShed, setLoadShed] = useState<OpsLoadShedStatus | null>(null);
  const [dlqTotal, setDlqTotal] = useState<number | null>(null);
  const [pendingOtps, setPendingOtps] = useState(0);
  const [recentAudit, setRecentAudit] = useState<OpsAuditRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [shed, dlq, otps, audit] = await Promise.all([
          getOpsLoadShedStatusClient(),
          getOpsDlqSummaryClient(),
          getOpsPendingOtps(),
          getOpsAuditLogsClient({ limit: 5 }),
        ]);
        if (!cancelled) {
          setLoadShed(shed);
          setDlqTotal(dlq.total);
          setPendingOtps(Array.isArray(otps.items) ? otps.items.length : 0);
          setRecentAudit(Array.isArray(audit.items) ? audit.items : []);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(getApiErrorMessageWithHint(err));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return <OpsLoadingBlock label="Loading platform overview…" />;
  }

  return (
    <div className="grid min-w-0 grid-cols-1 gap-5 sm:gap-6 lg:gap-8">
      {error ? <OpsAlert tone="error">{error}</OpsAlert> : null}

      <OpsRuntimeReadinessCard />

      <div className="grid min-w-0 grid-cols-1 gap-3 min-[420px]:grid-cols-2 xl:grid-cols-4">
        <OpsStatCard
          label="Load-shed mode"
          value={loadShed?.mode ?? "—"}
          hint={loadShed ? loadShed.mode : undefined}
          tone={loadShed ? loadShedBadgeTone(loadShed.mode) : "muted"}
        />
        <OpsStatCard
          label="DLQ jobs"
          value={dlqTotal ?? "—"}
          hint={dlqTotal && dlqTotal > 0 ? "Review queues" : "Healthy"}
          tone={dlqTotal && dlqTotal > 0 ? "warning" : "success"}
        />
        <OpsStatCard
          label="Pending OTPs"
          value={pendingOtps}
          hint={pendingOtps > 0 ? "In progress" : "None"}
          tone={pendingOtps > 0 ? "info" : "muted"}
        />
        <OpsStatCard
          label="Your access"
          value={session.permissions.length}
          hint={formatPermissionsHint(session.permissions)}
          tone="info"
        />
      </div>

      <div className="grid min-w-0 grid-cols-1 gap-5 lg:grid-cols-2 lg:gap-6">
        <OpsCard className="min-w-0">
          <OpsCardHeader title="Operator profile" description="Live session from GET /ops/session" />
          <dl className="grid min-w-0 grid-cols-1 gap-4 text-sm sm:grid-cols-2">
            <div className="min-w-0">
              <dt className="text-xs uppercase tracking-wider text-muted-foreground">Name</dt>
              <dd className="mt-1 break-words font-medium">{session.name}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs uppercase tracking-wider text-muted-foreground">Email</dt>
              <dd className="mt-1 break-all font-medium">{session.email}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs uppercase tracking-wider text-muted-foreground">Last login</dt>
              <dd className="mt-1 break-words">{formatOpsDateTime(session.lastLoginAt)}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-muted-foreground">MFA</dt>
              <dd className="mt-1">
                <OpsBadge tone={session.mfaEnabled ? "success" : "muted"}>
                  {session.mfaEnabled ? "Enabled" : "Not enabled"}
                </OpsBadge>
              </dd>
            </div>
            <div className="min-w-0 sm:col-span-2">
              <dt className="text-xs uppercase tracking-wider text-muted-foreground">IP allowlist</dt>
              <dd className="mt-1 break-words text-muted-foreground">
                {session.ipAllowlist.length > 0 ? session.ipAllowlist.join(", ") : "None configured"}
              </dd>
            </div>
          </dl>
        </OpsCard>

        <OpsCard className="min-w-0">
          <OpsCardHeader
            title="Recent audit"
            description="Latest privileged actions"
            actions={
              <Link
                href="/ops/audit"
                className={cn(
                  buttonVariants({ variant: "outline", size: "sm" }),
                  "inline-flex w-full justify-center gap-1.5 sm:w-auto",
                )}
              >
                View all
                <ArrowRight className="size-4 shrink-0" />
              </Link>
            }
          />
          {recentAudit.length === 0 ? (
            <p className="text-sm text-muted-foreground">No audit entries yet.</p>
          ) : (
            <ul className="grid min-w-0 grid-cols-1 gap-3">
              {recentAudit.map((entry) => (
                <li
                  key={entry.id}
                  className="flex flex-col gap-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5 sm:flex-row sm:items-start sm:justify-between sm:gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium break-words">
                      {entry.actionType ?? entry.requestPath}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {entry.method} · {formatOpsDateTime(entry.createdAt)}
                    </p>
                  </div>
                  <OpsBadge
                    tone={entry.actionStatus === "EXECUTED" ? "success" : "danger"}
                    className="self-start shrink-0"
                  >
                    {entry.actionStatus}
                  </OpsBadge>
                </li>
              ))}
            </ul>
          )}
        </OpsCard>
      </div>

      <OpsCard className="min-w-0">
        <OpsCardHeader title="Quick links" description="Jump to common control-plane tasks" />
        <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[
            { href: "/ops/config", label: "Runtime config", desc: "Validate and save DB overlay keys" },
            { href: "/ops/queues", label: "Queue monitor", desc: "Bull Board and DLQ summary" },
            { href: "/ops/system", label: "System restart", desc: "Payment-safe rolling restart" },
          ].map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="group min-w-0 rounded-lg border border-border/60 bg-muted/20 p-4 transition-colors hover:border-primary/40 hover:bg-muted/40"
            >
              <p className="font-medium text-foreground group-hover:text-primary">{link.label}</p>
              <p className="mt-1 text-xs text-pretty text-muted-foreground">{link.desc}</p>
            </Link>
          ))}
        </div>
      </OpsCard>
    </div>
  );
}
