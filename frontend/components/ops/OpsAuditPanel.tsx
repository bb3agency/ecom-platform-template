"use client";

import { useCallback, useEffect, useState } from "react";
import {
  OpsAlert,
  OpsBadge,
  OpsCard,
  OpsCardHeader,
  OpsDataTable,
  OpsField,
  OpsInput,
  OpsLoadingBlock,
  OpsSelect,
} from "@/components/ops/ui/ops-ui";
import { Button } from "@/components/ui/button";
import { formatOpsDateTime } from "@/lib/ops-format";
import { getApiErrorMessageWithHint } from "@/lib/error-messages";
import { auditStatusTone } from "@/lib/ops-status-maps";
import { getOpsAuditLogsClient, type OpsAuditRecord } from "@/lib/ops-client-api";

export function OpsAuditPanel() {
  const [items, setItems] = useState<OpsAuditRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<"" | "EXECUTED" | "FAILED">("");
  const [actionTypeFilter, setActionTypeFilter] = useState("");

  const load = useCallback(async (showLoading = true) => {
    if (showLoading) {
      setLoading(true);
    }
    try {
      const result = await getOpsAuditLogsClient({
        limit: 50,
        ...(statusFilter ? { actionStatus: statusFilter } : {}),
        ...(actionTypeFilter.trim() ? { actionType: actionTypeFilter.trim() } : {}),
      });
      setItems(Array.isArray(result.items) ? result.items : []);
      setTotal(result.total ?? 0);
      setError(null);
    } catch (err) {
      setError(getApiErrorMessageWithHint(err));
    } finally {
      setLoading(false);
    }
  }, [statusFilter, actionTypeFilter]);

  useEffect(() => {
    void load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initial fetch only
  }, []);

  return (
    <div className="grid gap-6">
      <OpsCard padding="md">
        <div className="grid gap-4 sm:grid-cols-3">
          <OpsField label="Status" htmlFor="audit-status">
            <OpsSelect
              id="audit-status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
            >
              <option value="">All</option>
              <option value="EXECUTED">Executed</option>
              <option value="FAILED">Failed</option>
            </OpsSelect>
          </OpsField>
          <OpsField label="Action type" htmlFor="audit-action">
            <OpsInput
              id="audit-action"
              value={actionTypeFilter}
              onChange={(e) => setActionTypeFilter(e.target.value)}
              placeholder="e.g. config-save"
            />
          </OpsField>
          <div className="flex items-end">
            <Button type="button" variant="outline" onClick={() => void load()} disabled={loading}>
              {loading ? "Loading…" : "Apply filters"}
            </Button>
          </div>
        </div>
      </OpsCard>

      {error ? <OpsAlert tone="error">{error}</OpsAlert> : null}

      <OpsCard>
        <OpsCardHeader title="Audit timeline" description={`${total} total entries (showing ${items.length})`} />
        {loading ? (
          <OpsLoadingBlock label="Loading audit log…" />
        ) : (
          <OpsDataTable
            rows={items}
            rowKey={(row) => row.id}
            emptyTitle="No audit entries"
            columns={[
              {
                key: "when",
                header: "When",
                cell: (row) => formatOpsDateTime(row.createdAt),
              },
              {
                key: "action",
                header: "Action",
                cell: (row) => row.actionType ?? "—",
              },
              {
                key: "status",
                header: "Status",
                cell: (row) => (
                  <OpsBadge tone={auditStatusTone(row.actionStatus)}>{row.actionStatus}</OpsBadge>
                ),
              },
              {
                key: "path",
                header: "Request",
                cell: (row) => (
                  <span className="font-mono text-xs">
                    {row.method} {row.requestPath}
                  </span>
                ),
              },
              {
                key: "req",
                header: "Request ID",
                cell: (row) => <code className="text-xs text-muted-foreground">{row.requestId}</code>,
              },
            ]}
          />
        )}
      </OpsCard>
    </div>
  );
}
