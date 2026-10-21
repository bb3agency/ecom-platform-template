"use client";

import { useEffect, useRef, useState } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { ConsolePage } from "@/components/ui/console";
import {
  AdminOrderContextColumn,
  AdminOrderDetailError,
  AdminOrderDetailHeader,
  useAdminOrderDetail,
} from "@/components/admin/AdminOrderDetailPanel";
import { AdminOrderFulfillmentPanel } from "@/components/admin/AdminOrderFulfillmentPanel";
import { AdminOrderItemsPanel } from "@/components/admin/AdminOrderItemsPanel";
import { AdminOrderReturnRequestsPanel } from "@/components/admin/AdminOrderReturnRequestsPanel";
import { AdminOrderStatusPanel } from "@/components/admin/AdminOrderStatusPanel";
import { AdminOrderTimelinePanel } from "@/components/admin/AdminOrderTimelinePanel";
import { useAdminDataRefreshEffect } from "@/hooks/use-admin-data-refresh-effect";

/**
 * Order detail: the work (fulfil, items, returns) in the main column, the context
 * (status moves, customer, payment, shipping, history) beside it. On phones the
 * work comes first — that's what someone packing an order needs.
 */
export function AdminOrderDetailPageClient({ orderId }: { orderId: string }) {
  const { order, loading, error, reload } = useAdminOrderDetail(orderId);
  // Bumped after any mutation so self-loading child panels refetch too.
  const [refreshKey, setRefreshKey] = useState(0);
  const refreshAll = () => {
    void reload();
    setRefreshKey((v) => v + 1);
  };
  // Fulfilment actions (ship, cancel…) announce changes on the admin data bus.
  useAdminDataRefreshEffect(reload, ["orders"]);

  // Courier webhooks move orders while this page is open. Re-read every 30s while the
  // tab is visible (and on focus); when the status changed underneath us, refresh the
  // self-loading panels (fulfilment, history) as well.
  useEffect(() => {
    const tick = () => {
      if (!document.hidden) void reload();
    };
    const interval = window.setInterval(tick, 30_000);
    window.addEventListener("focus", tick);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", tick);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [reload]);

  const lastStatus = useRef<string | null>(null);
  useEffect(() => {
    if (!order) return;
    if (lastStatus.current !== null && lastStatus.current !== order.status) {
      setRefreshKey((v) => v + 1);
    }
    lastStatus.current = order.status;
  }, [order]);

  if (loading && !order) {
    return (
      <ConsolePage>
        <div className="space-y-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-4 w-72" />
        </div>
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          <Skeleton className="h-72 lg:col-span-2" />
          <Skeleton className="h-72" />
        </div>
      </ConsolePage>
    );
  }

  if (error && !order) {
    return (
      <ConsolePage>
        <AdminOrderDetailError message={error} onRetry={() => void reload()} />
      </ConsolePage>
    );
  }

  if (!order) return null;

  return (
    <ConsolePage>
      <AdminOrderDetailHeader order={order} onChanged={refreshAll} />

      <div className="grid min-w-0 grid-cols-1 gap-5 sm:gap-6 lg:grid-cols-3">
        <div className="grid min-w-0 grid-cols-1 content-start gap-5 sm:gap-6 lg:col-span-2">
          <AdminOrderFulfillmentPanel key={`fulfil-${refreshKey}`} initialOrderId={orderId} hideOrderPicker />
          <AdminOrderItemsPanel orderId={orderId} onUpdated={refreshAll} />
          <AdminOrderReturnRequestsPanel orderId={orderId} />
        </div>
        <div className="grid min-w-0 grid-cols-1 content-start gap-5 sm:gap-6">
          <AdminOrderStatusPanel order={order} onUpdated={refreshAll} />
          <AdminOrderContextColumn order={order} />
          <AdminOrderTimelinePanel key={`timeline-${refreshKey}`} orderId={orderId} />
        </div>
      </div>
    </ConsolePage>
  );
}
