"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Clock,
  Package,
  RotateCcw,
  Truck,
  CheckCircle2,
  XCircle,
  MapPin,
  Zap,
  RefreshCw,
  AlertTriangle,
} from "lucide-react";
import {
  ORDER_BOARD_COLUMNS,
  type AdminBoardOrderItem,
  type AdminOrderBoard,
  type OrderBoardColumnKey,
} from "@/lib/admin-api";
import { formatAdminDate, formatPaise } from "@/lib/admin-format";
import { getApiErrorMessage } from "@/lib/error-messages";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

// ── Column meta ─────────────────────────────────────────────────────────────

interface ColumnMeta {
  label: string;
  icon: React.ElementType;
  /** Status accent for the column dot + icon. Tokens/sparse accents only. */
  dot: string;
  iconColor: string;
}

const COLUMN_META: Record<OrderBoardColumnKey, ColumnMeta> = {
  CONFIRMED: {
    label: "Confirmed",
    icon: Package,
    dot: "bg-amber-500",
    iconColor: "text-amber-600 dark:text-amber-400",
  },
  PROCESSING: {
    label: "Processing",
    icon: Clock,
    dot: "bg-sky-500",
    iconColor: "text-sky-600 dark:text-sky-400",
  },
  SHIPPED: {
    label: "Shipped",
    icon: Truck,
    dot: "bg-sky-500",
    iconColor: "text-sky-600 dark:text-sky-400",
  },
  OUT_FOR_DELIVERY: {
    label: "Out for Delivery",
    icon: MapPin,
    dot: "bg-sky-500",
    iconColor: "text-sky-600 dark:text-sky-400",
  },
  DELIVERED: {
    label: "Delivered",
    icon: CheckCircle2,
    dot: "bg-emerald-500",
    iconColor: "text-emerald-600 dark:text-emerald-400",
  },
  CANCELLED: {
    label: "Cancelled",
    icon: XCircle,
    dot: "bg-muted-foreground",
    iconColor: "text-muted-foreground",
  },
};

// ── Order Card ───────────────────────────────────────────────────────────────

function OrderCard({ order }: { order: AdminBoardOrderItem }) {
  const isCod = order.paymentMode === "COD";

  return (
    <Link
      href={`/admin/orders/${order.id}`}
      className="group flex flex-col gap-2 rounded-xl border border-border bg-card p-3 transition-all hover:shadow-sm active:scale-[0.98]"
    >
      {/* Top row: order number + payment mode */}
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-semibold leading-none text-foreground transition-colors group-hover:text-primary">
          {order.orderNumber}
        </span>
        <Badge variant={isCod ? "warning" : "info"}>{order.paymentMode}</Badge>
      </div>

      {/* Customer */}
      <div className="flex min-w-0 items-center gap-2">
        <span
          aria-hidden="true"
          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary"
        >
          {(order.customerName || "?").charAt(0).toUpperCase()}
        </span>
        <p className="truncate text-xs text-muted-foreground">
          {order.customerName}
        </p>
      </div>

      {/* Amount */}
      <p className="text-sm font-medium leading-none text-foreground">
        {formatPaise(order.total)}
      </p>

      {/* Ship status / action */}
      {order.isLocalDelivery ? (
        <div className="flex items-center gap-1.5 rounded-lg bg-emerald-500/10 px-2 py-1">
          <Truck className="h-3 w-3 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
            Local delivery — fulfil directly
          </span>
        </div>
      ) : order.canShipNow ? (
        <div className="flex items-center gap-1.5 rounded-lg bg-emerald-500/10 px-2 py-1">
          <Zap className="h-3 w-3 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
            Ready to ship
          </span>
        </div>
      ) : order.shipBlockReason ? (
        <div className="flex items-center gap-1.5 rounded-lg bg-amber-500/10 px-2 py-1">
          <AlertTriangle className="h-3 w-3 shrink-0 text-amber-600 dark:text-amber-400" />
          <span className="truncate text-xs text-amber-700 dark:text-amber-400">
            {order.shipBlockReason}
          </span>
        </div>
      ) : order.awbNumber ? (
        <div className="flex items-center gap-1.5 rounded-lg bg-sky-500/10 px-2 py-1">
          <Truck className="h-3 w-3 shrink-0 text-sky-600 dark:text-sky-400" />
          <span className="truncate font-mono text-xs text-sky-700 dark:text-sky-400">
            {order.awbNumber}
          </span>
        </div>
      ) : null}

      {/* Date */}
      <p className="text-xs leading-none text-muted-foreground">
        {formatAdminDate(order.createdAt).split(",")[0]}
      </p>
    </Link>
  );
}

// ── Card skeleton (loading state) ────────────────────────────────────────────

function OrderCardSkeleton() {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3">
      <div className="flex items-start justify-between gap-2">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-4 w-12 rounded-full" />
      </div>
      <div className="flex items-center gap-2">
        <Skeleton className="size-8 rounded-full" />
        <Skeleton className="h-3 w-24" />
      </div>
      <Skeleton className="h-4 w-16" />
      <Skeleton className="h-3 w-14" />
    </div>
  );
}

function BoardSkeleton() {
  return (
    <>
      {/* Mobile skeleton */}
      <div className="flex flex-1 flex-col gap-2 p-3 lg:hidden">
        {Array.from({ length: 4 }).map((_, i) => (
          <OrderCardSkeleton key={i} />
        ))}
      </div>
      {/* Desktop skeleton */}
      <div className="hidden flex-1 items-start gap-4 overflow-x-hidden p-4 lg:flex lg:p-6">
        {ORDER_BOARD_COLUMNS.map((key) => (
          <div
            key={key}
            className="flex w-[17rem] shrink-0 flex-col gap-2 rounded-2xl border border-border bg-muted/30 p-2"
          >
            <div className="flex items-center gap-2 px-1 py-2">
              <Skeleton className="h-4 w-24" />
            </div>
            {Array.from({ length: 3 }).map((_, i) => (
              <OrderCardSkeleton key={i} />
            ))}
          </div>
        ))}
      </div>
    </>
  );
}

// ── Board Column (Desktop) ───────────────────────────────────────────────────

function BoardColumn({
  columnKey,
  orders,
}: {
  columnKey: OrderBoardColumnKey;
  orders: AdminBoardOrderItem[];
}) {
  const meta = COLUMN_META[columnKey];
  const Icon = meta.icon;
  const actionNeeded = orders.filter((o) => o.canShipNow).length;

  return (
    <div className="flex w-[17rem] shrink-0 flex-col rounded-2xl border border-border bg-muted/30">
      {/* Column header */}
      <div className="flex items-center justify-between gap-2 rounded-t-2xl bg-card px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <Icon className={cn("h-4 w-4 shrink-0", meta.iconColor)} />
          <span className="truncate text-sm font-semibold text-foreground">
            {meta.label}{" "}
            <span className="font-normal text-muted-foreground">
              ({orders.length})
            </span>
          </span>
        </div>
        {actionNeeded > 0 && (
          <Badge variant="success" dot>
            {actionNeeded}
          </Badge>
        )}
      </div>

      {/* Cards */}
      <div className="flex max-h-[calc(100vh-14rem)] flex-col gap-2 overflow-y-auto rounded-b-2xl border-t border-border p-2">
        {orders.length === 0 ? (
          <div className="flex h-24 items-center justify-center">
            <p className="text-xs text-muted-foreground">Empty</p>
          </div>
        ) : (
          orders.map((order) => <OrderCard key={order.id} order={order} />)
        )}
      </div>
    </div>
  );
}

// ── Mobile Column Picker ─────────────────────────────────────────────────────

function MobileColumnPicker({
  activeKey,
  board,
  onChange,
}: {
  activeKey: OrderBoardColumnKey;
  board: AdminOrderBoard;
  onChange: (key: OrderBoardColumnKey) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={scrollRef}
      className="scrollbar-none flex gap-2 overflow-x-auto pb-1"
      style={{ scrollbarWidth: "none" }}
    >
      {ORDER_BOARD_COLUMNS.map((key) => {
        const meta = COLUMN_META[key];
        const Icon = meta.icon;
        const count = board.columns[key]?.length ?? 0;
        const active = key === activeKey;
        return (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-all",
              active
                ? "border-primary bg-primary/10 text-primary shadow-sm"
                : "border-border bg-card text-muted-foreground hover:bg-muted/50",
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {meta.label}
            <span
              className={cn(
                "flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] font-bold",
                active
                  ? "bg-primary/10 text-primary"
                  : "bg-muted text-muted-foreground",
              )}
            >
              {count}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ── Main Board ───────────────────────────────────────────────────────────────

export function AdminOrderBoard() {
  const router = useRouter();
  const api = useAuthenticatedApi();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [board, setBoard] = useState<AdminOrderBoard | null>(null);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const [mobileCol, setMobileCol] = useState<OrderBoardColumnKey>("CONFIRMED");

  const load = useCallback(
    async (silent = false) => {
      if (silent) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const response = await api<AdminOrderBoard>("/admin/orders/board");
        const normalized: AdminOrderBoard = {
          columns: Object.fromEntries(
            ORDER_BOARD_COLUMNS.map((key) => [
              key,
              Array.isArray(response?.columns?.[key])
                ? response.columns[key]
                : [],
            ]),
          ) as Record<OrderBoardColumnKey, AdminBoardOrderItem[]>,
        };
        setBoard(normalized);
        setLoadedAt(new Date());
      } catch (err) {
        setError(getApiErrorMessage(err));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [api],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // Auto-refresh every 60 s
  useEffect(() => {
    const id = setInterval(() => void load(true), 60_000);
    return () => clearInterval(id);
  }, [load]);

  const totalOrders = board
    ? ORDER_BOARD_COLUMNS.reduce(
        (sum, key) => sum + (board.columns[key]?.length ?? 0),
        0,
      )
    : 0;

  const totalActionNeeded = board
    ? ORDER_BOARD_COLUMNS.reduce(
        (sum, key) =>
          sum + (board.columns[key]?.filter((o) => o.canShipNow).length ?? 0),
        0,
      )
    : 0;

  return (
    <div className="flex h-full flex-col gap-0">
      {/* ── Page header ─────────────────────────────────────────── */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-card px-4 py-3 lg:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={() => router.back()}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground transition-colors hover:text-foreground lg:h-8 lg:w-8"
            aria-label="Back to orders"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold leading-none text-foreground">
              Order Board
            </h1>
            {loadedAt && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                {totalOrders} orders · updated {loadedAt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
              </p>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {totalActionNeeded > 0 && (
            <div className="hidden sm:block">
              <Badge variant="success" dot>
                {totalActionNeeded} ready to ship
              </Badge>
            </div>
          )}
          <button
            type="button"
            onClick={() => void load(true)}
            disabled={loading || refreshing}
            className="flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50 lg:h-8 lg:w-8"
            aria-label="Refresh board"
          >
            <RefreshCw
              className={cn("h-4 w-4", refreshing && "animate-spin")}
            />
          </button>
        </div>
      </div>

      {/* ── States ──────────────────────────────────────────────── */}
      {loading && <BoardSkeleton />}

      {!loading && error && (
        <div className="flex flex-1 items-center justify-center p-6">
          <div className="flex max-w-sm flex-col items-center gap-4 rounded-2xl border border-destructive/20 bg-destructive/5 p-6 text-center">
            <AlertTriangle className="h-10 w-10 text-destructive/60" />
            <div>
              <p className="font-semibold text-destructive">Failed to load board</p>
              <p className="mt-1 text-sm text-muted-foreground">{error}</p>
            </div>
            <button
              type="button"
              onClick={() => void load()}
              className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              <RotateCcw className="h-4 w-4" />
              Try again
            </button>
          </div>
        </div>
      )}

      {!loading && !error && board && totalOrders === 0 && (
        <div className="flex flex-1 items-center justify-center p-6">
          <EmptyState
            icon={Package}
            headline="No orders on the board"
            description="Orders will appear here once placed."
            className="w-full max-w-sm border-none"
          />
        </div>
      )}

      {/* ── Board content ────────────────────────────────────────── */}
      {!loading && !error && board && totalOrders > 0 && (
        <>
          {/* Mobile: tab picker + single column */}
          <div className="flex flex-1 flex-col gap-3 overflow-hidden p-3 lg:hidden">
            <MobileColumnPicker
              activeKey={mobileCol}
              board={board}
              onChange={setMobileCol}
            />

            {/* Mobile action needed banner */}
            {totalActionNeeded > 0 && (
              <div className="flex items-center gap-2 rounded-xl bg-emerald-500/10 px-3 py-2">
                <Zap className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                  {totalActionNeeded} order{totalActionNeeded !== 1 ? "s" : ""} ready to ship
                </p>
              </div>
            )}

            {/* Active column cards */}
            <div className="flex-1 overflow-y-auto rounded-2xl">
              <div className="flex min-h-full flex-col gap-2 rounded-2xl border border-border bg-muted/30 p-2">
                {(board.columns[mobileCol] ?? []).length === 0 ? (
                  <div className="flex h-32 items-center justify-center">
                    <p className="text-sm text-muted-foreground">
                      No {COLUMN_META[mobileCol].label.toLowerCase()} orders
                    </p>
                  </div>
                ) : (
                  (board.columns[mobileCol] ?? []).map((order) => (
                    <OrderCard key={order.id} order={order} />
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Desktop: horizontal Kanban scroll */}
          <div className="hidden flex-1 items-start gap-4 overflow-x-auto p-4 pb-6 lg:flex lg:p-6 lg:pb-8">
            {ORDER_BOARD_COLUMNS.map((key) => (
              <BoardColumn
                key={key}
                columnKey={key}
                orders={board.columns[key] ?? []}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
