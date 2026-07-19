"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AdminPagination } from "@/components/admin/AdminPagination";
import { AdminTableScroll } from "@/components/admin/AdminTableScroll";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { KpiCard } from "@/components/admin/ui/kpi-card";
import {
  buildAdminQuery,
  coercePaginatedResponse,
  toIsoDateRange,
  type AdminUserListItem,
  readPaginatedItems,
  type PaginatedResponse,
} from "@/lib/admin-api";
import {
  prevRange,
  rangeToISO,
  trendPeriodLabel,
} from "@/components/admin/AdminDateRangePicker";
import { formatAdminDate, formatPaise } from "@/lib/admin-format";
import { getApiErrorMessage } from "@/lib/error-messages";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import { useAdminDataRefreshEffect } from "@/hooks/use-admin-data-refresh-effect";
import {
  Users,
  UserPlus,
  ShoppingCart,
  UserX,
  Search,
  Eye,
  Edit2,
} from "lucide-react";

const PAGE_SIZE = 8; // Match the design's items per page

// ── shared helpers ──────────────────────────────────────────────────────────

function calcTrendPct(cur: number, prev: number): number | null {
  if (!prev) return null;
  return ((cur - prev) / prev) * 100;
}

interface CustomerKpis {
  total: number;
  totalPrev: number;
  newCount: number;
  banned: number;
}

export function AdminCustomersList({
  from,
  to,
}: {
  from: string;
  to: string;
}) {
  const api = useAuthenticatedApi();
  const trendLabel = trendPeriodLabel(from, to);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<PaginatedResponse<AdminUserListItem> | null>(
    null,
  );

  const [selectedIds, setSelectedIds] = useState<Record<string, boolean>>({});
  const [banFilter, setBanFilter] = useState("");

  // ── KPI state ────────────────────────────────────────────────────────────
  const [customerKpis, setCustomerKpis] = useState<CustomerKpis | null>(null);
  const [kpisLoading, setKpisLoading] = useState(true);

  const loadKpis = useCallback(async () => {
    setKpisLoading(true);
    try {
      const { fromISO, toISO } = rangeToISO(from, to);
      const prev = prevRange(from, to);

      const [totalRes, totalPrevRes, bannedRes] = await Promise.all([
        api<PaginatedResponse<AdminUserListItem>>(
          `/admin/users${buildAdminQuery({ limit: 1, from: fromISO, to: toISO })}`,
        ),
        api<PaginatedResponse<AdminUserListItem>>(
          `/admin/users${buildAdminQuery({
            limit: 1,
            from: prev.from,
            to: prev.to,
          })}`,
        ),
        api<PaginatedResponse<AdminUserListItem>>(
          `/admin/users${buildAdminQuery({ limit: 1, banned: true })}`,
        ),
      ]);

      const safeTotal = (r: PaginatedResponse<AdminUserListItem>) =>
        coercePaginatedResponse(r).meta.total;

      const periodTotal = safeTotal(totalRes);
      setCustomerKpis({
        total: periodTotal,
        totalPrev: safeTotal(totalPrevRes),
        newCount: periodTotal,
        banned: safeTotal(bannedRes),
      });
    } catch {
      // keep null
    } finally {
      setKpisLoading(false);
    }
  }, [api, from, to]);

  useEffect(() => {
    void loadKpis();
  }, [loadKpis]);

  useAdminDataRefreshEffect(loadKpis, ["customers", "dashboard"]);

  const totalTrendPct = customerKpis
    ? calcTrendPct(customerKpis.total, customerKpis.totalPrev)
    : null;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api<PaginatedResponse<AdminUserListItem>>(
        `/admin/users${buildAdminQuery({
          page,
          limit: PAGE_SIZE,
          search: search || undefined,
          banned:
            banFilter === "banned"
              ? true
              : banFilter === "active"
                ? false
                : undefined,
          from: toIsoDateRange(from),
          to: toIsoDateRange(to, true),
        })}`,
      );
      setData(coercePaginatedResponse(response));
    } catch (err) {
      setError(getApiErrorMessage(err));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [api, page, search, banFilter, from, to]);

  useEffect(() => {
    setPage(1);
  }, [from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [search, banFilter]);

  const items = readPaginatedItems(data);

  return (
    <div className="flex min-w-0 flex-col gap-6">
      {/* KPI Cards Row */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <KpiCard
          label="Total Customers"
          icon={Users}
          loading={kpisLoading}
          value={customerKpis ? customerKpis.total.toLocaleString() : "—"}
          trend={
            totalTrendPct !== null
              ? { deltaPct: totalTrendPct, caption: trendLabel }
              : null
          }
        />
        <KpiCard
          label="New Customers"
          icon={UserPlus}
          loading={kpisLoading}
          value={customerKpis ? customerKpis.newCount.toLocaleString() : "—"}
        />
        <KpiCard
          label="Repeat Customers"
          icon={ShoppingCart}
          loading={kpisLoading}
          value="—"
        />
        <KpiCard
          label="Banned Customers"
          icon={UserX}
          loading={kpisLoading}
          value={customerKpis ? customerKpis.banned.toLocaleString() : "—"}
        />
      </div>

      {/* Main Table Section */}
      <div className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <div className="grid grid-cols-2 gap-3 border-b border-border p-4 sm:flex sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <form
            className="relative col-span-2 w-full min-w-0 flex-1 sm:max-w-sm"
            onSubmit={(event) => {
              event.preventDefault();
              setSearch(searchInput.trim());
            }}
          >
            <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search customers by name, email or phone..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              aria-label="Search customers"
              className="h-9 w-full rounded-lg border border-border bg-background pl-9 pr-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            />
          </form>

          <div className="flex w-full sm:w-auto">
            <select
              className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 sm:w-auto"
              value={banFilter}
              aria-label="Filter by status"
              onChange={(e) => {
                setBanFilter(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All Status</option>
              <option value="active">Active</option>
              <option value="banned">Banned</option>
            </select>
          </div>
        </div>

        {loading ? (
          <div className="flex flex-col gap-3 p-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="size-9 rounded-full" />
                <div className="flex flex-1 flex-col gap-1.5">
                  <Skeleton className="h-3.5 w-40" />
                  <Skeleton className="h-3 w-56" />
                </div>
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-5 w-20 rounded-full" />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="flex h-64 items-center justify-center p-4 text-sm text-destructive">
            {error}
          </div>
        ) : items.length === 0 ? (
          <div className="p-4">
            <EmptyState
              icon={Users}
              headline="No customers yet"
              description="Customers appear here after their first sign-in or order. Try adjusting your search or filters."
            />
          </div>
        ) : (
          <>
            <AdminTableScroll>
              <table className="w-full min-w-[700px] text-left text-sm">
                <thead className="sticky top-0 z-10 bg-card text-xs font-medium text-muted-foreground shadow-[inset_0_-1px_0_0_var(--color-border)]">
                  <tr>
                    <th className="w-10 px-4 py-3">
                      <input
                        type="checkbox"
                        aria-label="Select all customers"
                        className="rounded border-border accent-primary"
                        checked={
                          items.length > 0 &&
                          items.every((item) => selectedIds[item.id])
                        }
                        onChange={(e) => {
                          const checked = e.target.checked;
                          const next: Record<string, boolean> = {};
                          items.forEach((item) => {
                            next[item.id] = checked;
                          });
                          setSelectedIds(next);
                        }}
                      />
                    </th>
                    <th className="px-4 py-3">Customer</th>
                    <th className="px-4 py-3 text-center">Orders</th>
                    <th className="px-4 py-3 text-right">Lifetime Spend</th>
                    <th className="px-4 py-3 text-center">Status</th>
                    <th className="px-4 py-3">Joined On</th>
                    <th className="px-4 py-3 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {items.map((customer) => (
                    <tr
                      key={customer.id}
                      className="group transition-colors hover:bg-muted/50"
                    >
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          aria-label={`Select ${customer.firstName ?? "customer"}`}
                          className="rounded border-border accent-primary"
                          checked={Boolean(selectedIds[customer.id])}
                          onChange={(e) => {
                            setSelectedIds((prev) => ({
                              ...prev,
                              [customer.id]: e.target.checked,
                            }));
                          }}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold uppercase text-primary">
                            {customer.firstName?.[0]}
                            {customer.lastName?.[0]}
                          </div>
                          <div className="flex min-w-0 flex-col">
                            <span className="truncate font-semibold text-foreground">
                              {customer.firstName} {customer.lastName}
                            </span>
                            <span className="truncate text-xs text-muted-foreground">
                              {customer.email ?? customer.phone ?? "—"}
                              {customer.email && customer.phone
                                ? ` · ${customer.phone}`
                                : ""}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center font-medium text-foreground">
                        {customer.totalOrders}
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-foreground">
                        {formatPaise(customer.totalSpendPaise)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <Badge
                          dot
                          variant={customer.isBanned ? "destructive" : "success"}
                        >
                          {customer.isBanned ? "Banned" : "Active"}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {formatAdminDate(customer.createdAt).split(",")[0]}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-center gap-1">
                          <Link href={`/admin/customers/${customer.id}`}>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-7 rounded-md"
                              title="View customer"
                              aria-label="View customer"
                            >
                              <Eye className="size-4 text-muted-foreground" />
                            </Button>
                          </Link>
                          <Link href={`/admin/customers/${customer.id}`}>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-7 rounded-md"
                              title="Edit customer"
                              aria-label="Edit customer"
                            >
                              <Edit2 className="size-4 text-muted-foreground" />
                            </Button>
                          </Link>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </AdminTableScroll>

            <div className="border-t border-border p-4">
              <AdminPagination
                meta={
                  data?.meta || {
                    page: 1,
                    limit: PAGE_SIZE,
                    total: 0,
                    totalPages: 0,
                  }
                }
                onPageChange={setPage}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
