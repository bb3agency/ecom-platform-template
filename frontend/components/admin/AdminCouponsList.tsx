"use client";

import { Fragment, useCallback, useEffect, useState } from "react";

import { AdminCouponAnalyticsPanel } from "@/components/admin/AdminCouponAnalyticsPanel";
import { AdminCouponsStorefrontBanner } from "@/components/admin/AdminCouponsStorefrontBanner";

import { AdminCouponForm } from "@/components/admin/AdminCouponForm";

import { AdminDetailDrawer } from "@/components/admin/AdminDetailDrawer";

import { AdminPagination } from "@/components/admin/AdminPagination";
import { AdminTableScroll } from "@/components/admin/AdminTableScroll";

import { Button } from "@/components/ui/button";

import { useAdminAuth } from "@/contexts/admin-auth-context";

import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import { useAdminDataRefreshEffect } from "@/hooks/use-admin-data-refresh-effect";

import {
  buildAdminQuery,
  coercePaginatedResponse,
  toIsoDateRange,
  type AdminCouponAuditEntry,
  type AdminCouponListItem,
  getPaginatedItems,
  readPaginatedItems,
  type PaginatedResponse,
} from "@/lib/admin-api";

import { formatAdminDate, formatCouponUsageLabel, formatPaise } from "@/lib/admin-format";

import { getApiErrorMessage } from "@/lib/error-messages";

import { createIdempotencyKey } from "@/lib/idempotency";
import { notifyAdminDataChanged } from "@/lib/admin-data-refresh";

import { ADMIN_PERMISSIONS, hasAdminPermission } from "@/lib/permissions";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Search,
  Plus,
  Pause,
  Play,
  Pencil,
  Copy,
  Trash2,
  RotateCcw,
  ScrollText,
  Ticket,
} from "lucide-react";

const PAGE_SIZE = 50;

export function AdminCouponsPageContent({
  from,
  to,
}: {
  from: string;
  to: string;
}) {
  return (
    <div className="grid min-w-0 grid-cols-1 gap-6">
      <AdminCouponsStorefrontBanner />
      {/* The page date range must NOT filter the coupon LIST — it filters by
          createdAt on the backend, so with the default "last 7 days" every
          older coupon (still active!) silently vanished from the table. The
          range scopes only the usage analytics panel below. */}
      <AdminCouponsList />

      <AdminCouponAnalyticsPanel from={from} to={to} />
    </div>
  );
}

export function AdminCouponsList({
  from,
  to,
}: {
  from?: string;
  to?: string;
} = {}) {
  const api = useAuthenticatedApi();

  const { adminUser } = useAdminAuth();

  const canWrite = hasAdminPermission(
    adminUser,
    ADMIN_PERMISSIONS.couponsWrite,
  );

  const [page, setPage] = useState(1);

  const [loading, setLoading] = useState(true);

  const [error, setError] = useState<string | null>(null);

  const [data, setData] =
    useState<PaginatedResponse<AdminCouponListItem> | null>(null);

  const [actionId, setActionId] = useState<string | null>(null);
  const { confirm, confirmDialog } = useConfirm();

  const [showCreate, setShowCreate] = useState(false);

  const [editingCoupon, setEditingCoupon] =
    useState<AdminCouponListItem | null>(null);

  const [auditCoupon, setAuditCoupon] = useState<AdminCouponListItem | null>(
    null,
  );

  const [auditItems, setAuditItems] = useState<AdminCouponAuditEntry[]>([]);

  const [auditLoading, setAuditLoading] = useState(false);
  const [cloneCode, setCloneCode] = useState("");
  const [cloneTargetId, setCloneTargetId] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [selectedIds, setSelectedIds] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setLoading(true);

    setError(null);

    try {
      const backendType =
        typeFilter === "percentage"
          ? "PERCENTAGE_OFF"
          : typeFilter === "fixed"
            ? "FLAT_AMOUNT_OFF"
            : typeFilter === "free_shipping"
              ? "FREE_SHIPPING"
              : undefined;

      const response = await api<PaginatedResponse<AdminCouponListItem>>(
        `/admin/coupons${buildAdminQuery({
          page,
          limit: PAGE_SIZE,
          code: searchInput.trim().toUpperCase() || undefined,
          status: statusFilter || undefined,
          type: backendType,
          from: from ? toIsoDateRange(from) : undefined,
          to: to ? toIsoDateRange(to, true) : undefined,
        })}`,
      );

      setData(coercePaginatedResponse(response));
    } catch (err) {
      setError(getApiErrorMessage(err));

      setData(null);
    } finally {
      setLoading(false);
    }
  }, [api, page, searchInput, statusFilter, typeFilter, from, to]);

  useEffect(() => {
    setPage(1);
  }, [from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  useAdminDataRefreshEffect(load, ["coupons"]);

  async function toggleActive(coupon: AdminCouponListItem) {
    setActionId(coupon.id);

    try {
      await api(`/admin/coupons/${coupon.id}/status`, {
        method: "PATCH",

        idempotencyKey: createIdempotencyKey(),

        body: JSON.stringify({ isActive: !coupon.isActive }),
      });

      await load();
      notifyAdminDataChanged(["coupons", "dashboard"]);
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setActionId(null);
    }
  }

  async function deleteCoupon(coupon: AdminCouponListItem) {
    const ok = await confirm({
      title: "Delete Coupon?",
      description: (
        <>
          Coupon <span className="font-semibold text-foreground">{coupon.code}</span> will be
          removed from the storefront. Deleted coupons stay in this list and can be restored.
        </>
      ),
      confirmLabel: "Delete Coupon",
    });
    if (!ok) return;

    setActionId(coupon.id);

    try {
      await api(`/admin/coupons/${coupon.id}`, {
        method: "DELETE",

        idempotencyKey: createIdempotencyKey(),
      });

      await load();
      notifyAdminDataChanged(["coupons", "dashboard"]);
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setActionId(null);
    }
  }

  async function restoreCoupon(coupon: AdminCouponListItem) {
    setActionId(coupon.id);

    try {
      await api(`/admin/coupons/${coupon.id}/restore`, {
        method: "POST",

        idempotencyKey: createIdempotencyKey(),

        body: JSON.stringify({}),
      });

      await load();
      notifyAdminDataChanged(["coupons", "dashboard"]);
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setActionId(null);
    }
  }

  async function cloneCoupon(coupon: AdminCouponListItem, newCode: string) {
    const code = newCode.trim().toUpperCase();
    if (!code) {
      setError("Enter a code for the cloned coupon.");
      return;
    }
    setActionId(coupon.id);
    try {
      await api(`/admin/coupons/${coupon.id}/clone`, {
        method: "POST",
        idempotencyKey: createIdempotencyKey(),
        body: JSON.stringify({ newCode: code }),
      });
      setCloneCode("");
      setCloneTargetId(null);
      await load();
      notifyAdminDataChanged(["coupons", "dashboard"]);
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setActionId(null);
    }
  }

  async function openAudit(coupon: AdminCouponListItem) {
    setAuditCoupon(coupon);

    setAuditLoading(true);

    try {
      const response = await api<PaginatedResponse<AdminCouponAuditEntry>>(
        `/admin/coupons/${coupon.id}/audit${buildAdminQuery({ page: 1, limit: 20 })}`,
      );

      setAuditItems(getPaginatedItems(response));
    } catch (err) {
      setError(getApiErrorMessage(err));

      setAuditItems([]);
    } finally {
      setAuditLoading(false);
    }
  }

  const rawItems = readPaginatedItems(data);
  const items = rawItems;

  // Modal form: open for create OR edit
  const formOpen = showCreate || Boolean(editingCoupon);
  const formCoupon = editingCoupon ?? null;

  return (
    <>
      {confirmDialog}
      {/* Create / Edit modal */}
      <AdminCouponForm
        open={formOpen}
        coupon={formCoupon}
        onSaved={() => {
          setShowCreate(false);
          setEditingCoupon(null);
          void load();
          notifyAdminDataChanged(["coupons", "dashboard"]);
        }}
        onClose={() => {
          setShowCreate(false);
          setEditingCoupon(null);
        }}
      />

      {error ? (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="mb-4 grid grid-cols-2 gap-3 rounded-xl border border-border/40 bg-card p-4 shadow-sm sm:flex sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-4">
        <div className="col-span-2 flex w-full min-w-0 flex-col gap-3 sm:flex-1 sm:flex-row sm:flex-wrap sm:items-center">
          <div className="relative w-full min-w-0 sm:max-w-sm sm:flex-1">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
            <input
              className="h-9 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring/40"
              placeholder="Search coupons by code..."
              value={searchInput}
              onChange={(e) => {
                setSearchInput(e.target.value);
                setPage(1);
              }}
            />
          </div>

          <select
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-ring/40 sm:w-auto sm:min-w-32"
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All Status</option>
            <option value="active">Active</option>
            <option value="expired">Expired</option>
            <option value="paused">Paused</option>
            <option value="deleted">Deleted</option>
          </select>

          <select
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-ring/40 sm:w-auto sm:min-w-32"
            value={typeFilter}
            onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}
          >
            <option value="">All Types</option>
            <option value="percentage">Percentage</option>
            <option value="fixed">Fixed Amount</option>
            <option value="free_shipping">Free Shipping</option>
          </select>
        </div>

        <div className="flex w-full col-span-2 sm:w-auto sm:col-span-1">
          {canWrite ? (
            <Button
              type="button"
              size="sm"
              className="h-9 w-full gap-2 sm:w-auto"
              onClick={() => setShowCreate(true)}
            >
              <Plus className="h-4 w-4" aria-hidden />
              Create Coupon
            </Button>
          ) : null}
        </div>
      </div>

      {data ? (
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm min-w-0 overflow-hidden">
          {loading ? (
            <div className="mb-4 flex flex-col gap-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex items-center gap-3">
                  <Skeleton className="h-5 w-24 rounded" />
                  <Skeleton className="h-3.5 flex-1" />
                  <Skeleton className="h-5 w-16 rounded-full" />
                </div>
              ))}
            </div>
          ) : null}
          <AdminTableScroll>
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="border-b border-border text-xs font-medium text-muted-foreground">
                <tr>
                  <th className="px-3 py-4 w-10">
                    <input
                      type="checkbox"
                      className="rounded border-border accent-primary focus:ring-ring"
                      checked={
                        items.length > 0 &&
                        items.every((c) => selectedIds[c.id])
                      }
                      onChange={(e) => {
                        const next: Record<string, boolean> = {};
                        items.forEach((c) => {
                          next[c.id] = e.target.checked;
                        });
                        setSelectedIds(next);
                      }}
                    />
                  </th>
                  <th className="px-3 py-4 font-medium">Coupon</th>
                  <th className="px-3 py-4 font-medium">Type</th>
                  <th className="px-3 py-4 font-medium">Discount</th>
                  <th className="px-3 py-4 font-medium">Usage</th>
                  <th className="px-3 py-4 font-medium">Minimum Order</th>
                  <th className="px-3 py-4 font-medium">Validity</th>
                  <th className="px-3 py-4 font-medium">Status</th>
                  <th className="px-3 py-4 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {!loading && items.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-4">
                      <EmptyState
                        icon={Ticket}
                        headline="No coupons created"
                        description="Create your first campaign."
                        className="border-none"
                        action={
                          canWrite ? (
                            <Button type="button" size="sm" onClick={() => setShowCreate(true)}>
                              <Plus className="h-4 w-4" aria-hidden />
                              Create Coupon
                            </Button>
                          ) : undefined
                        }
                      />
                    </td>
                  </tr>
                ) : null}
                {items.map((coupon) => (
                  <Fragment key={coupon.id}>
                    <tr className="group hover:bg-muted/40">
                      <td className="px-3 py-4">
                        <input
                          type="checkbox"
                          className="rounded border-border accent-primary focus:ring-ring"
                          checked={Boolean(selectedIds[coupon.id])}
                          onChange={(e) =>
                            setSelectedIds((prev) => ({
                              ...prev,
                              [coupon.id]: e.target.checked,
                            }))
                          }
                        />
                      </td>
                      <td className="px-3 py-4">
                        <div className="flex flex-col items-start gap-1">
                          <span className="rounded-md border border-border bg-muted px-2.5 py-0.5 font-mono text-sm font-semibold tracking-wider text-foreground uppercase">
                            {coupon.code}
                          </span>
                          <p className="text-xs text-muted-foreground">
                            {coupon.type === "FREE_SHIPPING"
                              ? "Free Shipping"
                              : coupon.type === "PERCENTAGE_OFF"
                                ? `${coupon.value}% discount`
                                : `${formatPaise(coupon.value)} off`}
                          </p>
                        </div>
                      </td>
                      <td className="px-3 py-4">
                        <Badge variant="outline">
                          {coupon.type === "PERCENTAGE_OFF"
                            ? "Percentage"
                            : coupon.type === "FLAT_AMOUNT_OFF"
                              ? "Fixed Amount"
                              : "Free Shipping"}
                        </Badge>
                      </td>
                      <td className="px-3 py-4 font-semibold text-foreground">
                        {coupon.type === "PERCENTAGE_OFF"
                          ? `${coupon.value}% OFF`
                          : coupon.type === "FREE_SHIPPING"
                            ? "Free Shipping"
                            : `${formatPaise(coupon.value)} OFF`}
                      </td>
                      <td className="px-3 py-4">
                        <div className="flex flex-col gap-1.5 w-32">
                          <span className="text-xs font-medium tabular-nums">
                            {formatCouponUsageLabel(
                              coupon.usesCount,
                              coupon.maxUsesTotal,
                            )}
                          </span>
                          {coupon.maxUsesTotal ? (
                            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                              <div
                                className={`h-full rounded-full ${
                                  (coupon.usesCount ?? 0) / coupon.maxUsesTotal >
                                  0.9
                                    ? "bg-red-500"
                                    : (coupon.usesCount ?? 0) /
                                          coupon.maxUsesTotal >
                                        0.7
                                      ? "bg-amber-500"
                                      : "bg-primary"
                                }`}
                                style={{
                                  width: `${Math.min(
                                    100,
                                    Math.round(
                                      ((coupon.usesCount ?? 0) /
                                        coupon.maxUsesTotal) *
                                        100,
                                    ),
                                  )}%`,
                                }}
                              />
                            </div>
                          ) : (
                            <div className="text-[10px] text-muted-foreground">
                              Unlimited
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-4 font-medium text-foreground text-xs">
                        {coupon.minOrderPaise > 0
                          ? formatPaise(coupon.minOrderPaise)
                          : "No min"}
                      </td>
                      <td className="px-3 py-4 text-xs text-muted-foreground whitespace-pre-wrap leading-tight">
                        {formatAdminDate(coupon.validFrom).split(",")[0]} -
                        {coupon.validUntil
                          ? formatAdminDate(coupon.validUntil).split(",")[0]
                          : " No end"}
                      </td>
                      <td className="px-3 py-4">
                        <Badge
                          dot
                          variant={
                            coupon.status === "active"
                              ? "success"
                              : coupon.status === "paused"
                                ? "warning"
                                : (coupon.status as string) === "scheduled"
                                  ? "info"
                                  : coupon.status === "expired"
                                    ? "default"
                                    : "destructive"
                          }
                        >
                          {coupon.status.charAt(0).toUpperCase() +
                            coupon.status.slice(1)}
                        </Badge>
                      </td>
                      <td className="px-3 py-4 text-right">
                        <div className="flex justify-end gap-1.5">
                          {canWrite && coupon.status === "deleted" ? (
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-[11px] font-medium text-foreground hover:bg-muted disabled:opacity-50"
                              disabled={actionId === coupon.id}
                              onClick={() => void restoreCoupon(coupon)}
                            >
                              <RotateCcw className="h-3 w-3" aria-hidden />
                              Restore
                            </button>
                          ) : canWrite ? (
                            <>
                              <button
                                type="button"
                                className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                                title={
                                  coupon.isActive
                                    ? "Pause coupon"
                                    : "Activate coupon"
                                }
                                aria-label={
                                  coupon.isActive
                                    ? "Pause coupon"
                                    : "Activate coupon"
                                }
                                disabled={actionId === coupon.id}
                                onClick={() => void toggleActive(coupon)}
                              >
                                {coupon.isActive ? (
                                  <Pause className="h-3.5 w-3.5" aria-hidden />
                                ) : (
                                  <Play className="h-3.5 w-3.5" aria-hidden />
                                )}
                              </button>
                              <button
                                type="button"
                                className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                                title="Edit coupon"
                                aria-label="Edit coupon"
                                onClick={() => setEditingCoupon(coupon)}
                              >
                                <Pencil className="h-3.5 w-3.5" aria-hidden />
                              </button>
                              <button
                                type="button"
                                className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                                title="Clone coupon"
                                aria-label="Clone coupon"
                                disabled={actionId === coupon.id}
                                onClick={() =>
                                  setCloneTargetId(
                                    cloneTargetId === coupon.id
                                      ? null
                                      : coupon.id,
                                  )
                                }
                              >
                                <Copy className="h-3.5 w-3.5" aria-hidden />
                              </button>
                              <button
                                type="button"
                                className="flex h-7 w-7 items-center justify-center rounded-md border border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/20 disabled:opacity-50"
                                title="Delete coupon"
                                aria-label="Delete coupon"
                                disabled={actionId === coupon.id}
                                onClick={() => void deleteCoupon(coupon)}
                              >
                                <Trash2 className="h-3.5 w-3.5" aria-hidden />
                              </button>
                              <button
                                type="button"
                                className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                                title="View audit log"
                                aria-label="View audit log"
                                onClick={() => void openAudit(coupon)}
                              >
                                <ScrollText className="h-3.5 w-3.5" aria-hidden />
                              </button>
                            </>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                    {cloneTargetId === coupon.id && (
                      <tr className="bg-muted/20">
                        <td colSpan={9} className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">
                              New code:
                            </span>
                            <input
                              type="text"
                              className="h-7 flex-1 max-w-xs rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring/40 uppercase"
                              placeholder={`${coupon.code}-COPY`}
                              value={cloneCode}
                              onChange={(e) =>
                                setCloneCode(e.target.value.toUpperCase())
                              }
                              onKeyDown={(e) => {
                                if (e.key === "Enter")
                                  void cloneCoupon(coupon, cloneCode);
                              }}
                              autoFocus
                            />
                            <Button
                              type="button"
                              size="sm"
                              className="h-7 text-xs"
                              disabled={
                                !cloneCode.trim() || actionId === coupon.id
                              }
                              onClick={() =>
                                void cloneCoupon(coupon, cloneCode)
                              }
                            >
                              Clone
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs"
                              onClick={() => {
                                setCloneTargetId(null);
                                setCloneCode("");
                              }}
                            >
                              Cancel
                            </Button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </AdminTableScroll>
          <div className="mt-6 border-t border-border pt-4">
            <AdminPagination meta={data.meta} onPageChange={setPage} />
          </div>
        </div>
      ) : null}

      <AdminDetailDrawer
        open={Boolean(auditCoupon)}
        title={auditCoupon ? `Audit · ${auditCoupon.code}` : "Audit"}
        onClose={() => {
          setAuditCoupon(null);

          setAuditItems([]);
        }}
      >
        {auditLoading ? (
          <p className="text-sm text-muted-foreground">Loading audit log…</p>
        ) : auditItems.length === 0 ? (
          <p className="text-sm text-muted-foreground">No audit entries.</p>
        ) : (
          <ul className="divide-y divide-border">
            {auditItems.map((entry) => (
              <li key={entry.id} className="py-3 text-sm">
                <p className="font-medium">{entry.action}</p>

                <p className="text-xs text-muted-foreground">
                  {entry.actorName} · {formatAdminDate(entry.createdAt)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </AdminDetailDrawer>
    </>
  );
}
