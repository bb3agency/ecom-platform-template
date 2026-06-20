"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AdminPagination } from "@/components/admin/AdminPagination";
import { AdminTableScroll } from "@/components/admin/AdminTableScroll";

import { Button } from "@/components/ui/button";
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

function calcTrend(
  cur: number,
  prev: number,
): { value: string; up: boolean } | null {
  if (!prev) return null;
  const pct = ((cur - prev) / prev) * 100;
  const abs = Math.round(Math.abs(pct) * 10) / 10;
  return { value: `${pct >= 0 ? "+" : "-"}${abs}%`, up: pct >= 0 };
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

  const totalTrend = customerKpis
    ? calcTrend(customerKpis.total, customerKpis.totalPrev)
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
    <div className="flex flex-col gap-6 min-w-0">
      {/* KPI Cards Row */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <div className="flex flex-col justify-center rounded-xl border border-border/40 bg-card p-4 sm:p-5 shadow-sm min-w-0">
          <div className="flex items-center gap-3 sm:gap-4">
            <div className="flex h-10 w-10 sm:h-12 sm:w-12 shrink-0 items-center justify-center rounded-xl bg-emerald-50">
              <Users className="h-5 w-5 text-emerald-600" />
            </div>
            <div className="flex flex-col gap-0.5 sm:gap-1 min-w-0">
              <p className="text-[10px] sm:text-xs font-medium text-muted-foreground truncate">
                Total Customers
              </p>
              <p className="font-heading text-lg sm:text-2xl font-bold tracking-tight text-foreground truncate">
                {customerKpis
                  ? customerKpis.total.toLocaleString()
                  : kpisLoading
                    ? "…"
                    : "—"}
              </p>
            </div>
          </div>
          <div className="mt-3 sm:mt-4 flex flex-wrap items-center gap-1 sm:gap-1.5 text-[9px] sm:text-[11px] font-medium">
            {kpisLoading ? (
              <div className="h-3 w-20 animate-pulse rounded bg-muted" />
            ) : totalTrend ? (
              <span
                className={totalTrend.up ? "text-emerald-600" : "text-rose-600"}
              >
                {totalTrend.up ? "↑" : "↓"} {totalTrend.value}{" "}
                <span className="text-muted-foreground">{trendLabel}</span>
              </span>
            ) : (
              <span className="text-muted-foreground">vs last week</span>
            )}
          </div>
        </div>

        <div className="flex flex-col justify-center rounded-xl border border-border/40 bg-card p-4 sm:p-5 shadow-sm min-w-0">
          <div className="flex items-center gap-3 sm:gap-4">
            <div className="flex h-10 w-10 sm:h-12 sm:w-12 shrink-0 items-center justify-center rounded-xl bg-blue-100">
              <UserPlus className="h-5 w-5 text-blue-600" />
            </div>
            <div className="flex flex-col gap-0.5 sm:gap-1 min-w-0">
              <p className="text-[10px] sm:text-xs font-medium text-muted-foreground truncate">
                New Customers
              </p>
              <p className="font-heading text-lg sm:text-2xl font-bold tracking-tight text-foreground truncate">
                {customerKpis ? customerKpis.newCount.toLocaleString() : "—"}
              </p>
            </div>
          </div>
          <div className="mt-3 sm:mt-4 flex flex-wrap items-center gap-1 sm:gap-1.5 text-[9px] sm:text-[11px] font-medium">
            <span className="text-muted-foreground">last 7 days</span>
          </div>
        </div>

        <div className="flex flex-col justify-center rounded-xl border border-border/40 bg-card p-4 sm:p-5 shadow-sm min-w-0">
          <div className="flex items-center gap-3 sm:gap-4">
            <div className="flex h-10 w-10 sm:h-12 sm:w-12 shrink-0 items-center justify-center rounded-xl bg-purple-100">
              <ShoppingCart className="h-5 w-5 text-purple-600" />
            </div>
            <div className="flex flex-col gap-0.5 sm:gap-1 min-w-0">
              <p className="text-[10px] sm:text-xs font-medium text-muted-foreground truncate">
                Repeat Customers
              </p>
              <p className="font-heading text-lg sm:text-2xl font-bold tracking-tight text-foreground truncate">
                —
              </p>
            </div>
          </div>
          <div className="mt-3 sm:mt-4 flex flex-wrap items-center gap-1 sm:gap-1.5 text-[9px] sm:text-[11px] font-medium">
            <span className="text-muted-foreground">no direct data</span>
          </div>
        </div>

        <div className="flex flex-col justify-center rounded-xl border border-border/40 bg-card p-4 sm:p-5 shadow-sm min-w-0">
          <div className="flex items-center gap-3 sm:gap-4">
            <div className="flex h-10 w-10 sm:h-12 sm:w-12 shrink-0 items-center justify-center rounded-xl bg-amber-100">
              <UserX className="h-5 w-5 text-amber-600" />
            </div>
            <div className="flex flex-col gap-0.5 sm:gap-1 min-w-0">
              <p className="text-[10px] sm:text-xs font-medium text-muted-foreground truncate">
                Inactive Customers
              </p>
              <p className="font-heading text-lg sm:text-2xl font-bold tracking-tight text-foreground truncate">
                {customerKpis ? customerKpis.banned.toLocaleString() : "—"}
              </p>
            </div>
          </div>
          <div className="mt-3 sm:mt-4 flex flex-wrap items-center gap-1 sm:gap-1.5 text-[9px] sm:text-[11px] font-medium">
            {kpisLoading ? (
              <div className="h-3 w-20 animate-pulse rounded bg-muted" />
            ) : (
              <span className="text-muted-foreground">banned accounts</span>
            )}
          </div>
        </div>
      </div>

      {/* Main Table Section */}
      <div className="flex flex-col rounded-xl border border-border/40 bg-card shadow-sm min-w-0 overflow-hidden">
        <div className="grid grid-cols-2 gap-3 border-b border-border/40 p-4 sm:flex sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <form
            className="relative col-span-2 w-full min-w-0 flex-1 sm:max-w-sm"
            onSubmit={(event) => {
              event.preventDefault();
              setSearch(searchInput.trim());
            }}
          >
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search customers by name, email or phone..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="h-9 w-full rounded-md border border-border/50 bg-background pl-9 pr-4 text-sm focus:border-zinc-900 focus:outline-none"
            />
          </form>

          <div className="flex w-full sm:w-auto">
            <select
              className="h-9 w-full rounded-md border border-border/50 bg-background px-3 text-sm text-muted-foreground focus:border-zinc-900 focus:outline-none sm:w-auto"
              value={banFilter}
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
          <div className="flex h-64 items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-zinc-900 border-t-transparent" />
          </div>
        ) : error ? (
          <div className="flex h-64 items-center justify-center p-4 text-sm text-destructive">
            {error}
          </div>
        ) : items.length === 0 ? (
          <div className="flex h-64 items-center justify-center p-4 text-sm text-muted-foreground">
            No customers found. Try adjusting your filters.
          </div>
        ) : (
          <>
            <AdminTableScroll>
              <table className="w-full min-w-[700px] text-left text-sm">
                <thead className="border-b border-border/40 text-xs font-medium text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 w-10">
                      <input
                        type="checkbox"
                        className="rounded border-border/50 text-zinc-900 focus:ring-zinc-900"
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
                    <th className="px-4 py-3">Email</th>
                    <th className="px-4 py-3">Phone</th>
                    <th className="px-4 py-3 text-center">Total Orders</th>
                    <th className="px-4 py-3 text-right">Total Spent</th>
                    <th className="px-4 py-3 text-center">Status</th>
                    <th className="px-4 py-3">Joined On</th>
                    <th className="px-4 py-3 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {items.map((customer) => (
                    <tr key={customer.id} className="group hover:bg-muted/30">
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          className="rounded border-border/50 text-zinc-900 focus:ring-zinc-900"
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
                          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-200 text-xs font-bold text-zinc-800 uppercase">
                            {customer.firstName?.[0]}
                            {customer.lastName?.[0]}
                          </div>
                          <span className="font-semibold">
                            {customer.firstName} {customer.lastName}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {customer.email ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {customer.phone ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-center font-medium">
                        {customer.totalOrders}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold">
                        {formatPaise(customer.totalSpendPaise)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <div
                          className={`mx-auto inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ${customer.isBanned ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"}`}
                        >
                          <div
                            className={`h-1.5 w-1.5 rounded-full ${customer.isBanned ? "bg-red-500" : "bg-emerald-500"}`}
                          />
                          {customer.isBanned ? "Banned" : "Active"}
                        </div>
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
                              className="h-7 w-7 rounded-md"
                              title="View customer"
                            >
                              <Eye className="h-4 w-4 text-muted-foreground" />
                            </Button>
                          </Link>
                          <Link href={`/admin/customers/${customer.id}`}>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 rounded-md"
                              title="Edit customer"
                            >
                              <Edit2 className="h-4 w-4 text-muted-foreground" />
                            </Button>
                          </Link>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </AdminTableScroll>

            <div className="border-t border-border/40 p-4">
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
