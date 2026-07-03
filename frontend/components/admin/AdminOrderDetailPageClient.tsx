"use client";

import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { useState } from "react";
import { AdminOrderDetailPanel } from "@/components/admin/AdminOrderDetailPanel";
import { AdminOrderFulfillmentPanel } from "@/components/admin/AdminOrderFulfillmentPanel";
import { AdminOrderItemsPanel } from "@/components/admin/AdminOrderItemsPanel";
import { AdminOrderReturnRequestsPanel } from "@/components/admin/AdminOrderReturnRequestsPanel";
import { AdminOrderTimelinePanel } from "@/components/admin/AdminOrderTimelinePanel";

export function AdminOrderDetailPageClient({ orderId }: { orderId: string }) {
  const [refreshKey, setRefreshKey] = useState(0);

  function bumpRefresh() {
    setRefreshKey((v) => v + 1);
  }

  return (
    <div className="grid gap-6">
      <Link
        href="/admin/orders"
        className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        Orders
      </Link>

      <AdminOrderDetailPanel key={`detail-${refreshKey}`} orderId={orderId} />

      {/* min-w-0 on every grid child: grid items default to min-width:auto, so any wide
          content (mono AWBs, tables, long emails) would inflate the column past the
          viewport on mobile and get clipped by the shell's overflow-x-hidden. */}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="grid min-w-0 gap-6 lg:col-span-2">
          <AdminOrderItemsPanel orderId={orderId} onUpdated={bumpRefresh} />
          <AdminOrderFulfillmentPanel initialOrderId={orderId} hideOrderPicker />
          <AdminOrderReturnRequestsPanel orderId={orderId} />
        </div>
        <div className="min-w-0">
          <AdminOrderTimelinePanel key={`timeline-${refreshKey}`} orderId={orderId} />
        </div>
      </div>
    </div>
  );
}
