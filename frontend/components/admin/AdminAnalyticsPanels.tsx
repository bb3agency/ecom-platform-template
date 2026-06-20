"use client";

import { useCallback, useEffect, useState } from "react";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { AdminSection } from "@/components/admin/AdminSection";
import {
  AdminDashboardKpisPanel,
  AdminSalesChartPanel,
  AdminTopProductsPanel,
} from "@/components/admin/AdminDashboardPanels";
import {
  defaultDateRange,
  rangeToISO,
  trendPeriodLabel,
  type DateRange,
} from "@/components/admin/AdminDateRangePicker";
import { useAuthStore } from "@/stores/auth";
import { resolveApiBaseUrl } from "@/lib/api-base";
import { useAdminDataRefreshEffect } from "@/hooks/use-admin-data-refresh-effect";
import { ADMIN_DASHBOARD_REFRESH_SCOPES } from "@/lib/admin-data-refresh";
import { useAdminAuth } from "@/contexts/admin-auth-context";
import { hasAdminPermission, ADMIN_PERMISSIONS } from "@/lib/permissions";
import type {
  AdminAnalyticsCategoryBreakdown,
  AdminAnalyticsFunnel,
  AdminAnalyticsRevenue,
  AdminInventoryAlertItem,
  AdminNotificationDeliveryStats,
  AdminSalesChartPoint,
  AdminShippingProviderStats,
} from "@/lib/admin-api";
import {
  buildAdminQuery,
  ensureArray,
  getPaginatedItems,
  toIsoDateRange,
} from "@/lib/admin-api";
import { formatAdminDate, formatPaise } from "@/lib/admin-format";
import { shippingProviderLabel } from "@/lib/shipping-provider-labels";
import { getApiErrorMessage } from "@/lib/error-messages";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import { useAdminShell } from "@/contexts/admin-shell-context";

export function AdminAnalyticsPageContent() {
  const [range, setRange] = useState<DateRange>(defaultDateRange);
  const trendLabel = trendPeriodLabel(range.from, range.to);
  const accessToken = useAuthStore((s) => s.accessToken);
  const { adminUser } = useAdminAuth();
  const canExport = hasAdminPermission(adminUser, ADMIN_PERMISSIONS.analyticsExport);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const { registerExportHandler } = useAdminShell();

  const handleExport = useCallback(async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const base = resolveApiBaseUrl();
      if (!base) throw new Error("API base URL not configured");
      const { fromISO, toISO } = rangeToISO(range.from, range.to);
      const url = `${base}/admin/analytics/revenue/export?from=${encodeURIComponent(fromISO)}&to=${encodeURIComponent(toISO)}`;
      const response = await fetch(url, {
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
        credentials: "include",
      });
      if (!response.ok) throw new Error("Export failed");
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = `analytics-revenue-${range.from}-to-${range.to}.csv`;
      anchor.click();
      URL.revokeObjectURL(objectUrl);
    } catch (err: unknown) {
      setExportError(getApiErrorMessage(err));
    } finally {
      setExporting(false);
    }
  }, [exporting, range.from, range.to, accessToken]);

  useEffect(() => {
    if (!canExport) return;
    return registerExportHandler(() => void handleExport());
  }, [registerExportHandler, handleExport, canExport]);

  return (
    <div className="flex flex-col gap-6">
      <AdminPageHeader
        title="Analytics"
        description="Revenue, funnel, category performance, inventory alerts, and notification delivery."
        range={range}
        onRangeChange={setRange}
      />
      {exportError && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2.5 text-sm text-destructive">
          <span className="font-medium">Export failed:</span> {exportError}
          <button
            type="button"
            onClick={() => setExportError(null)}
            className="ml-auto text-xs text-destructive/70 hover:text-destructive"
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      )}
      <AdminDashboardKpisPanel
        from={range.from}
        to={range.to}
        trendLabel={trendLabel}
      />
      <AdminRevenueAnalyticsPanel from={range.from} to={range.to} />
      <AdminFunnelPanel from={range.from} to={range.to} />
      <AdminCategoryBreakdownPanel from={range.from} to={range.to} />
      <AdminInventoryAlertsPanel />
      <AdminShippingProviderStatsPanel from={range.from} to={range.to} />
      <AdminNotificationStatsPanel from={range.from} to={range.to} />
      <AdminSalesChartPanel from={range.from} to={range.to} />
      <AdminTopProductsPanel from={range.from} to={range.to} />
    </div>
  );
}

function AdminRevenueAnalyticsPanel({
  from,
  to,
}: {
  from: string;
  to: string;
}) {
  const api = useAuthenticatedApi();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<AdminAnalyticsRevenue | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api<AdminAnalyticsRevenue>(
        `/admin/analytics/revenue${buildAdminQuery({
          granularity: "day",
          from: toIsoDateRange(from),
          to: toIsoDateRange(to, true),
        })}`,
      );
      setData(response);
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [api, from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  useAdminDataRefreshEffect(load, ADMIN_DASHBOARD_REFRESH_SCOPES);

  const points = ensureArray<AdminSalesChartPoint>(data?.points);

  return (
    <AdminSection
      title="Revenue analytics"
      description={data ? `Granularity: ${data.granularity}` : undefined}
      loading={loading}
      error={error}
      empty={!loading && !error && points.length === 0}
      emptyMessage="No revenue data."
    >
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border bg-muted/50 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Bucket</th>
              <th className="px-3 py-2 font-medium">Orders</th>
              <th className="px-3 py-2 font-medium">Revenue</th>
            </tr>
          </thead>
          <tbody>
            {points.map((point) => (
              <tr
                key={point.bucket}
                className="border-b border-border last:border-0"
              >
                <td className="px-3 py-2 text-xs">{point.bucket}</td>
                <td className="px-3 py-2">{point.ordersCount}</td>
                <td className="px-3 py-2">{formatPaise(point.revenuePaise)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AdminSection>
  );
}

const FUNNEL_STEP_LABELS: Record<string, string> = {
  PRODUCT_VIEW: "Product Views",
  ADD_TO_CART: "Added to Cart",
  CHECKOUT_STARTED: "Started Checkout",
  PAYMENT_INITIATED: "Began Payment",
  PURCHASE: "Completed Purchase",
};

const FUNNEL_STEP_COLORS: Record<string, string> = {
  PRODUCT_VIEW: "bg-blue-500",
  ADD_TO_CART: "bg-indigo-500",
  CHECKOUT_STARTED: "bg-violet-500",
  PAYMENT_INITIATED: "bg-orange-500",
  PURCHASE: "bg-emerald-500",
};

function AdminFunnelPanel({ from, to }: { from: string; to: string }) {
  const api = useAuthenticatedApi();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<AdminAnalyticsFunnel | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api<AdminAnalyticsFunnel>(
      `/admin/analytics/funnel${buildAdminQuery({
        from: toIsoDateRange(from),
        to: toIsoDateRange(to, true),
      })}`,
    )
      .then((response) => {
        if (!cancelled) setData(response);
      })
      .catch((err) => {
        if (!cancelled) setError(getApiErrorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api, from, to]);

  const steps = ensureArray<AdminAnalyticsFunnel["steps"][number]>(data?.steps);
  const topCount = steps[0]?.count ?? 0;

  return (
    <AdminSection
      title="Conversion funnel"
      description="How many visitors turn into buyers at each stage"
      loading={loading}
      error={error}
      empty={!loading && !error && steps.every((s) => s.count === 0)}
      emptyMessage="No funnel data yet. Tracking events will appear here once customers browse your store."
    >
      <div className="space-y-1">
        {steps.map((step, idx) => {
          const label = FUNNEL_STEP_LABELS[step.eventType] ?? step.eventType;
          const barColor = FUNNEL_STEP_COLORS[step.eventType] ?? "bg-primary";
          const barWidth = topCount > 0 ? (step.count / topCount) * 100 : 0;
          const prevCount = idx > 0 ? steps[idx - 1]?.count : undefined;
          const dropOff =
            typeof prevCount === "number" && prevCount > 0
              ? prevCount - step.count
              : null;
          const dropOffPct =
            typeof prevCount === "number" && prevCount > 0
              ? Math.round(((prevCount - step.count) / prevCount) * 100)
              : null;

          return (
            <div key={step.eventType}>
              {/* Drop-off indicator between steps */}
              {idx > 0 && dropOff !== null && dropOff > 0 && (
                <div className="flex items-center gap-2 py-1 pl-3">
                  <div className="h-4 w-px bg-border" />
                  <span className="text-xs text-muted-foreground">
                    ↓ {dropOff.toLocaleString()} left ({dropOffPct}% dropped off)
                  </span>
                </div>
              )}
              {idx > 0 && (dropOff === null || dropOff === 0) && (
                <div className="py-1 pl-3">
                  <div className="h-4 w-px bg-border" />
                </div>
              )}

              {/* Step card */}
              <div className="rounded-lg border border-border bg-background/60 p-4">
                <div className="mb-2 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-2">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold text-muted-foreground">
                      {idx + 1}
                    </span>
                    <span className="text-sm font-medium text-foreground">{label}</span>
                  </div>
                  <div className="flex items-center gap-3 text-right">
                    <span className="text-lg font-bold text-foreground tabular-nums">
                      {step.count.toLocaleString()}
                    </span>
                    {idx > 0 && (
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                          step.conversionRatePercent >= 50
                            ? "bg-emerald-100 text-emerald-700"
                            : step.conversionRatePercent >= 20
                              ? "bg-amber-100 text-amber-700"
                              : "bg-red-100 text-red-700"
                        }`}
                      >
                        {step.conversionRatePercent}% of views
                      </span>
                    )}
                    {idx === 0 && (
                      <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-bold text-blue-700">
                        Top of funnel
                      </span>
                    )}
                  </div>
                </div>
                {/* Progress bar */}
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className={`h-2 rounded-full transition-all duration-500 ${barColor}`}
                    style={{ width: `${Math.max(barWidth, barWidth > 0 ? 2 : 0)}%` }}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Summary row */}
      {steps.length > 0 && topCount > 0 && (
        <div className="mt-4 flex flex-wrap gap-4 rounded-lg border border-border bg-muted/30 p-4">
          <div className="text-center">
            <p className="text-xs text-muted-foreground">Overall conversion</p>
            <p className="text-xl font-bold text-foreground">
              {steps[steps.length - 1]?.conversionRatePercent ?? 0}%
            </p>
            <p className="text-xs text-muted-foreground">views → purchases</p>
          </div>
          <div className="h-10 w-px self-center bg-border" />
          <div className="text-center">
            <p className="text-xs text-muted-foreground">Total purchases</p>
            <p className="text-xl font-bold text-emerald-600">
              {(steps.find((s) => s.eventType === "PURCHASE")?.count ?? 0).toLocaleString()}
            </p>
          </div>
          <div className="h-10 w-px self-center bg-border" />
          <div className="text-center">
            <p className="text-xs text-muted-foreground">Cart add rate</p>
            <p className="text-xl font-bold text-foreground">
              {steps.find((s) => s.eventType === "ADD_TO_CART")?.conversionRatePercent ?? 0}%
            </p>
            <p className="text-xs text-muted-foreground">of product views</p>
          </div>
        </div>
      )}
    </AdminSection>
  );
}

function AdminCategoryBreakdownPanel({
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

  useEffect(() => {
    let cancelled = false;
    void api<AdminAnalyticsCategoryBreakdown>(
      `/admin/analytics/category-breakdown${buildAdminQuery({
        from: toIsoDateRange(from),
        to: toIsoDateRange(to, true),
      })}`,
    )
      .then((response) => {
        if (!cancelled) setData(response);
      })
      .catch((err) => {
        if (!cancelled) setError(getApiErrorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api, from, to]);

  const items = ensureArray<AdminAnalyticsCategoryBreakdown["items"][number]>(
    data?.items,
  );

  return (
    <AdminSection
      title="Category breakdown"
      loading={loading}
      error={error}
      empty={!loading && !error && items.length === 0}
      emptyMessage="No category data."
    >
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border bg-muted/50 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Category</th>
              <th className="px-3 py-2 font-medium">Revenue</th>
              <th className="px-3 py-2 font-medium">Share</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr
                key={item.categoryId}
                className="border-b border-border last:border-0"
              >
                <td className="px-3 py-2">{item.categoryName}</td>
                <td className="px-3 py-2">{formatPaise(item.revenuePaise)}</td>
                <td className="px-3 py-2">{item.sharePercent}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AdminSection>
  );
}

function AdminInventoryAlertsPanel() {
  const api = useAuthenticatedApi();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<AdminInventoryAlertItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    void api<{ items: AdminInventoryAlertItem[] }>(
      "/admin/analytics/inventory-alerts",
    )
      .then((response) => {
        if (!cancelled) setItems(getPaginatedItems(response));
      })
      .catch((err) => {
        if (!cancelled) setError(getApiErrorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  return (
    <AdminSection
      title="Inventory alerts"
      description="Variants currently at or below low-stock threshold."
      loading={loading}
      error={error}
      empty={!loading && !error && items.length === 0}
      emptyMessage="No low-stock alerts."
    >
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border bg-muted/50 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Product</th>
              <th className="px-3 py-2 font-medium">SKU</th>
              <th className="px-3 py-2 font-medium">Qty</th>
              <th className="px-3 py-2 font-medium">Threshold</th>
              <th className="px-3 py-2 font-medium">Alerted</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr
                key={item.variantId}
                className="border-b border-border last:border-0"
              >
                <td className="px-3 py-2">
                  <p className="font-medium">{item.productName}</p>
                  <p className="text-xs text-muted-foreground">
                    {item.variantName}
                  </p>
                </td>
                <td className="px-3 py-2 font-mono text-xs">{item.sku}</td>
                <td className="px-3 py-2">{item.quantity}</td>
                <td className="px-3 py-2">{item.lowStockThreshold}</td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {formatAdminDate(item.occurredAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AdminSection>
  );
}

function AdminShippingProviderStatsPanel({
  from,
  to,
}: {
  from: string;
  to: string;
}) {
  const api = useAuthenticatedApi();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<AdminShippingProviderStats | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api<AdminShippingProviderStats>(
      `/admin/analytics/shipping-providers${buildAdminQuery({
        from: toIsoDateRange(from),
        to: toIsoDateRange(to, true),
      })}`,
    )
      .then((response) => {
        if (!cancelled) setData(response);
      })
      .catch((err) => {
        if (!cancelled) setError(getApiErrorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api, from, to]);

  const providers = ensureArray<AdminShippingProviderStats["providers"][number]>(
    data?.providers,
  );

  return (
    <AdminSection
      title="Shipping provider breakdown"
      description={
        data
          ? `${data.totalShipments} total shipment${data.totalShipments !== 1 ? "s" : ""} in range`
          : undefined
      }
      loading={loading}
      error={error}
      empty={!loading && !error && providers.length === 0}
      emptyMessage="No shipments in this period."
    >
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border bg-muted/50 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Provider</th>
              <th className="px-3 py-2 font-medium">Shipments</th>
              <th className="px-3 py-2 font-medium">Share</th>
              <th className="px-3 py-2 font-medium">Delivered</th>
              <th className="px-3 py-2 font-medium">Revenue</th>
            </tr>
          </thead>
          <tbody>
            {providers.map((row) => {
              const label = shippingProviderLabel(row.provider);
              const deliveryRate =
                row.shipmentsCount > 0
                  ? Math.round((row.deliveredCount / row.shipmentsCount) * 100)
                  : 0;
              return (
                <tr
                  key={row.provider}
                  className="border-b border-border last:border-0"
                >
                  <td className="px-3 py-2 font-medium">{label}</td>
                  <td className="px-3 py-2">{row.shipmentsCount}</td>
                  <td className="px-3 py-2">{row.sharePercent}%</td>
                  <td className="px-3 py-2">
                    {row.deliveredCount}{" "}
                    <span className="text-xs text-muted-foreground">
                      ({deliveryRate}%)
                    </span>
                  </td>
                  <td className="px-3 py-2">{formatPaise(row.revenuePaise)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </AdminSection>
  );
}

function AdminNotificationStatsPanel({
  from,
  to,
}: {
  from: string;
  to: string;
}) {
  const api = useAuthenticatedApi();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<AdminNotificationDeliveryStats | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api<AdminNotificationDeliveryStats>(
      `/admin/analytics/notifications${buildAdminQuery({
        from: toIsoDateRange(from),
        to: toIsoDateRange(to, true),
      })}`,
    )
      .then((response) => {
        if (!cancelled) setData(response);
      })
      .catch((err) => {
        if (!cancelled) setError(getApiErrorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api, from, to]);

  const channels = ensureArray<
    AdminNotificationDeliveryStats["channels"][number]
  >(data?.channels);

  return (
    <AdminSection
      title="Notification delivery"
      loading={loading}
      error={error}
      empty={!loading && !error && channels.length === 0}
      emptyMessage="No notification stats."
    >
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border bg-muted/50 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Channel</th>
              <th className="px-3 py-2 font-medium">Total</th>
              <th className="px-3 py-2 font-medium">Sent</th>
              <th className="px-3 py-2 font-medium">Failed</th>
              <th className="px-3 py-2 font-medium">Delivery %</th>
            </tr>
          </thead>
          <tbody>
            {channels.map((channel) => (
              <tr
                key={channel.channel}
                className="border-b border-border last:border-0"
              >
                <td className="px-3 py-2">{channel.channel}</td>
                <td className="px-3 py-2">{channel.total}</td>
                <td className="px-3 py-2">{channel.sent}</td>
                <td className="px-3 py-2">{channel.failed}</td>
                <td className="px-3 py-2">{channel.deliveryRatePercent}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AdminSection>
  );
}
