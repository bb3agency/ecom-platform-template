"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { KpiCard } from "@/components/admin/ui/kpi-card";
import type {
  AdminDashboardKpis,
  AdminSalesChart,
  AdminSalesChartPoint,
  AdminTopProductItem,
  AdminTopProducts,
  AdminAnalyticsCategoryBreakdown,
  AdminOrderListItem,
  AdminInventoryListItem,
  PaginatedResponse,
} from "@/lib/admin-api";
import {
  buildAdminQuery,
  ensureArray,
  coercePaginatedResponse,
} from "@/lib/admin-api";
import { formatPaise, orderStatusTone } from "@/lib/admin-format";
import { getApiErrorMessage } from "@/lib/error-messages";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import { useAdminDataRefreshEffect } from "@/hooks/use-admin-data-refresh-effect";
import {
  ADMIN_DASHBOARD_REFRESH_SCOPES,
} from "@/lib/admin-data-refresh";
import { AdminResponsiveContainer } from "@/components/admin/AdminResponsiveContainer";
import { prevRange, rangeToISO } from "@/components/admin/AdminDateRangePicker";
import {
  Wallet,
  ShoppingCart,
  Users,
  Package,
  PackageCheck,
  LineChart as LineChartIcon,
  PieChart as PieChartIcon,
} from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  PieChart,
  Pie,
  Cell,
} from "recharts";

/** Percentage delta vs the comparison period, or null when no baseline. */
function computeDelta(current: number, previous: number): number | null {
  if (!previous) return null;
  return ((current - previous) / previous) * 100;
}

export function AdminDashboardKpisPanel({
  from,
  to,
  trendLabel,
}: {
  from: string;
  to: string;
  trendLabel: string;
}) {
  const api = useAuthenticatedApi();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [kpis, setKpis] = useState<AdminDashboardKpis | null>(null);
  const [prev, setPrev] = useState<AdminDashboardKpis | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { fromISO, toISO } = rangeToISO(from, to);
      const prevDates = prevRange(from, to);

      const [current, previous] = await Promise.all([
        api<AdminDashboardKpis>(
          `/admin/dashboard/kpis${buildAdminQuery({ period: "custom", from: fromISO, to: toISO })}`,
        ),
        api<AdminDashboardKpis>(
          `/admin/dashboard/kpis${buildAdminQuery({ period: "custom", from: prevDates.from, to: prevDates.to })}`,
        ),
      ]);
      setKpis(current);
      setPrev(previous);
    } catch (err) {
      setError(getApiErrorMessage(err));
      setKpis(null);
      setPrev(null);
    } finally {
      setLoading(false);
    }
  }, [api, from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  useAdminDataRefreshEffect(load, ADMIN_DASHBOARD_REFRESH_SCOPES);

  const trendOf = (pick: (k: AdminDashboardKpis) => number) => {
    if (!kpis || !prev) return null;
    const delta = computeDelta(pick(kpis), pick(prev));
    return delta === null ? null : { deltaPct: delta, caption: trendLabel };
  };

  return (
    <>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <KpiCard
          label="Total Revenue"
          value={kpis ? formatPaise(kpis.revenuePaise) : "₹0"}
          icon={Wallet}
          trend={trendOf((k) => k.revenuePaise)}
          loading={loading}
        />
        <KpiCard
          label="Total Orders"
          value={kpis ? String(kpis.ordersCount) : "0"}
          icon={ShoppingCart}
          trend={trendOf((k) => k.ordersCount)}
          loading={loading}
        />
        <KpiCard
          label="Total Customers"
          value={kpis ? String(kpis.customersCount) : "0"}
          icon={Users}
          trend={trendOf((k) => k.customersCount)}
          loading={loading}
        />
        <KpiCard
          label="Avg. Order Value"
          value={kpis ? formatPaise(kpis.averageOrderValuePaise) : "₹0"}
          icon={Package}
          trend={trendOf((k) => k.averageOrderValuePaise)}
          loading={loading}
        />
      </div>
    </>
  );
}

export function AdminSalesChartPanel({
  from,
  to,
}: {
  from: string;
  to: string;
}) {
  const api = useAuthenticatedApi();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [chart, setChart] = useState<AdminSalesChart | null>(null);
  const [granularity, setGranularity] = useState<"day" | "week">("day");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { fromISO, toISO } = rangeToISO(from, to);
      const response = await api<AdminSalesChart>(
        `/admin/dashboard/sales-chart${buildAdminQuery({ granularity, from: fromISO, to: toISO })}`,
      );
      setChart(response);
    } catch (err) {
      setError(getApiErrorMessage(err));
      setChart(null);
    } finally {
      setLoading(false);
    }
  }, [api, granularity, from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  useAdminDataRefreshEffect(load, ADMIN_DASHBOARD_REFRESH_SCOPES);

  const points = ensureArray<AdminSalesChartPoint>(chart?.points);

  // Map to recharts data
  const chartData = points.map((p) => ({
    name: p.bucket,
    revenue: p.revenuePaise / 100, // format to rupees for chart
  }));

  return (
    <div className="flex flex-col rounded-2xl border border-border bg-card p-4 transition-shadow hover:shadow-sm sm:p-5 lg:col-span-2">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-sm font-semibold text-foreground">Sales Overview</h2>
        <select
          className="h-8 rounded-md border border-border bg-background px-2 text-xs text-muted-foreground focus:border-primary focus:outline-none"
          value={granularity}
          onChange={(e) =>
            setGranularity(e.target.value as "day" | "week")
          }
        >
          <option value="day">Daily</option>
          <option value="week">Weekly</option>
        </select>
      </div>

      {loading ? (
        <div className="flex h-[220px] w-full items-end gap-2 sm:h-[300px]">
          {/* Skeleton mimicking chart columns */}
          <Skeleton className="h-1/3 flex-1" />
          <Skeleton className="h-2/3 flex-1" />
          <Skeleton className="h-1/2 flex-1" />
          <Skeleton className="h-full flex-1" />
          <Skeleton className="h-2/3 flex-1" />
        </div>
      ) : error ? (
        <div className="flex h-[220px] w-full items-center justify-center text-sm text-destructive sm:h-[300px]">
          {error}
        </div>
      ) : points.length === 0 ? (
        <EmptyState
          icon={LineChartIcon}
          headline="No sales data yet"
          description="Revenue will appear here once orders come in for this period."
          className="h-[220px] py-0 sm:h-[300px]"
        />
      ) : (
        <div className="h-[220px] w-full sm:h-[300px]">
          <AdminResponsiveContainer height="100%">
          <AreaChart
            data={chartData}
            margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
          >
            <defs>
              <linearGradient id="salesRevenueFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.15} />
                <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid
              strokeDasharray="3 3"
              vertical={false}
              stroke="var(--border)"
            />
            <XAxis
              dataKey="name"
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
              dy={10}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
              tickFormatter={(value) =>
                `${value >= 1000 ? value / 1000 + "k" : value}`
              }
              dx={-10}
            />
            <Tooltip
              content={<CustomTooltip />}
              cursor={{
                stroke: "var(--primary)",
                strokeWidth: 1,
                strokeDasharray: "5 5",
              }}
            />
            <Area
              type="monotone"
              dataKey="revenue"
              stroke="var(--primary)"
              strokeWidth={2}
              fill="url(#salesRevenueFill)"
              dot={{ r: 3, fill: "var(--card)", stroke: "var(--primary)", strokeWidth: 2 }}
              activeDot={{
                r: 5,
                fill: "var(--primary)",
                stroke: "var(--card)",
                strokeWidth: 2,
              }}
            />
          </AreaChart>
        </AdminResponsiveContainer>
        </div>
      )}
    </div>
  );
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{ value: number }>;
  label?: string;
}

function CustomTooltip({ active, payload, label }: CustomTooltipProps) {
  if (active && payload && payload.length) {
    return (
      <div className="rounded-lg border border-border bg-card px-3 py-2 shadow-sm">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm font-semibold text-foreground">
          ₹{payload[0].value.toLocaleString()}
        </p>
      </div>
    );
  }
  return null;
}

export function AdminTopProductsPanel({
  from,
  to,
}: {
  from?: string;
  to?: string;
}) {
  const api = useAuthenticatedApi();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<AdminTopProducts | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const extra =
        from && to
          ? (() => {
              const { fromISO, toISO } = rangeToISO(from, to);
              return `&from=${encodeURIComponent(fromISO)}&to=${encodeURIComponent(toISO)}`;
            })()
          : "";
      const response = await api<AdminTopProducts>(
        `/admin/dashboard/top-products?limit=5${extra}`,
      );
      setData(response);
    } catch (err) {
      setError(getApiErrorMessage(err));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [api, from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  useAdminDataRefreshEffect(load, ADMIN_DASHBOARD_REFRESH_SCOPES);

  const items = ensureArray<AdminTopProductItem>(data?.items);

  return (
    <div className="flex flex-col rounded-2xl border border-border bg-card p-4 transition-shadow hover:shadow-sm sm:p-5 lg:col-span-2">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-foreground">
          Top Selling Products
        </h2>
        <Link href="/admin/products" className="text-sm font-medium text-primary hover:underline">
          View all
        </Link>
      </div>

      {loading ? (
        <ListRowsSkeleton rows={5} />
      ) : error ? (
        <div className="flex h-[200px] w-full items-center justify-center text-sm text-destructive">
          {error}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={Package}
          headline="No top products yet"
          description="Best sellers will appear here once orders are placed."
          className="py-8"
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border text-xs text-muted-foreground">
              <tr>
                <th className="pb-3 pl-2 font-medium">Product</th>
                <th className="hidden pb-3 px-2 font-medium sm:table-cell">Variant</th>
                <th className="pb-3 px-2 font-medium">Sold</th>
                <th className="pb-3 px-2 font-medium">Revenue</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {items.map((item) => (
                <tr key={item.variantId} className="group hover:bg-muted/40">
                  <td className="py-3 pl-2">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10">
                        {/* Placeholder for product image since it's not in the API response */}
                        <Package className="h-4 w-4 text-primary" />
                      </div>
                      <span className="font-medium text-foreground">{item.productName}</span>
                    </div>
                  </td>
                  <td className="hidden py-3 px-2 text-muted-foreground sm:table-cell">
                    {item.variantName || "Default"}
                  </td>
                  <td className="py-3 px-2 font-medium">{item.quantitySold}</td>
                  <td className="py-3 px-2 font-medium">
                    {formatPaise(item.revenuePaise)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Skeleton rows that mimic the avatar + two-line list layout. */
function ListRowsSkeleton({ rows }: { rows: number }) {
  return (
    <div className="flex flex-col gap-4">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="h-9 w-9 rounded-full" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-1/3" />
            <Skeleton className="h-3 w-1/4" />
          </div>
          <Skeleton className="h-3.5 w-14" />
        </div>
      ))}
    </div>
  );
}

export function AdminSalesByCategoryPanel({
  from,
  to,
}: {
  from: string;
  to: string;
}) {
  const api = useAuthenticatedApi();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<AdminAnalyticsCategoryBreakdown | null>(
    null,
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { fromISO, toISO } = rangeToISO(from, to);
      const response = await api<AdminAnalyticsCategoryBreakdown>(
        `/admin/analytics/category-breakdown${buildAdminQuery({ from: fromISO, to: toISO })}`,
      );
      setData(response);
    } catch (err) {
      setError(getApiErrorMessage(err));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [api, from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  useAdminDataRefreshEffect(load, ADMIN_DASHBOARD_REFRESH_SCOPES);

  const items = ensureArray<AdminAnalyticsCategoryBreakdown["items"][number]>(
    data?.items,
  );

  // Map data to Recharts format
  const chartData = items.map((item) => ({
    name: item.categoryName,
    value: item.revenuePaise / 100, // Rupees
    percentage: item.sharePercent,
  }));

  // Theme chart tokens (defined in globals.css) — no raw hex.
  const COLORS = [
    "var(--chart-1)",
    "var(--chart-2)",
    "var(--chart-3)",
    "var(--chart-4)",
    "var(--chart-5)",
  ];

  const totalRevenue = chartData.reduce((acc, curr) => acc + curr.value, 0);

  return (
    <div className="flex flex-col rounded-2xl border border-border bg-card p-4 transition-shadow hover:shadow-sm sm:p-5">
      <h2 className="mb-4 text-sm font-semibold text-foreground">
        Sales by Category
      </h2>

      {loading ? (
        <div className="flex items-center gap-6 py-6">
          <Skeleton className="h-[160px] w-[160px] shrink-0 rounded-full" />
          <div className="flex-1 space-y-3">
            <Skeleton className="h-3.5 w-3/4" />
            <Skeleton className="h-3.5 w-2/3" />
            <Skeleton className="h-3.5 w-1/2" />
          </div>
        </div>
      ) : error ? (
        <div className="flex h-[240px] w-full items-center justify-center text-sm text-destructive">
          {error}
        </div>
      ) : chartData.length === 0 ? (
        <EmptyState
          icon={PieChartIcon}
          headline="No category sales yet"
          description="Category share will appear here once orders come in."
          className="py-8"
        />
      ) : (
        <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-around">
          <div className="relative h-[180px] w-[180px] shrink-0">
            <AdminResponsiveContainer width={180} height={180}>
              <PieChart>
                <Pie
                  data={chartData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={80}
                  paddingAngle={2}
                  dataKey="value"
                >
                  {chartData.map((entry, index) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={COLORS[index % COLORS.length]}
                      stroke="var(--card)"
                    />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value: unknown) =>
                    value ? `₹${Number(value).toLocaleString()}` : "₹0"
                  }
                  contentStyle={{
                    background: "var(--card)",
                    color: "var(--foreground)",
                    borderRadius: "8px",
                    border: "1px solid var(--border)",
                  }}
                />
              </PieChart>
            </AdminResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
              <span className="font-heading text-xl font-semibold tracking-tight text-foreground">
                ₹{Math.round(totalRevenue).toLocaleString()}
              </span>
              <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Total Sales
              </span>
            </div>
          </div>

          <div className="flex w-full flex-1 flex-col gap-2.5">
            {chartData.slice(0, 5).map((item, index) => (
              <div
                key={item.name}
                className="flex items-center justify-between text-sm"
              >
                <div className="flex items-center gap-2">
                  <div
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: COLORS[index % COLORS.length] }}
                  />
                  <span className="max-w-[120px] truncate font-medium text-muted-foreground">
                    {item.name}
                  </span>
                </div>
                <span className="font-semibold text-foreground">
                  {item.percentage}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function AdminRecentOrdersPanel() {
  const api = useAuthenticatedApi();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [orders, setOrders] = useState<AdminOrderListItem[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api<PaginatedResponse<AdminOrderListItem>>(
        "/admin/orders?limit=5",
      );
      const coerced = coercePaginatedResponse(response);
      setOrders(coerced.items as AdminOrderListItem[]);
    } catch (err) {
      setError(getApiErrorMessage(err));
      setOrders([]);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  useAdminDataRefreshEffect(load, ADMIN_DASHBOARD_REFRESH_SCOPES);

  return (
    <div className="flex flex-col rounded-2xl border border-border bg-card p-4 transition-shadow hover:shadow-sm sm:p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-foreground">Recent Orders</h2>
        <Link href="/admin/orders" className="text-sm font-medium text-primary hover:underline">
          View all
        </Link>
      </div>

      {loading ? (
        <ListRowsSkeleton rows={5} />
      ) : error ? (
        <div className="flex h-[240px] w-full items-center justify-center text-sm text-destructive">
          {error}
        </div>
      ) : orders.length === 0 ? (
        <EmptyState
          icon={ShoppingCart}
          headline="No orders yet"
          description="New orders will show up here as customers check out."
          className="py-8"
        />
      ) : (
        <div className="flex flex-col gap-4">
          {orders.map((order) => (
            <div
              key={order.id}
              className="flex items-center justify-between gap-2 border-b border-border pb-3 last:border-none last:pb-0"
            >
              <div className="flex min-w-0 flex-1 items-center gap-3 pr-2">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                  {(order.customerName?.trim()?.charAt(0) || "#").toUpperCase()}
                </div>
                <div className="min-w-0">
                  <Link
                    href={`/admin/orders/${order.id}`}
                    className="block truncate text-sm font-semibold text-foreground hover:underline"
                  >
                    {order.orderNumber}
                  </Link>
                  <p className="truncate text-xs text-muted-foreground">
                    {order.customerName}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2 text-right sm:gap-4">
                <div className="hidden sm:block">
                  <span className="text-sm font-semibold text-foreground">
                    {formatPaise(order.total)}
                  </span>
                  <p className="max-w-[80px] truncate text-xs text-muted-foreground sm:max-w-none">
                    {order.paymentMode}
                  </p>
                </div>
                <div className="flex flex-col items-end sm:hidden">
                  <span className="text-sm font-semibold text-foreground">
                    {formatPaise(order.total)}
                  </span>
                </div>
                <Badge variant={orderStatusTone(order.status)} dot>
                  {order.status}
                </Badge>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function AdminLowStockPanel() {
  const api = useAuthenticatedApi();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<AdminInventoryListItem[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api<AdminInventoryListItem[]>(
        "/admin/inventory/low-stock",
      );
      setItems(ensureArray(response).slice(0, 5) as AdminInventoryListItem[]);
    } catch (err) {
      setError(getApiErrorMessage(err));
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  useAdminDataRefreshEffect(load, ADMIN_DASHBOARD_REFRESH_SCOPES);

  return (
    <div className="flex flex-col rounded-2xl border border-border bg-card p-4 transition-shadow hover:shadow-sm sm:p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-foreground">Low Stock Alert</h2>
        <Link href="/admin/inventory" className="text-sm font-medium text-primary hover:underline">
          View all
        </Link>
      </div>

      {loading ? (
        <ListRowsSkeleton rows={5} />
      ) : error ? (
        <div className="flex h-[240px] w-full items-center justify-center text-sm text-destructive">
          {error}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={PackageCheck}
          headline="All stock is healthy"
          description="Variants that fall below their low-stock threshold will appear here."
          className="py-8"
        />
      ) : (
        <div className="flex flex-col gap-4">
          {items.map((row) => (
            <div
              key={row.id}
              className="flex items-center justify-between gap-2 border-b border-border pb-3 last:border-none last:pb-0"
            >
              <div className="flex min-w-0 flex-1 items-center gap-3 pr-2">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-500/10">
                  <Package className="h-4 w-4 text-amber-600" />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-foreground">
                    {row.variant.product.name}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {row.variant.name}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2 text-right sm:gap-4">
                <div className="hidden sm:block">
                  <span className="text-sm font-semibold text-foreground">
                    {row.quantity}
                  </span>
                  <p className="text-xs text-muted-foreground">In Stock</p>
                </div>
                <div className="flex flex-col items-end sm:hidden">
                  <span className="text-sm font-semibold text-foreground">
                    {row.quantity}
                  </span>
                </div>
                <Badge variant={row.quantity === 0 ? "destructive" : "warning"} dot>
                  {row.quantity === 0 ? "Out of Stock" : "Low Stock"}
                </Badge>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
