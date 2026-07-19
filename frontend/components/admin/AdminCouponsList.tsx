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
            <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
              <svg
                className="w-4 h-4 text-muted-foreground"
                aria-hidden="true"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 20 20"
              >
                <path
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="m19 19-4-4m0-7A7 7 0 1 1 1 8a7 7 0 0 1 14 0Z"
                />
              </svg>
            </div>
            <input
              className="h-9 w-full rounded-md border border-border/50 bg-muted/20 pl-9 pr-3 text-sm focus:border-zinc-900 focus:outline-none"
              placeholder="Search coupons by code..."
              value={searchInput}
              onChange={(e) => {
                setSearchInput(e.target.value);
                setPage(1);
              }}
            />
          </div>

          <select
            className="h-9 w-full rounded-md border border-border/50 bg-muted/20 px-3 text-sm font-medium text-foreground focus:border-zinc-900 focus:outline-none sm:w-auto sm:min-w-32"
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
            className="h-9 w-full rounded-md border border-border/50 bg-muted/20 px-3 text-sm font-medium text-foreground focus:border-zinc-900 focus:outline-none sm:w-auto sm:min-w-32"
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
              className="h-9 w-full gap-2 bg-slate-900 text-white hover:bg-slate-800 sm:w-auto"
              onClick={() => setShowCreate(true)}
            >
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 4v16m8-8H4"
                />
              </svg>
              Create Coupon
            </Button>
          ) : null}
        </div>
      </div>

      {data ? (
        <div className="rounded-xl border border-border/40 bg-card p-5 shadow-sm min-w-0 overflow-hidden">
          {loading ? (
            <div className="flex h-16 items-center justify-center">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-900 border-t-transparent" />
            </div>
          ) : null}
          <AdminTableScroll>
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="border-b border-border/40 text-xs font-medium text-muted-foreground">
                <tr>
                  <th className="px-3 py-4 w-10">
                    <input
                      type="checkbox"
                      className="rounded border-border text-zinc-900 focus:ring-zinc-900"
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
              <tbody className="divide-y divide-border/20">
                {items.map((coupon) => (
                  <Fragment key={coupon.id}>
                    <tr className="group hover:bg-muted/20">
                      <td className="px-3 py-4">
                        <input
                          type="checkbox"
                          className="rounded border-border text-zinc-900 focus:ring-zinc-900"
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
                          <span className="rounded bg-zinc-100 px-2.5 py-0.5 font-mono text-[11px] font-bold tracking-wider text-zinc-900 uppercase border border-zinc-200">
                            {coupon.code}
                          </span>
                          <p className="text-[11px] text-muted-foreground">
                            {coupon.type === "FREE_SHIPPING"
                              ? "Free Shipping"
                              : coupon.type === "PERCENTAGE_OFF"
                                ? `${coupon.value}% discount`
                                : `${formatPaise(coupon.value)} off`}
                          </p>
                        </div>
                      </td>
                      <td className="px-3 py-4">
                        {coupon.type === "PERCENTAGE_OFF" ? (
                          <span className="text-[11px] font-medium text-zinc-900">
                            Percentage
                          </span>
                        ) : coupon.type === "FLAT_AMOUNT_OFF" ? (
                          <span className="text-[11px] font-medium text-amber-600">
                            Fixed Amount
                          </span>
                        ) : (
                          <span className="text-[11px] font-medium text-blue-600">
                            Free Shipping
                          </span>
                        )}
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
                                    ? "bg-rose-500"
                                    : (coupon.usesCount ?? 0) /
                                          coupon.maxUsesTotal >
                                        0.7
                                      ? "bg-amber-500"
                                      : "bg-zinc-900"
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
                      <td className="px-3 py-4 text-[11px] text-muted-foreground whitespace-pre-wrap leading-tight">
                        {formatAdminDate(coupon.validFrom).split(",")[0]} -
                        {coupon.validUntil
                          ? formatAdminDate(coupon.validUntil).split(",")[0]
                          : " No end"}
                      </td>
                      <td className="px-3 py-4">
                        <div className="flex items-center gap-1.5">
                          <div
                            className={`h-1.5 w-1.5 rounded-full ${
                              coupon.status === "active"
                                ? "bg-zinc-900"
                                : coupon.status === "expired"
                                  ? "bg-slate-400"
                                  : (coupon.status as string) === "scheduled"
                                    ? "bg-blue-500"
                                    : "bg-rose-500"
                            }`}
                          />
                          <span
                            className={`text-[11px] font-medium ${
                              coupon.status === "active"
                                ? "text-zinc-900"
                                : coupon.status === "expired"
                                  ? "text-slate-500"
                                  : (coupon.status as string) === "scheduled"
                                    ? "text-blue-600"
                                    : "text-rose-600"
                            }`}
                          >
                            {coupon.status.charAt(0).toUpperCase() +
                              coupon.status.slice(1)}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-4 text-right">
                        <div className="flex justify-end gap-1.5">
                          {canWrite && coupon.status === "deleted" ? (
                            <button
                              type="button"
                              className="rounded border border-zinc-300 bg-zinc-100 px-2 py-1 text-[11px] font-medium text-zinc-900 hover:bg-zinc-200 disabled:opacity-50"
                              disabled={actionId === coupon.id}
                              onClick={() => void restoreCoupon(coupon)}
                            >
                              Restore
                            </button>
                          ) : canWrite ? (
                            <>
                              <button
                                type="button"
                                className="flex h-7 w-7 items-center justify-center rounded border border-border/50 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                                title={
                                  coupon.isActive
                                    ? "Pause coupon"
                                    : "Activate coupon"
                                }
                                disabled={actionId === coupon.id}
                                onClick={() => void toggleActive(coupon)}
                              >
                                {coupon.isActive ? (
                                  <svg
                                    className="h-3.5 w-3.5"
                                    fill="none"
                                    viewBox="0 0 24 24"
                                    stroke="currentColor"
                                  >
                                    <path
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      strokeWidth={2}
                                      d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z"
                                    />
                                  </svg>
                                ) : (
                                  <svg
                                    className="h-3.5 w-3.5"
                                    fill="none"
                                    viewBox="0 0 24 24"
                                    stroke="currentColor"
                                  >
                                    <path
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      strokeWidth={2}
                                      d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"
                                    />
                                    <path
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      strokeWidth={2}
                                      d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                                    />
                                  </svg>
                                )}
                              </button>
                              <button
                                type="button"
                                className="flex h-7 w-7 items-center justify-center rounded border border-border/50 text-muted-foreground hover:bg-muted hover:text-foreground"
                                title="Edit coupon"
                                onClick={() => setEditingCoupon(coupon)}
                              >
                                <svg
                                  className="h-3.5 w-3.5"
                                  fill="none"
                                  viewBox="0 0 24 24"
                                  stroke="currentColor"
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                                  />
                                </svg>
                              </button>
                              <button
                                type="button"
                                className="flex h-7 w-7 items-center justify-center rounded border border-border/50 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                                title="Clone coupon"
                                disabled={actionId === coupon.id}
                                onClick={() =>
                                  setCloneTargetId(
                                    cloneTargetId === coupon.id
                                      ? null
                                      : coupon.id,
                                  )
                                }
                              >
                                <svg
                                  className="h-3.5 w-3.5"
                                  fill="none"
                                  viewBox="0 0 24 24"
                                  stroke="currentColor"
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                                  />
                                </svg>
                              </button>
                              <button
                                type="button"
                                className="flex h-7 w-7 items-center justify-center rounded border border-rose-200 bg-rose-50 text-rose-600 hover:bg-rose-100 disabled:opacity-50"
                                title="Delete coupon"
                                disabled={actionId === coupon.id}
                                onClick={() => void deleteCoupon(coupon)}
                              >
                                <svg
                                  className="h-3.5 w-3.5"
                                  fill="none"
                                  viewBox="0 0 24 24"
                                  stroke="currentColor"
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                                  />
                                </svg>
                              </button>
                              <button
                                type="button"
                                className="flex h-7 w-7 items-center justify-center rounded border border-border/50 text-muted-foreground hover:bg-muted hover:text-foreground"
                                title="View audit log"
                                onClick={() => void openAudit(coupon)}
                              >
                                <svg
                                  className="h-3.5 w-3.5"
                                  fill="none"
                                  viewBox="0 0 24 24"
                                  stroke="currentColor"
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                                  />
                                </svg>
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
                              className="h-7 flex-1 max-w-xs rounded-md border border-border/50 bg-background px-2 text-xs focus:border-zinc-900 focus:outline-none uppercase"
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
                              className="h-7 bg-zinc-900 hover:bg-zinc-800 text-white text-xs"
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
          <div className="mt-6 border-t border-border/40 pt-4">
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
