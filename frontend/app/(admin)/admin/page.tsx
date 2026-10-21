"use client";

import { useEffect, useState } from "react";
import {
  defaultDateRange,
  trendPeriodLabel,
} from "@/components/admin/AdminDateRangePicker";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import type { DateRange } from "@/components/admin/AdminDateRangePicker";
import { ConsolePage } from "@/components/ui/console";
import {
  AdminActionQueuePanel,
  AdminDashboardKpisPanel,
  AdminSalesChartPanel,
  AdminTopProductsPanel,
  AdminSalesByCategoryPanel,
  AdminRecentOrdersPanel,
  AdminLowStockPanel,
} from "@/components/admin/AdminDashboardPanels";
import { useAdminShell } from "@/contexts/admin-shell-context";
import { useAdminAuth } from "@/contexts/admin-auth-context";
import { ADMIN_PERMISSIONS, hasAdminPermission } from "@/lib/permissions";
import { useAuthStore } from "@/stores/auth";
import { resolveApiBaseUrl } from "@/lib/api-base";

export default function AdminDashboardPage() {
  const [range, setRange] = useState<DateRange>(defaultDateRange());
  const trendLabel = trendPeriodLabel(range.from, range.to);

  // Register export handler for orders CSV
  const { registerExportHandler } = useAdminShell();
  const { adminUser } = useAdminAuth();
  const canExport = hasAdminPermission(adminUser, ADMIN_PERMISSIONS.ordersExport);
  const accessToken = useAuthStore((s) => s.accessToken);

  useEffect(() => {
    if (!canExport) return;
    return registerExportHandler(async () => {
      const base = resolveApiBaseUrl();
      if (!base) return;
      const params = new URLSearchParams({
        from: new Date(range.from + "T00:00:00").toISOString(),
        to: new Date(range.to + "T23:59:59").toISOString(),
      });
      const res = await fetch(`${base}/admin/orders/export?${params}`, {
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
        credentials: "include",
      });
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `orders-${range.from}-to-${range.to}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }, [registerExportHandler, range.from, range.to, accessToken, canExport]);

  return (
    <ConsolePage>
      <AdminPageHeader title="Dashboard" range={range} onRangeChange={setRange} />

      <AdminActionQueuePanel />

      <AdminDashboardKpisPanel from={range.from} to={range.to} trendLabel={trendLabel} />

      <div className="grid min-w-0 grid-cols-1 gap-5 sm:gap-6 xl:grid-cols-3">
        <AdminSalesChartPanel from={range.from} to={range.to} className="xl:col-span-2" />
        <AdminRecentOrdersPanel />
      </div>

      <div className="grid min-w-0 grid-cols-1 gap-5 sm:gap-6 lg:grid-cols-2 xl:grid-cols-3">
        <AdminTopProductsPanel from={range.from} to={range.to} />
        <AdminSalesByCategoryPanel from={range.from} to={range.to} />
        <AdminLowStockPanel className="lg:col-span-2 xl:col-span-1" />
      </div>
    </ConsolePage>
  );
}
