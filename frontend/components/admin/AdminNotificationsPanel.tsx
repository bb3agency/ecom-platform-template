"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  X,
  ShoppingBag,
  Clock,
  Truck,
  AlertCircle,
  CheckCircle2,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import { useAdminDataRefreshEffect } from "@/hooks/use-admin-data-refresh-effect";
import {
  coercePaginatedResponse,
  type AdminOrderListItem,
  type PaginatedResponse,
} from "@/lib/admin-api";
import { formatPaise, formatAdminDate } from "@/lib/admin-format";
import { cn } from "@/lib/utils";

interface AdminNotificationsPanelProps {
  onClose: () => void;
}

type Tab = "pending" | "issues";

const STATUS_ICON: Record<string, React.ReactNode> = {
  CONFIRMED: <ShoppingBag className="size-4" />,
  PROCESSING: <Clock className="size-4" />,
  SHIPPED: <Truck className="size-4" />,
};

const STATUS_COLOR: Record<string, string> = {
  CONFIRMED: "bg-amber-50 text-amber-600",
  PROCESSING: "bg-blue-50 text-blue-600",
  SHIPPED: "bg-indigo-50 text-indigo-600",
  PAYMENT_FAILED: "bg-red-50 text-red-600",
  CANCELLED: "bg-zinc-100 text-zinc-500",
};

const STATUS_BADGE: Record<string, string> = {
  CONFIRMED: "bg-amber-50 text-amber-700",
  PROCESSING: "bg-blue-50 text-blue-700",
  SHIPPED: "bg-indigo-50 text-indigo-700",
  PAYMENT_FAILED: "bg-red-50 text-red-700",
  CANCELLED: "bg-zinc-100 text-zinc-600",
};

export function AdminNotificationsPanel({ onClose }: AdminNotificationsPanelProps) {
  const api = useAuthenticatedApi();
  const [tab, setTab] = useState<Tab>("pending");
  const [pendingOrders, setPendingOrders] = useState<AdminOrderListItem[]>([]);
  const [issueOrders, setIssueOrders] = useState<AdminOrderListItem[]>([]);
  const [loadingPending, setLoadingPending] = useState(true);
  const [loadingIssues, setLoadingIssues] = useState(true);
  const [errorPending, setErrorPending] = useState(false);
  const [errorIssues, setErrorIssues] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  // Keep the open panel live: refetch when any admin surface mutates order data
  // and on a light 20s poll (new orders arrive from customer checkouts that no
  // in-app event can announce).
  useAdminDataRefreshEffect(() => setRefreshKey((k) => k + 1), ["orders", "dashboard"]);
  useEffect(() => {
    const interval = window.setInterval(() => {
      if (!document.hidden) setRefreshKey((k) => k + 1);
    }, 20_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoadingPending(true);
    setErrorPending(false);
    void api<PaginatedResponse<AdminOrderListItem>>(
      "/admin/orders?limit=8&status=CONFIRMED",
    )
      .then((res) => {
        if (!cancelled)
          setPendingOrders(coercePaginatedResponse(res).items as AdminOrderListItem[]);
      })
      .catch(() => { if (!cancelled) setErrorPending(true); })
      .finally(() => { if (!cancelled) setLoadingPending(false); });
    return () => { cancelled = true; };
  }, [api, refreshKey]);

  useEffect(() => {
    let cancelled = false;
    setLoadingIssues(true);
    setErrorIssues(false);
    void api<PaginatedResponse<AdminOrderListItem>>(
      "/admin/orders?limit=8&status=PAYMENT_FAILED",
    )
      .then((res) => {
        if (!cancelled)
          setIssueOrders(coercePaginatedResponse(res).items as AdminOrderListItem[]);
      })
      .catch(() => { if (!cancelled) setErrorIssues(true); })
      .finally(() => { if (!cancelled) setLoadingIssues(false); });
    return () => { cancelled = true; };
  }, [api, refreshKey]);

  const pendingCount = pendingOrders.length;
  const issuesCount = issueOrders.length;

  const loading = tab === "pending" ? loadingPending : loadingIssues;
  const hasError = tab === "pending" ? errorPending : errorIssues;
  const items = tab === "pending" ? pendingOrders : issueOrders;

  return (
    <div className="fixed inset-x-2 top-16 z-50 overflow-hidden rounded-2xl border border-border/50 bg-card shadow-2xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-[min(22rem,92vw)]">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/30 px-4 py-3">
        <span className="text-sm font-semibold text-foreground">Notifications</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setRefreshKey((k) => k + 1)}
            className="flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
            aria-label="Refresh"
          >
            <RefreshCw className={cn("size-4", (loadingPending || loadingIssues) && "animate-spin")} />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border/30 px-1 pt-1">
        <button
          type="button"
          onClick={() => setTab("pending")}
          className={cn(
            "flex min-h-10 items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-t-md transition-colors",
            tab === "pending"
              ? "border-b-2 border-primary text-primary"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          Pending Orders
          {pendingCount > 0 && (
            <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-amber-500 px-1 text-[9px] font-bold text-white">
              {pendingCount}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => setTab("issues")}
          className={cn(
            "flex min-h-10 items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-t-md transition-colors",
            tab === "issues"
              ? "border-b-2 border-destructive text-destructive"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          Payment Issues
          {issuesCount > 0 && (
            <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-bold text-white">
              {issuesCount}
            </span>
          )}
        </button>
      </div>

      {/* Body */}
      <div className="max-h-[min(420px,60vh)] overflow-y-auto">
        {loading ? (
          <div className="flex h-32 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : hasError ? (
          <div className="flex h-32 flex-col items-center justify-center gap-2 text-muted-foreground">
            <AlertCircle className="h-7 w-7 text-destructive/70" />
            <p className="text-xs font-medium">Could not load orders</p>
            <button
              type="button"
              onClick={() => setRefreshKey((k) => k + 1)}
              className="text-[11px] text-primary hover:underline"
            >
              Retry
            </button>
          </div>
        ) : items.length === 0 ? (
          <div className="flex h-32 flex-col items-center justify-center gap-2 text-muted-foreground">
            <CheckCircle2 className="h-7 w-7 text-green-500" />
            <p className="text-xs font-medium">
              {tab === "pending" ? "No pending orders" : "No payment issues"}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border/20">
            {items.map((order) => {
              const statusColor = STATUS_COLOR[order.status] ?? "bg-muted text-muted-foreground";
              const badgeColor = STATUS_BADGE[order.status] ?? "bg-muted text-muted-foreground";
              const icon = STATUS_ICON[order.status] ?? <AlertCircle className="h-4 w-4" />;
              return (
                <Link
                  key={order.id}
                  href={`/admin/orders/${order.id}`}
                  onClick={onClose}
                  className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-muted/30 group"
                >
                  <div className={cn("mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full", statusColor)}>
                    {icon}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold text-foreground truncate">
                        {order.orderNumber}
                      </p>
                      <span className={cn("shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold", badgeColor)}>
                        {order.status.replace("_", " ")}
                      </span>
                    </div>
                    <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                      {order.customerName}
                    </p>
                    <div className="flex items-center justify-between mt-1">
                      <span className="text-[11px] font-medium text-foreground">
                        {formatPaise(order.total)}
                      </span>
                      <span className="text-[10px] text-muted-foreground/70">
                        {formatAdminDate(order.createdAt).split(",")[0]}
                      </span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-border/30 p-2">
        <Link
          href={tab === "pending" ? "/admin/orders?status=CONFIRMED" : "/admin/orders?status=PAYMENT_FAILED"}
          onClick={onClose}
          className="flex w-full items-center justify-center rounded-lg py-2 text-xs font-medium text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
        >
          View all {tab === "pending" ? "pending" : "failed payment"} orders →
        </Link>
      </div>
    </div>
  );
}
