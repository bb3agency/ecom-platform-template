"use client";

import { useCallback, useEffect, useState, type ComponentType } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  CreditCard,
  LineChart as LineChartIcon,
  MessageSquare,
  Package,
  PackageCheck,
  PackageX,
  RotateCcw,
  ShoppingCart,
  Tags,
} from "lucide-react";
import { Area, AreaChart, CartesianGrid, Tooltip, XAxis, YAxis } from "recharts";

import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Notice,
  Panel,
  StatStrip,
  StatusDot,
  percentChange,
} from "@/components/ui/console";
import { AdminResponsiveContainer } from "@/components/admin/AdminResponsiveContainer";
import { prevRange, rangeToISO } from "@/components/admin/AdminDateRangePicker";
import type {
  AdminActionQueue,
  AdminAnalyticsCategoryBreakdown,
  AdminDashboardKpis,
  AdminInventoryListItem,
  AdminOrderListItem,
  AdminSalesChart,
  AdminSalesChartPoint,
  AdminTopProductItem,
  AdminTopProducts,
  PaginatedResponse,
} from "@/lib/admin-api";
import { buildAdminQuery, coercePaginatedResponse, ensureArray } from "@/lib/admin-api";
import { formatAdminWhen, formatPaise, orderStatusDisplay } from "@/lib/admin-format";
import { getApiErrorMessage } from "@/lib/error-messages";
import { ADMIN_DASHBOARD_REFRESH_SCOPES } from "@/lib/admin-data-refresh";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import { useAdminDataRefreshEffect } from "@/hooks/use-admin-data-refresh-effect";
import { cn } from "@/lib/utils";

/** Shared loader: one request, loading/error state, refresh on admin data changes. */
function useDashboardResource<T>(path: string | null) {
  const api = useAuthenticatedApi();
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    setError(null);
    try {
      setData(await api<T>(path));
    } catch (err) {
      setError(getApiErrorMessage(err));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [api, path]);

  useEffect(() => {
    void load();
  }, [load]);
  useAdminDataRefreshEffect(load, ADMIN_DASHBOARD_REFRESH_SCOPES);

  return { data, loading, error, reload: load };
}

function PanelError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Notice
      tone="danger"
      title="Couldn't load this"
      action={
        <button type="button" onClick={onRetry} className="text-sm font-medium text-foreground underline underline-offset-4">
          Try again
        </button>
      }
    >
      {message}
    </Notice>
  );
}

// ─── Needs attention ─────────────────────────────────────────────────────────

interface QueueItem {
  key: keyof Omit<AdminActionQueue, "generatedAt">;
  label: (n: number) => string;
  href: string;
  icon: ComponentType<{ className?: string }>;
  tone: "brand" | "warning" | "danger";
}

const QUEUE_ITEMS: QueueItem[] = [
  { key: "ordersToFulfil", label: (n) => (n === 1 ? "order to fulfil" : "orders to fulfil"), href: "/admin/orders?status=CONFIRMED&range=all", icon: ShoppingCart, tone: "brand" },
  { key: "ordersProcessing", label: (n) => (n === 1 ? "order being processed" : "orders being processed"), href: "/admin/orders?status=PROCESSING&range=all", icon: Package, tone: "brand" },
  { key: "returnsToReview", label: (n) => (n === 1 ? "return to review" : "returns to review"), href: "/admin/returns?status=REQUESTED", icon: RotateCcw, tone: "warning" },
  { key: "outOfStockVariants", label: (n) => (n === 1 ? "variant out of stock" : "variants out of stock"), href: "/admin/inventory?stock=out", icon: PackageX, tone: "danger" },
  { key: "lowStockVariants", label: (n) => (n === 1 ? "variant running low" : "variants running low"), href: "/admin/inventory?stock=low", icon: AlertTriangle, tone: "warning" },
  { key: "ordersAwaitingPayment", label: (n) => (n === 1 ? "order awaiting payment" : "orders awaiting payment"), href: "/admin/orders?status=PENDING_PAYMENT&range=all", icon: CreditCard, tone: "warning" },
  { key: "reviewsToModerate", label: (n) => (n === 1 ? "review to moderate" : "reviews to moderate"), href: "/admin/reviews?approved=false", icon: MessageSquare, tone: "warning" },
];

const QUEUE_ICON_TONE: Record<QueueItem["tone"], string> = {
  brand: "bg-primary/10 text-primary",
  warning: "console-notice text-foreground",
  danger: "console-notice text-destructive",
};

/** The dashboard opens with what needs doing, each count linking to the filtered list. */
export function AdminActionQueuePanel() {
  const { data, loading, error, reload } = useDashboardResource<AdminActionQueue>("/admin/dashboard/action-queue");
  const anyPending = data ? QUEUE_ITEMS.some((item) => data[item.key] > 0) : false;

  return (
    <Panel title="Needs attention" flush>
      {loading && !data ? (
        <div className="grid grid-cols-1 gap-px bg-border sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 bg-card p-4 sm:px-5">
              <Skeleton className="size-9 rounded-lg" />
              <Skeleton className="h-4 w-40" />
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="p-4 sm:p-5">
          <PanelError message={error} onRetry={() => void reload()} />
        </div>
      ) : !anyPending ? (
        <div className="flex items-center gap-3 p-4 sm:px-5">
          <CheckCircle2 className="size-5 shrink-0 text-success" aria-hidden />
          <p className="text-sm text-muted-foreground">
            You&apos;re all caught up. New orders and returns will show up here.
          </p>
        </div>
      ) : (
        // Each cell draws its own right/bottom hairline; the negative margin tucks the
        // outer edge under the panel border, so any item count leaves no gaps.
        <ul className="-mb-px -mr-px grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {QUEUE_ITEMS.map((item) => {
            const count = data?.[item.key] ?? 0;
            if (count === 0) {
              // Cleared items stay in place (stable layout) but go quiet and aren't links.
              return (
                <li key={item.key} className="flex min-w-0 items-center gap-3 border-b border-r border-border bg-card p-4 sm:px-5">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                    <item.icon className="size-4.5" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1 text-sm text-muted-foreground">
                    <span className="tabular">0</span> {item.label(0)}
                  </span>
                  <CheckCircle2 className="size-4 shrink-0 text-success" aria-label="Clear" />
                </li>
              );
            }
            return (
              <li key={item.key} className="min-w-0 border-b border-r border-border bg-card">
                <Link
                  href={item.href}
                  className="group flex min-w-0 items-center gap-3 p-4 transition-colors hover:bg-muted/50 sm:px-5"
                >
                  <span
                    data-tone={item.tone === "danger" ? "danger" : "warning"}
                    className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", QUEUE_ICON_TONE[item.tone])}
                  >
                    <item.icon className="size-4.5" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1 text-sm text-foreground">
                    <span className="font-semibold tabular">{count.toLocaleString("en-IN")}</span>{" "}
                    {item.label(count)}
                  </span>
                  <ArrowRight
                    className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                    aria-hidden
                  />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

// ─── KPIs ────────────────────────────────────────────────────────────────────

export function AdminDashboardKpisPanel({ from, to, trendLabel }: { from: string; to: string; trendLabel: string }) {
  const { fromISO, toISO } = rangeToISO(from, to);
  const prevDates = prevRange(from, to);
  const current = useDashboardResource<AdminDashboardKpis>(
    `/admin/dashboard/kpis${buildAdminQuery({ period: "custom", from: fromISO, to: toISO })}`,
  );
  const previous = useDashboardResource<AdminDashboardKpis>(
    `/admin/dashboard/kpis${buildAdminQuery({ period: "custom", from: prevDates.from, to: prevDates.to })}`,
  );
  const k = current.data;
  const p = previous.data;
  const delta = (pick: (x: AdminDashboardKpis) => number) => (k && p ? percentChange(pick(k), pick(p)) : null);

  if (current.error) return <PanelError message={current.error} onRetry={() => void current.reload()} />;

  return (
    <StatStrip
      loading={current.loading && !k}
      items={[
        { label: "Revenue", value: formatPaise(k?.revenuePaise ?? 0), deltaPct: delta((x) => x.revenuePaise), deltaCaption: trendLabel },
        { label: "Orders", value: (k?.ordersCount ?? 0).toLocaleString("en-IN"), deltaPct: delta((x) => x.ordersCount), deltaCaption: trendLabel, href: "/admin/orders" },
        { label: "Average order", value: formatPaise(k?.averageOrderValuePaise ?? 0), deltaPct: delta((x) => x.averageOrderValuePaise), deltaCaption: trendLabel },
        { label: "New customers", value: (k?.customersCount ?? 0).toLocaleString("en-IN"), deltaPct: delta((x) => x.customersCount), deltaCaption: trendLabel, href: "/admin/customers" },
      ]}
    />
  );
}

// ─── Sales chart ─────────────────────────────────────────────────────────────

function formatBucketLabel(bucket: string): string {
  const date = new Date(`${bucket.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return bucket;
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short" }).format(date);
}

function compactRupees(value: number): string {
  if (value >= 100000) return `₹${Math.round(value / 1000) / 100}L`;
  if (value >= 1000) return `₹${Math.round(value / 100) / 10}k`;
  return `₹${value}`;
}

export function AdminSalesChartPanel({ from, to, className }: { from: string; to: string; className?: string }) {
  const [granularity, setGranularity] = useState<"day" | "week">("day");
  const { fromISO, toISO } = rangeToISO(from, to);
  const { data, loading, error, reload } = useDashboardResource<AdminSalesChart>(
    `/admin/dashboard/sales-chart${buildAdminQuery({ granularity, from: fromISO, to: toISO })}`,
  );
  const points = ensureArray<AdminSalesChartPoint>(data?.points);
  const chartData = points.map((p) => ({ name: formatBucketLabel(p.bucket), revenue: p.revenuePaise / 100, orders: p.ordersCount }));
  const total = points.reduce((sum, p) => sum + p.revenuePaise, 0);
  const hasSales = points.some((p) => p.revenuePaise > 0);

  return (
    <Panel
      className={className}
      title="Sales"
      description={!loading && hasSales ? `${formatPaise(total)} in this period` : undefined}
      actions={
        <div role="group" aria-label="Chart interval" className="inline-flex rounded-lg border border-input p-0.5">
          {(["day", "week"] as const).map((g) => (
            <button
              key={g}
              type="button"
              data-size-locked
              aria-pressed={granularity === g}
              onClick={() => setGranularity(g)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                granularity === g ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {g === "day" ? "Daily" : "Weekly"}
            </button>
          ))}
        </div>
      }
    >
      {loading && !data ? (
        <Skeleton className="h-56 w-full sm:h-72" />
      ) : error ? (
        <PanelError message={error} onRetry={() => void reload()} />
      ) : !hasSales ? (
        <EmptyState
          icon={LineChartIcon}
          headline="No sales in this period"
          description="Pick a wider date range, or check back once orders come in."
          className="h-56 border-0 sm:h-72"
        />
      ) : (
        <div className="h-56 w-full min-w-0 sm:h-72">
          <AdminResponsiveContainer height="100%">
            <AreaChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="salesRevenueFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.12} />
                  <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="var(--border)" />
              <XAxis
                dataKey="name"
                axisLine={false}
                tickLine={false}
                minTickGap={24}
                tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
                dy={8}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                width={52}
                tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
                tickFormatter={(value: number) => compactRupees(value)}
              />
              <Tooltip content={<SalesTooltip />} cursor={{ stroke: "var(--border)", strokeWidth: 1 }} />
              <Area
                type="monotone"
                dataKey="revenue"
                stroke="var(--primary)"
                strokeWidth={2}
                fill="url(#salesRevenueFill)"
                isAnimationActive={false}
                dot={false}
                activeDot={{ r: 4, fill: "var(--primary)", stroke: "var(--card)", strokeWidth: 2 }}
              />
            </AreaChart>
          </AdminResponsiveContainer>
        </div>
      )}
    </Panel>
  );
}

interface SalesTooltipProps {
  active?: boolean;
  payload?: Array<{ value: number; payload?: { orders?: number } }>;
  label?: string;
}

function SalesTooltip({ active, payload, label }: SalesTooltipProps) {
  if (!active || !payload?.length) return null;
  const orders = payload[0].payload?.orders ?? 0;
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 text-popover-foreground shadow-md">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold tabular">₹{payload[0].value.toLocaleString("en-IN")}</p>
      <p className="text-xs text-muted-foreground tabular">
        {orders} {orders === 1 ? "order" : "orders"}
      </p>
    </div>
  );
}

// ─── Lists ───────────────────────────────────────────────────────────────────

function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="divide-y divide-border">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3 sm:px-5">
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-2/5" />
            <Skeleton className="h-3 w-1/4" />
          </div>
          <Skeleton className="h-3.5 w-14" />
        </div>
      ))}
    </div>
  );
}

function ViewAll({ href, label = "View all" }: { href: string; label?: string }) {
  return (
    <Link href={href} className="text-sm font-medium text-primary hover:underline">
      {label}
    </Link>
  );
}

export function AdminRecentOrdersPanel({ className }: { className?: string }) {
  const { data, loading, error, reload } = useDashboardResource<PaginatedResponse<AdminOrderListItem>>(
    "/admin/orders?limit=6",
  );
  const orders = data ? (coercePaginatedResponse(data).items as AdminOrderListItem[]) : [];

  return (
    <Panel className={className} title="Latest orders" actions={<ViewAll href="/admin/orders" />} flush>
      {loading && !data ? (
        <ListSkeleton rows={6} />
      ) : error ? (
        <div className="p-4 sm:p-5">
          <PanelError message={error} onRetry={() => void reload()} />
        </div>
      ) : orders.length === 0 ? (
        <EmptyState
          icon={ShoppingCart}
          headline="No orders yet"
          description="Orders appear here the moment a customer checks out."
          className="m-4 sm:m-5"
        />
      ) : (
        <ul className="divide-y divide-border">
          {orders.map((order) => {
            const status = orderStatusDisplay(order.status);
            return (
              <li key={order.id} className="min-w-0">
                <Link
                  href={`/admin/orders/${order.id}`}
                  className="flex min-w-0 items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50 sm:px-5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">
                      {order.customerName?.trim() || "Guest"}
                    </p>
                    <p className="truncate text-xs text-muted-foreground tabular">
                      {formatAdminWhen(order.createdAt)} · {order.orderNumber}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className="text-sm font-semibold text-foreground tabular">{formatPaise(order.total)}</span>
                    <StatusDot tone={status.tone} className="text-xs text-muted-foreground">
                      {status.label}
                    </StatusDot>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

export function AdminTopProductsPanel({ from, to, className }: { from?: string; to?: string; className?: string }) {
  const range = from && to ? rangeToISO(from, to) : null;
  const { data, loading, error, reload } = useDashboardResource<AdminTopProducts>(
    `/admin/dashboard/top-products${buildAdminQuery({ limit: 5, ...(range ? { from: range.fromISO, to: range.toISO } : {}) })}`,
  );
  const items = ensureArray<AdminTopProductItem>(data?.items);
  const max = Math.max(1, ...items.map((i) => i.revenuePaise));

  return (
    <Panel className={className} title="Best sellers" actions={<ViewAll href="/admin/products" label="All products" />} flush>
      {loading && !data ? (
        <ListSkeleton />
      ) : error ? (
        <div className="p-4 sm:p-5">
          <PanelError message={error} onRetry={() => void reload()} />
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={Package}
          headline="No sales in this period"
          description="Your best-selling products will be ranked here."
          className="m-4 sm:m-5"
        />
      ) : (
        <ol className="divide-y divide-border">
          {items.map((item, index) => (
            <li key={item.variantId} className="flex min-w-0 items-center gap-3 px-4 py-3 sm:px-5">
              <span className="w-4 shrink-0 text-sm text-muted-foreground tabular">{index + 1}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">
                  {item.productName}
                  {item.variantName ? <span className="font-normal text-muted-foreground"> · {item.variantName}</span> : null}
                </p>
                <ShareBar fraction={item.revenuePaise / max} />
              </div>
              <div className="shrink-0 text-right">
                <p className="text-sm font-semibold text-foreground tabular">{formatPaise(item.revenuePaise)}</p>
                <p className="text-xs text-muted-foreground tabular">{item.quantitySold} sold</p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

/** Thin proportional bar drawn in SVG (no inline styles — CSP forbids them). */
function ShareBar({ fraction, tone = "primary" }: { fraction: number; tone?: "primary" | "muted" }) {
  const pct = Math.max(2, Math.min(100, Math.round(fraction * 100)));
  return (
    <svg viewBox="0 0 100 4" preserveAspectRatio="none" className="mt-1.5 h-1 w-full" aria-hidden>
      <rect width="100" height="4" rx="2" className="fill-muted" />
      <rect width={pct} height="4" rx="2" className={tone === "primary" ? "fill-primary" : "fill-muted-foreground"} />
    </svg>
  );
}

/**
 * Category share as a ranked bar list — easier to read and compare than a donut,
 * and it labels every category directly instead of through a colour legend.
 */
export function AdminSalesByCategoryPanel({ from, to, className }: { from: string; to: string; className?: string }) {
  const { fromISO, toISO } = rangeToISO(from, to);
  const { data, loading, error, reload } = useDashboardResource<AdminAnalyticsCategoryBreakdown>(
    `/admin/analytics/category-breakdown${buildAdminQuery({ from: fromISO, to: toISO })}`,
  );
  const items = ensureArray<AdminAnalyticsCategoryBreakdown["items"][number]>(data?.items)
    .slice()
    .sort((a, b) => b.revenuePaise - a.revenuePaise);

  return (
    <Panel className={className} title="Sales by category">
      {loading && !data ? (
        <div className="space-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      ) : error ? (
        <PanelError message={error} onRetry={() => void reload()} />
      ) : items.length === 0 ? (
        <EmptyState icon={Tags} headline="No category sales yet" description="Shares appear once orders come in." className="border-0 py-8" />
      ) : (
        <ul className="flex flex-col gap-4">
          {items.slice(0, 6).map((item) => (
            <li key={item.categoryName} className="min-w-0">
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="min-w-0 truncate text-foreground">{item.categoryName}</span>
                <span className="shrink-0 text-muted-foreground tabular">
                  <span className="font-medium text-foreground">{Math.round(item.sharePercent)}%</span> · {formatPaise(item.revenuePaise)}
                </span>
              </div>
              <ShareBar fraction={item.sharePercent / 100} />
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export function AdminLowStockPanel({ className }: { className?: string }) {
  const { data, loading, error, reload } = useDashboardResource<AdminInventoryListItem[]>("/admin/inventory/low-stock");
  const items = ensureArray<AdminInventoryListItem>(data).slice(0, 6);

  return (
    <Panel className={className} title="Running low" actions={<ViewAll href="/admin/inventory?stock=low" label="Inventory" />} flush>
      {loading && !data ? (
        <ListSkeleton rows={4} />
      ) : error ? (
        <div className="p-4 sm:p-5">
          <PanelError message={error} onRetry={() => void reload()} />
        </div>
      ) : items.length === 0 ? (
        <div className="flex items-center gap-3 p-4 sm:px-5">
          <PackageCheck className="size-5 shrink-0 text-success" aria-hidden />
          <p className="text-sm text-muted-foreground">Every variant is above its low-stock level.</p>
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {items.map((row) => {
            const out = row.quantity <= 0;
            return (
              <li key={row.id} className="flex min-w-0 items-center gap-3 px-4 py-3 sm:px-5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{row.variant.product.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{row.variant.name}</p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className="text-sm font-semibold text-foreground tabular">{row.quantity} left</span>
                  <StatusDot tone={out ? "danger" : "warning"} className="text-xs text-muted-foreground">
                    {out ? "Out of stock" : "Low"}
                  </StatusDot>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
