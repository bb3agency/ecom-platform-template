"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  CheckCircle2,
  XCircle,
  Truck,
  RefreshCcw,
  Clock,
  User,
  Mail,
  Hash,
  Calendar,
  FileText,
  StickyNote,
  Loader2,
  AlertCircle,
  RotateCcw,
  ChevronRight,
} from "lucide-react";
import { AdminLoadingBlock } from "@/components/admin/ui/admin-ui";
import { ensureArray, type AdminReturnRequestDetail, type AdminReturnRequestItem } from "@/lib/admin-api";
import { formatAdminDate, formatPaise } from "@/lib/admin-format";
import { getApiErrorMessageWithHint } from "@/lib/error-messages";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import { useAdminAuth } from "@/contexts/admin-auth-context";
import { ADMIN_PERMISSIONS, hasAdminPermission } from "@/lib/permissions";
import { createIdempotencyKey } from "@/lib/idempotency";
import { cn } from "@/lib/utils";

// ── Status config ─────────────────────────────────────────────────────────────

interface StatusMeta {
  label: string;
  icon: React.ElementType;
  text: string;
  bg: string;
  border: string;
}

const STATUS_META: Record<string, StatusMeta> = {
  REQUESTED: { label: "Requested", icon: Clock, text: "text-amber-700", bg: "bg-amber-50", border: "border-amber-200" },
  APPROVED:  { label: "Approved",  icon: CheckCircle2, text: "text-blue-700", bg: "bg-blue-50", border: "border-blue-200" },
  REJECTED:  { label: "Rejected",  icon: XCircle, text: "text-red-700", bg: "bg-red-50", border: "border-red-200" },
  PICKED_UP: { label: "Picked Up", icon: Truck, text: "text-indigo-700", bg: "bg-indigo-50", border: "border-indigo-200" },
  REFUNDED:  { label: "Refunded",  icon: RefreshCcw, text: "text-emerald-700", bg: "bg-emerald-50", border: "border-emerald-200" },
};

// Status flow order
const STATUS_FLOW = ["REQUESTED", "APPROVED", "PICKED_UP", "REFUNDED"];
const ALL_STATUSES = ["REQUESTED", "APPROVED", "REJECTED", "PICKED_UP", "REFUNDED"];

/**
 * Valid next statuses per current status — mirrors the backend transition guard
 * (OrdersService.RETURN_STATUS_TRANSITIONS). REJECTED and REFUNDED are terminal.
 */
const NEXT_STATUS_OPTIONS: Record<string, string[]> = {
  REQUESTED: ["APPROVED", "REJECTED"],
  APPROVED: ["PICKED_UP", "REJECTED"],
  PICKED_UP: ["REFUNDED"],
  REJECTED: [],
  REFUNDED: [],
};

function StatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[status];
  if (!meta) return <span className="text-xs text-muted-foreground">{status}</span>;
  const Icon = meta.icon;
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold", meta.bg, meta.border, meta.text)}>
      <Icon className="h-3.5 w-3.5" />
      {meta.label}
    </span>
  );
}

// ── Status timeline ───────────────────────────────────────────────────────────

function StatusTimeline({ current }: { current: string }) {
  const isRejected = current === "REJECTED";
  const steps = isRejected
    ? ["REQUESTED", "REJECTED"]
    : STATUS_FLOW;

  const currentIdx = steps.indexOf(current);

  return (
    <div className="flex items-center gap-0">
      {steps.map((step, i) => {
        const meta = STATUS_META[step];
        if (!meta) return null;
        const Icon = meta.icon;
        const done = i <= currentIdx;
        const active = i === currentIdx;
        const isLast = i === steps.length - 1;

        return (
          <div key={step} className="flex items-center">
            <div className="flex flex-col items-center gap-1">
              <div className={cn(
                "flex h-8 w-8 items-center justify-center rounded-full border-2 transition-all",
                active ? cn(meta.bg, meta.border, "shadow-md") :
                done   ? "border-zinc-300 bg-zinc-100" :
                         "border-border/40 bg-muted/30",
              )}>
                <Icon className={cn("h-3.5 w-3.5", active ? meta.text : done ? "text-zinc-500" : "text-muted-foreground/30")} />
              </div>
              <span className={cn("text-[9px] font-semibold whitespace-nowrap", active ? meta.text : done ? "text-zinc-500" : "text-muted-foreground/40")}>
                {meta.label}
              </span>
            </div>
            {!isLast && (
              <div className={cn("h-0.5 w-8 mx-1 mb-4 rounded-full transition-colors", done ? "bg-zinc-300" : "bg-border/30")} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Info row ──────────────────────────────────────────────────────────────────

function InfoRow({ icon: Icon, label, children }: { icon: React.ElementType; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted/50">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
      </div>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
        <div className="text-sm text-foreground">{children}</div>
      </div>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

interface AdminReturnDetailPanelProps {
  returnId: string;
}

export function AdminReturnDetailPanel({ returnId }: AdminReturnDetailPanelProps) {
  const router = useRouter();
  const api = useAuthenticatedApi();
  const { adminUser } = useAdminAuth();
  const canWrite = hasAdminPermission(adminUser, ADMIN_PERMISSIONS.ordersWrite);

  const [detail, setDetail] = useState<AdminReturnRequestDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [adminNote, setAdminNote] = useState("");
  const [nextStatus, setNextStatus] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api<AdminReturnRequestDetail>(`/admin/return-requests/${returnId}`);
      const enriched = { ...response, items: ensureArray(response.items) as AdminReturnRequestItem[] };
      setDetail(enriched);
      setAdminNote(response.adminNote ?? "");
      setNextStatus(response.status);
    } catch (err) {
      setError(getApiErrorMessageWithHint(err));
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }, [api, returnId]);

  useEffect(() => { void load(); }, [load]);

  async function handleUpdate() {
    if (!canWrite) return;
    setSubmitting(true);
    setError(null);
    setSuccessMsg(null);
    try {
      await api(`/admin/return-requests/${returnId}`, {
        method: "PATCH",
        idempotencyKey: createIdempotencyKey(),
        body: JSON.stringify({ status: nextStatus, adminNote: adminNote || undefined }),
      });
      setSuccessMsg("Return request updated successfully.");
      await load();
    } catch (err) {
      setError(getApiErrorMessageWithHint(err));
    } finally {
      setSubmitting(false);
    }
  }

  // ── Loading ──
  if (loading) return <AdminLoadingBlock label="Loading return request…" />;

  // ── Error (no data) ──
  if (error && !detail) {
    return (
      <div className="flex flex-col items-center gap-4 py-16 text-center">
        <AlertCircle className="h-10 w-10 text-destructive/60" />
        <div>
          <p className="font-semibold text-destructive">Failed to load return request</p>
          <p className="mt-1 text-sm text-muted-foreground">{error}</p>
        </div>
        <button type="button" onClick={() => void load()} className="flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted/50">
          <RotateCcw className="h-4 w-4" /> Try again
        </button>
      </div>
    );
  }

  if (!detail) return null;

  return (
    <div className="flex flex-col gap-5">
      {/* ── Back + header ── */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => router.back()}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Back to returns"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="font-mono text-base font-bold text-foreground">{detail.orderNumber}</h1>
            <StatusBadge status={detail.status} />
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">Return request</p>
        </div>
      </div>

      {/* ── Status timeline ── */}
      <div className="flex items-center justify-start rounded-xl border border-border/40 bg-card px-4 py-4 shadow-sm overflow-x-auto">
        <StatusTimeline current={detail.status} />
      </div>

      {/* ── Customer & order info ── */}
      <div className="rounded-xl border border-border/40 bg-card shadow-sm">
        <div className="border-b border-border/40 px-4 py-3">
          <h2 className="text-sm font-semibold text-foreground">Request Details</h2>
        </div>
        <div className="grid gap-4 p-4 sm:grid-cols-2">
          <InfoRow icon={User} label="Customer">
            {detail.customerName}
          </InfoRow>
          <InfoRow icon={Mail} label="Email">
            <a href={`mailto:${detail.customerEmail}`} className="text-primary hover:underline">
              {detail.customerEmail}
            </a>
          </InfoRow>
          <InfoRow icon={Hash} label="Order">
            <Link href={`/admin/orders/${detail.orderId}`} className="inline-flex items-center gap-1 text-primary hover:underline">
              {detail.orderNumber}
              <ChevronRight className="h-3.5 w-3.5" />
            </Link>
          </InfoRow>
          <InfoRow icon={Calendar} label="Requested On">
            {formatAdminDate(detail.createdAt)}
          </InfoRow>
          <div className="sm:col-span-2">
            <InfoRow icon={FileText} label="Return Reason">
              <span className="leading-relaxed">{detail.reason || "—"}</span>
            </InfoRow>
          </div>
          {detail.adminNote && (
            <div className="sm:col-span-2">
              <InfoRow icon={StickyNote} label="Admin Note">
                <span className="leading-relaxed text-muted-foreground">{detail.adminNote}</span>
              </InfoRow>
            </div>
          )}
        </div>
      </div>

      {/* ── Line items ── */}
      <div className="rounded-xl border border-border/40 bg-card shadow-sm overflow-hidden">
        <div className="border-b border-border/40 px-4 py-3">
          <h2 className="text-sm font-semibold text-foreground">
            Items Requested ({detail.items.length})
          </h2>
        </div>
        {detail.items.length === 0 ? (
          <div className="flex h-24 items-center justify-center">
            <p className="text-sm text-muted-foreground">No line items recorded.</p>
          </div>
        ) : (
          <>
            {/* Mobile: cards */}
            <div className="flex flex-col divide-y divide-border/20 lg:hidden">
              {detail.items.map((item, i) => (
                <div key={`${item.orderItemId}-${i}`} className="flex flex-col gap-1.5 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-foreground truncate">
                        {item.productName ?? "Unknown Product"}
                      </p>
                      {item.variantName && (
                        <p className="text-xs text-muted-foreground">{item.variantName}</p>
                      )}
                    </div>
                    <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-semibold">
                      ×{item.quantity}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                    {item.sku && <span>SKU: {item.sku}</span>}
                    {item.unitPrice != null && <span>{formatPaise(item.unitPrice)} each</span>}
                    {item.orderedQuantity != null && <span>Ordered: {item.orderedQuantity}</span>}
                  </div>
                  {item.reason && (
                    <p className="text-xs text-muted-foreground italic">&ldquo;{item.reason}&rdquo;</p>
                  )}
                </div>
              ))}
            </div>

            {/* Desktop: table */}
            <table className="hidden w-full text-left text-sm lg:table">
              <thead className="border-b border-border/20 bg-muted/20">
                <tr>
                  <th className="px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Product</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">SKU</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider text-center">Qty Returned</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider text-center">Qty Ordered</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Unit Price</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Item Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/20">
                {detail.items.map((item, i) => (
                  <tr key={`${item.orderItemId}-${i}`} className="hover:bg-muted/10">
                    <td className="px-4 py-3">
                      <p className="font-medium text-foreground">{item.productName ?? "Unknown"}</p>
                      {item.variantName && (
                        <p className="text-xs text-muted-foreground">{item.variantName}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{item.sku ?? "—"}</td>
                    <td className="px-4 py-3 text-center font-semibold">{item.quantity}</td>
                    <td className="px-4 py-3 text-center text-muted-foreground">{item.orderedQuantity ?? "—"}</td>
                    <td className="px-4 py-3 text-sm">{item.unitPrice != null ? formatPaise(item.unitPrice) : "—"}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground italic max-w-xs">
                      {item.reason ? `"${item.reason}"` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>

      {/* ── Update panel (write permission only) ── */}
      {canWrite && (
        <div className="rounded-xl border border-border/40 bg-card shadow-sm">
          <div className="border-b border-border/40 px-4 py-3">
            <h2 className="text-sm font-semibold text-foreground">Update Request</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">Change status or add an admin note</p>
          </div>
          <div className="p-4 flex flex-col gap-4">
            {/* Success / error banners */}
            {successMsg && (
              <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                <p className="text-sm text-emerald-700 font-medium">{successMsg}</p>
              </div>
            )}
            {error && (
              <div className="flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2.5">
                <AlertCircle className="mt-0.5 h-4 w-4 text-destructive shrink-0" />
                <p className="text-sm text-destructive">{error}</p>
              </div>
            )}

            {/* Status selector as visual pills */}
            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">New Status</label>
              <div className="flex flex-wrap gap-2">
                {ALL_STATUSES.map((status) => {
                  const meta = STATUS_META[status];
                  if (!meta) return null;
                  // Only the current status and its valid next steps are selectable — the
                  // backend rejects anything else with INVALID_STATUS_TRANSITION (409).
                  const allowed =
                    status === detail.status ||
                    (NEXT_STATUS_OPTIONS[detail.status] ?? []).includes(status);
                  if (!allowed) return null;
                  const Icon = meta.icon;
                  const active = nextStatus === status;
                  return (
                    <button
                      key={status}
                      type="button"
                      onClick={() => setNextStatus(status)}
                      className={cn(
                        "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-all",
                        active
                          ? cn(meta.bg, meta.border, meta.text, "shadow-sm")
                          : "border-border/50 bg-muted/20 text-muted-foreground hover:bg-muted/50",
                      )}
                    >
                      <Icon className="h-3 w-3" />
                      {meta.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Admin note */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Admin Note</label>
              <textarea
                value={adminNote}
                onChange={(e) => setAdminNote(e.target.value)}
                placeholder="Optional internal note (e.g. reason for rejection, refund amount, etc.)"
                rows={3}
                maxLength={1000}
                className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2.5 text-sm placeholder:text-muted-foreground/60 focus:border-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-900/10 transition-colors"
              />
              <p className="text-[10px] text-muted-foreground text-right">{adminNote.length}/1000</p>
            </div>

            {/* Submit */}
            <button
              type="button"
              disabled={submitting || nextStatus === detail.status && !adminNote.trim()}
              onClick={() => void handleUpdate()}
              className={cn(
                "flex w-full sm:w-auto sm:min-w-40 items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold transition-all",
                submitting
                  ? "bg-zinc-700 text-white opacity-80"
                  : "bg-zinc-900 text-white hover:bg-zinc-800 shadow-sm active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed",
              )}
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Saving…
                </>
              ) : (
                "Save Changes"
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
