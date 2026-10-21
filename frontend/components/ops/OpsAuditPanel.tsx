"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { OPS_SIDE_SHEET_CLASS, OpsCodeBlock, OpsLoadError, formatRelativeTime } from "@/components/ops/ui/ops-ui";
import {
  ConsolePage,
  DataTable,
  FilterBar,
  FilterSelect,
  KeyValueList,
  PageHeader,
  Panel,
  StatusDot,
  type DataColumn,
} from "@/components/ui/console";
import { Button } from "@/components/ui/button";
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { formatOpsDateTime } from "@/lib/ops-format";
import { getApiErrorMessageWithHint } from "@/lib/error-messages";
import { AUDIT_ACTION_LABELS, auditActionLabel, auditStatusTone } from "@/lib/ops-status-maps";
import {
  OPS_AUDIT_ACTION_TYPES,
  getOpsAuditLogsClient,
  listOpsUsersClient,
  type OpsAuditActionType,
  type OpsAuditRecord,
  type OpsUserListItem,
} from "@/lib/ops-client-api";

const PAGE_SIZE = 25;

type StatusFilter = "" | "EXECUTED" | "FAILED";

interface OpsAuditPanelProps {
  initialStatus?: StatusFilter;
}

const ACTION_OPTIONS = [
  { value: "", label: "All actions" },
  ...OPS_AUDIT_ACTION_TYPES.map((value) => ({ value, label: AUDIT_ACTION_LABELS[value] ?? value })).sort((a, b) =>
    a.label.localeCompare(b.label),
  ),
];

const STATUS_OPTIONS = [
  { value: "", label: "Any result" },
  { value: "EXECUTED", label: "Succeeded" },
  { value: "FAILED", label: "Failed" },
];

function isActionType(value: string): value is OpsAuditActionType {
  return (OPS_AUDIT_ACTION_TYPES as readonly string[]).includes(value);
}

export function OpsAuditPanel({ initialStatus = "" }: OpsAuditPanelProps) {
  const [items, setItems] = useState<OpsAuditRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<StatusFilter>(initialStatus);
  const [actionType, setActionType] = useState("");
  const [operatorId, setOperatorId] = useState("");
  const [operators, setOperators] = useState<OpsUserListItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<OpsAuditRecord | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getOpsAuditLogsClient({
        page,
        limit: PAGE_SIZE,
        ...(status ? { actionStatus: status } : {}),
        ...(isActionType(actionType) ? { actionType } : {}),
        ...(operatorId ? { opsUserId: operatorId } : {}),
      });
      setItems(Array.isArray(result.items) ? result.items : []);
      setTotal(result.total ?? 0);
      setError(null);
    } catch (err) {
      setError(getApiErrorMessageWithHint(err));
    } finally {
      setLoading(false);
    }
  }, [page, status, actionType, operatorId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    // Operator filter options. Best effort: the log works without them.
    listOpsUsersClient({ limit: 100 })
      .then((result) => setOperators(result.items))
      .catch(() => setOperators([]));
  }, []);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filtersActive = Boolean(status || actionType || operatorId);
  const operatorOptions = useMemo(
    () => [{ value: "", label: "All operators" }, ...operators.map((op) => ({ value: op.id, label: op.name }))],
    [operators],
  );

  function resetTo<T>(setter: (value: T) => void) {
    return (value: T) => {
      setter(value);
      setPage(1);
    };
  }

  const columns: DataColumn<OpsAuditRecord>[] = [
    {
      key: "action",
      header: "Action",
      hideOnMobile: true,
      cell: (row) => (
        <button
          type="button"
          onClick={() => setSelected(row)}
          className="max-w-full text-left text-sm font-medium text-foreground hover:text-primary hover:underline"
        >
          {auditActionLabel(row.actionType)}
        </button>
      ),
    },
    {
      key: "who",
      header: "Operator",
      cell: (row) => (
        <span className="block max-w-56 truncate" title={row.actor?.email}>
          {row.actor?.name ?? "—"}
        </span>
      ),
    },
    {
      key: "result",
      header: "Result",
      cell: (row) => (
        <StatusDot tone={auditStatusTone(row.actionStatus)}>{row.actionStatus === "EXECUTED" ? "Succeeded" : "Failed"}</StatusDot>
      ),
    },
    {
      key: "when",
      header: "When",
      cell: (row) => <span title={formatOpsDateTime(row.createdAt)}>{formatRelativeTime(row.createdAt)}</span>,
    },
    {
      key: "request",
      header: "Request",
      hideBelow: "xl",
      cell: (row) => (
        <span className="block max-w-64 truncate font-mono text-xs text-muted-foreground" title={`${row.method} ${row.requestPath}`}>
          {row.method} {row.requestPath}
        </span>
      ),
    },
  ];

  return (
    <ConsolePage>
      <PageHeader
        title="Audit log"
        description="Every privileged ops action, newest first. Entries are hash-chained and can't be edited."
        actions={
          <Button type="button" variant="outline" onClick={() => void load()} disabled={loading} className="gap-1.5">
            <RefreshCw className={loading ? "animate-spin" : undefined} aria-hidden />
            Refresh
          </Button>
        }
      />

      <FilterBar
        trailing={
          filtersActive ? (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setStatus("");
                setActionType("");
                setOperatorId("");
                setPage(1);
              }}
            >
              Clear filters
            </Button>
          ) : null
        }
      >
        <FilterSelect label="Action" value={actionType} onChange={resetTo(setActionType)} options={ACTION_OPTIONS} />
        <FilterSelect
          label="Result"
          value={status}
          onChange={resetTo((value: string) => setStatus(value as StatusFilter))}
          options={STATUS_OPTIONS}
        />
        {operators.length > 1 ? (
          <FilterSelect label="Operator" value={operatorId} onChange={resetTo(setOperatorId)} options={operatorOptions} />
        ) : null}
      </FilterBar>

      {error ? <OpsLoadError message={error} onRetry={() => void load()} /> : null}

      <Panel
        flush
        footer={
          total > 0 ? (
            <>
              <p className="text-sm text-muted-foreground tabular">
                {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1 || loading}
                  aria-label="Previous page"
                >
                  <ChevronLeft aria-hidden />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                  disabled={page >= pageCount || loading}
                  aria-label="Next page"
                >
                  <ChevronRight aria-hidden />
                </Button>
              </div>
            </>
          ) : undefined
        }
      >
        <DataTable
          rows={items}
          columns={columns}
          rowKey={(row) => row.id}
          loading={loading}
          caption="Ops audit log"
          isSelected={(row) => row.id === selected?.id}
          mobileTitle={(row) => (
            <button
              type="button"
              onClick={() => setSelected(row)}
              className="flex w-full min-w-0 items-center justify-between gap-2 text-left"
            >
              <span className="truncate text-sm font-medium text-foreground">{auditActionLabel(row.actionType)}</span>
              <span className="shrink-0 text-xs font-medium text-primary">Details</span>
            </button>
          )}
          empty={
            <p className="text-sm text-muted-foreground">
              {filtersActive ? "No entries match these filters." : "No privileged actions recorded yet."}
            </p>
          }
        />
      </Panel>

      <Sheet open={selected !== null} onOpenChange={(open) => (!open ? setSelected(null) : undefined)}>
        <SheetContent className={OPS_SIDE_SHEET_CLASS}>
          {selected ? (
            <>
              <SheetHeader>
                <SheetTitle>{auditActionLabel(selected.actionType)}</SheetTitle>
                <SheetDescription>{formatOpsDateTime(selected.createdAt)}</SheetDescription>
              </SheetHeader>
              <SheetBody className="flex flex-col gap-5">
                <KeyValueList
                  className="sm:grid-cols-1"
                  items={[
                    {
                      label: "Result",
                      value: (
                        <StatusDot tone={auditStatusTone(selected.actionStatus)}>
                          {selected.actionStatus === "EXECUTED" ? "Succeeded" : "Failed"}
                        </StatusDot>
                      ),
                    },
                    {
                      label: "Operator",
                      value: selected.actor ? `${selected.actor.name} (${selected.actor.email})` : "—",
                    },
                    { label: "Request", value: <span className="font-mono text-xs">{selected.method} {selected.requestPath}</span> },
                    { label: "Request ID", value: <span className="break-all font-mono text-xs">{selected.requestId}</span> },
                    { label: "Action code", value: <span className="font-mono text-xs">{selected.actionType ?? "—"}</span> },
                  ]}
                />
                {selected.summary && Object.keys(selected.summary).length > 0 ? (
                  <div className="flex min-w-0 flex-col gap-1.5">
                    <p className="text-xs text-muted-foreground">Details recorded</p>
                    <OpsCodeBlock>{JSON.stringify(selected.summary, null, 2)}</OpsCodeBlock>
                  </div>
                ) : null}
              </SheetBody>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </ConsolePage>
  );
}
