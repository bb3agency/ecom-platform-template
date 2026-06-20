"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { AdminStatusBadge } from "@/components/admin/AdminStatusBadge";
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
  TrendingUp,
  TrendingDown,
} from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  PieChart,
  Pie,
  Cell,
} from "recharts";

function computeTrend(
  current: number,
  previous: number,
): { value: string; up: boolean } | null {
  if (!previous) return null;
  const pct = ((current - previous) / previous) * 100;
  const rounded = Math.round(Math.abs(pct) * 10) / 10;
  return { value: `${pct >= 0 ? "+" : "-"}${rounded}%`, up: pct >= 0 };
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

  const revTrend =
    kpis && prev ? computeTrend(kpis.revenuePaise, prev.revenuePaise) : null;
  const ordTrend =
    kpis && prev ? computeTrend(kpis.ordersCount, prev.ordersCount) : null;
  const custTrend =
    kpis && prev
      ? computeTrend(kpis.customersCount, prev.customersCount)
      : null;
  const aovTrend =
    kpis && prev
      ? computeTrend(kpis.averageOrderValuePaise, prev.averageOrderValuePaise)
      : null;

  return (
    <>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <KpiCard
          label="Total Revenue"
          value={kpis ? formatPaise(kpis.revenuePaise) : "₹0"}
          icon={<Wallet className="h-5 w-5 text-emerald-600" />}
          iconBg="bg-emerald-50"
          trend={revTrend?.value}
          trendUp={revTrend?.up}
          trendLabel={trendLabel}
          loading={loading}
        />
        <KpiCard
          label="Total Orders"
          value={kpis ? String(kpis.ordersCount) : "0"}
          icon={<ShoppingCart className="h-5 w-5 text-blue-600" />}
          iconBg="bg-blue-100"
          trend={ordTrend?.value}
          trendUp={ordTrend?.up}
          trendLabel={trendLabel}
          loading={loading}
        />
        <KpiCard
          label="Total Customers"
          value={kpis ? String(kpis.customersCount) : "0"}
          icon={<Users className="h-5 w-5 text-amber-600" />}
          iconBg="bg-amber-100"
          trend={custTrend?.value}
          trendUp={custTrend?.up}
          trendLabel={trendLabel}
          loading={loading}
        />
        <KpiCard
          label="Avg. Order Value"
          value={kpis ? formatPaise(kpis.averageOrderValuePaise) : "₹0"}
          icon={<Package className="h-5 w-5 text-purple-600" />}
          iconBg="bg-purple-100"
          trend={aovTrend?.value}
          trendUp={aovTrend?.up}
          trendLabel={trendLabel}
          loading={loading}
        />
      </div>
    </>
  );
}

function KpiCard({
  label,
  value,
  icon,
  iconBg,
  trend,
  trendUp,
  trendLabel,
  loading,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  iconBg: string;
  trend?: string;
  trendUp?: boolean;
  trendLabel?: string;
  loading: boolean;
}) {
  return (
    <div className="flex flex-col justify-center rounded-xl border border-border/40 bg-card p-4 sm:p-5 shadow-sm min-w-0">
      <div className="flex items-center gap-3 sm:gap-4">
        <div
          className={`flex h-10 w-10 sm:h-12 sm:w-12 shrink-0 items-center justify-center rounded-xl ${iconBg}`}
        >
          {icon}
        </div>
        <div className="flex flex-col gap-0.5 sm:gap-1 min-w-0">
          <p className="text-[10px] sm:text-xs font-medium text-muted-foreground truncate">{label}</p>
          {loading ? (
            <div className="h-6 sm:h-7 w-16 sm:w-24 animate-pulse rounded bg-muted" />
          ) : (
            <p className="font-heading text-lg sm:text-2xl font-bold tracking-tight text-foreground truncate">
              {value}
            </p>
          )}
        </div>
      </div>
      {!loading && trend !== undefined ? (
        <div className="mt-3 sm:mt-4 flex flex-wrap items-center gap-1 sm:gap-1.5 text-[9px] sm:text-[11px] font-medium">
          {trendUp ? (
            <TrendingUp className="h-3 w-3 text-emerald-600" />
          ) : (
            <TrendingDown className="h-3 w-3 text-rose-500" />
          )}
          <span className={trendUp ? "text-emerald-600" : "text-rose-600"}>
            {trend}
          </span>
          <span className="text-muted-foreground">{trendLabel}</span>
        </div>
      ) : null}
    </div>
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
    <div className="flex flex-col rounded-xl border border-border/40 bg-card p-5 shadow-sm lg:col-span-2">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="font-heading text-lg font-semibold">Sales Overview</h2>
        <select
          className="h-8 rounded-md border border-border/50 bg-background px-2 text-xs text-muted-foreground focus:border-zinc-900 focus:outline-none"
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
        <div className="flex h-[220px] sm:h-[300px] w-full items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-zinc-900 border-t-transparent"></div>
        </div>
      ) : error ? (
        <div className="flex h-[220px] sm:h-[300px] w-full items-center justify-center text-sm text-destructive">
          {error}
        </div>
      ) : points.length === 0 ? (
        <div className="flex h-[220px] sm:h-[300px] w-full items-center justify-center text-sm text-muted-foreground">
          No chart data available yet.
        </div>
      ) : (
        <div className="h-[220px] sm:h-[300px] w-full">
          <AdminResponsiveContainer height="100%">
          <LineChart
            data={chartData}
            margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              vertical={false}
              stroke="#e5e7eb"
            />
            <XAxis
              dataKey="name"
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 11, fill: "#6b7280" }}
              dy={10}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 11, fill: "#6b7280" }}
              tickFormatter={(value) =>
                `${value >= 1000 ? value / 1000 + "k" : value}`
              }
              dx={-10}
            />
            <Tooltip
              content={<CustomTooltip />}
              cursor={{
                stroke: "#10b981",
                strokeWidth: 1,
                strokeDasharray: "5 5",
              }}
            />
            <Line
              type="monotone"
              dataKey="revenue"
              stroke="#10b981"
              strokeWidth={3}
              dot={{ r: 4, fill: "#fff", stroke: "#10b981", strokeWidth: 2 }}
              activeDot={{
                r: 6,
                fill: "#10b981",
                stroke: "#fff",
                strokeWidth: 2,
              }}
            />
          </LineChart>
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
      <div className="rounded-lg border border-border/50 bg-gray-900 px-3 py-2 text-white shadow-xl">
        <p className="text-xs text-gray-300">{label}</p>
        <p className="text-sm font-semibold">
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
    <div className="flex flex-col rounded-xl border border-border/40 bg-card p-5 shadow-sm lg:col-span-2">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="font-heading text-lg font-semibold">
          Top Selling Products
        </h2>
        <Link href="/admin/products">
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs font-medium"
          >
            View All
          </Button>
        </Link>
      </div>

      {loading ? (
        <div className="flex h-[200px] w-full items-center justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-900 border-t-transparent"></div>
        </div>
      ) : error ? (
        <div className="flex h-[200px] w-full items-center justify-center text-sm text-destructive">
          {error}
        </div>
      ) : items.length === 0 ? (
        <div className="flex h-[200px] w-full items-center justify-center text-sm text-muted-foreground">
          No top products available yet.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border/50 text-xs text-muted-foreground">
              <tr>
                <th className="pb-3 pl-2 font-medium">Product</th>
                <th className="pb-3 px-2 font-medium hidden sm:table-cell">Variant</th>
                <th className="pb-3 px-2 font-medium">Sold</th>
                <th className="pb-3 px-2 font-medium">Revenue</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {items.map((item) => (
                <tr key={item.variantId} className="group hover:bg-muted/30">
                  <td className="py-3 pl-2">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted/50 overflow-hidden border border-border/50">
                        {/* Placeholder for product image since it's not in the API response */}
                        <Package className="h-5 w-5 text-muted-foreground/50" />
                      </div>
                      <span className="font-medium">{item.productName}</span>
                    </div>
                  </td>
                  <td className="py-3 px-2 text-muted-foreground hidden sm:table-cell">
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

  // Standard colors from reference design
  const COLORS = [
    "#10b981",
    "#3b82f6",
    "#f59e0b",
    "#8b5cf6",
    "#ec4899",
    "#14b8a6",
    "#9ca3af",
  ];

  const totalRevenue = chartData.reduce((acc, curr) => acc + curr.value, 0);

  return (
    <div className="flex flex-col rounded-xl border border-border/40 bg-card p-5 shadow-sm">
      <h2 className="mb-4 font-heading text-lg font-semibold text-foreground">
        Sales by Category
      </h2>

      {loading ? (
        <div className="flex h-[240px] w-full items-center justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-900 border-t-transparent"></div>
        </div>
      ) : error ? (
        <div className="flex h-[240px] w-full items-center justify-center text-sm text-destructive">
          {error}
        </div>
      ) : chartData.length === 0 ? (
        <div className="flex h-[240px] w-full items-center justify-center text-sm text-muted-foreground">
          No category sales data yet.
        </div>
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
                    />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value: unknown) =>
                    value ? `₹${Number(value).toLocaleString()}` : "₹0"
                  }
                  contentStyle={{
                    background: "#111827",
                    color: "#fff",
                    borderRadius: "8px",
                    border: "none",
                  }}
                />
              </PieChart>
            </AdminResponsiveContainer>
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none">
              <span className="text-[20px] font-bold text-foreground">
                ₹{Math.round(totalRevenue).toLocaleString()}
              </span>
              <span className="text-[9px] uppercase tracking-wider text-muted-foreground font-medium">
                Total Sales
              </span>
            </div>
          </div>

          <div className="flex flex-1 flex-col gap-2.5 w-full">
            {chartData.slice(0, 5).map((item, index) => (
              <div
                key={item.name}
                className="flex items-center justify-between text-sm"
              >
                <div className="flex items-center gap-2">
                  <div
                    className="h-3 w-3 rounded-full shrink-0"
                    style={{ backgroundColor: COLORS[index % COLORS.length] }}
                  />
                  <span className="font-medium text-muted-foreground max-w-[120px] truncate">
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
    <div className="flex flex-col rounded-xl border border-border/40 bg-card p-5 shadow-sm">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="font-heading text-lg font-semibold">Recent Orders</h2>
        <Link href="/admin/orders">
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs font-medium"
          >
            View All
          </Button>
        </Link>
      </div>

      {loading ? (
        <div className="flex h-[240px] w-full items-center justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-900 border-t-transparent"></div>
        </div>
      ) : error ? (
        <div className="flex h-[240px] w-full items-center justify-center text-sm text-destructive">
          {error}
        </div>
      ) : orders.length === 0 ? (
        <div className="flex h-[240px] w-full items-center justify-center text-sm text-muted-foreground">
          No orders yet.
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {orders.map((order) => (
            <div
              key={order.id}
              className="flex items-center justify-between border-b border-border/20 pb-3 last:border-none last:pb-0 gap-2"
            >
              <div className="flex items-center gap-3 min-w-0 flex-1 pr-2">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted/50 border border-border/50">
                  <ShoppingCart className="h-5 w-5 text-muted-foreground/60" />
                </div>
                <div className="min-w-0">
                  <Link
                    href={`/admin/orders/${order.id}`}
                    className="font-semibold text-foreground text-sm hover:underline block truncate"
                  >
                    {order.orderNumber}
                  </Link>
                  <p className="text-xs text-muted-foreground font-medium truncate">
                    {order.customerName}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 sm:gap-4 text-right shrink-0">
                <div className="hidden sm:block">
                  <span className="font-semibold text-sm text-foreground">
                    {formatPaise(order.total)}
                  </span>
                  <p className="text-[10px] text-muted-foreground font-medium truncate max-w-[80px] sm:max-w-none">
                    {order.paymentMode}
                  </p>
                </div>
                <div className="flex flex-col items-end sm:hidden">
                  <span className="font-semibold text-sm text-foreground">
                    {formatPaise(order.total)}
                  </span>
                </div>
                <AdminStatusBadge
                  label={order.status}
                  tone={orderStatusTone(order.status)}
                />
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
    <div className="flex flex-col rounded-xl border border-border/40 bg-card p-5 shadow-sm">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="font-heading text-lg font-semibold">Low Stock Alert</h2>
        <Link href="/admin/inventory">
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs font-medium"
          >
            View All
          </Button>
        </Link>
      </div>

      {loading ? (
        <div className="flex h-[240px] w-full items-center justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-900 border-t-transparent"></div>
        </div>
      ) : error ? (
        <div className="flex h-[240px] w-full items-center justify-center text-sm text-destructive">
          {error}
        </div>
      ) : items.length === 0 ? (
        <div className="flex h-[240px] w-full items-center justify-center text-sm text-zinc-900 font-medium">
          ✓ All inventory stock is healthy
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {items.map((row) => (
            <div
              key={row.id}
              className="flex items-center justify-between border-b border-border/20 pb-3 last:border-none last:pb-0 gap-2"
            >
              <div className="flex items-center gap-3 min-w-0 flex-1 pr-2">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-rose-50 border border-rose-100">
                  <Package className="h-5 w-5 text-rose-500" />
                </div>
                <div className="min-w-0">
                  <p className="font-semibold text-sm text-foreground truncate">
                    {row.variant.product.name}
                  </p>
                  <p className="text-xs text-muted-foreground font-medium truncate">
                    {row.variant.name}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 sm:gap-4 text-right shrink-0">
                <div className="hidden sm:block">
                  <span className="font-bold text-sm text-rose-600">
                    {row.quantity}
                  </span>
                  <p className="text-[10px] text-muted-foreground font-medium">
                    In Stock
                  </p>
                </div>
                <div className="flex flex-col items-end sm:hidden">
                  <span className="font-bold text-sm text-rose-600">
                    {row.quantity}
                  </span>
                </div>
                <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-bold text-rose-600 border border-rose-100 uppercase">
                  Low
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
