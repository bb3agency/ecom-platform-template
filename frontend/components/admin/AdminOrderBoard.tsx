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
  CreditCard,
  Banknote,
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
import { cn } from "@/lib/utils";

// ── Column meta ─────────────────────────────────────────────────────────────

interface ColumnMeta {
  label: string;
  icon: React.ElementType;
  bg: string;
  border: string;
  headerBg: string;
  dot: string;
  textColor: string;
  badgeBg: string;
}

const COLUMN_META: Record<OrderBoardColumnKey, ColumnMeta> = {
  CONFIRMED: {
    label: "Confirmed",
    icon: Package,
    bg: "bg-amber-50/60",
    border: "border-amber-200",
    headerBg: "bg-amber-50",
    dot: "bg-amber-500",
    textColor: "text-amber-700",
    badgeBg: "bg-amber-100 text-amber-800",
  },
  PROCESSING: {
    label: "Processing",
    icon: Clock,
    bg: "bg-blue-50/60",
    border: "border-blue-200",
    headerBg: "bg-blue-50",
    dot: "bg-blue-500",
    textColor: "text-blue-700",
    badgeBg: "bg-blue-100 text-blue-800",
  },
  SHIPPED: {
    label: "Shipped",
    icon: Truck,
    bg: "bg-indigo-50/60",
    border: "border-indigo-200",
    headerBg: "bg-indigo-50",
    dot: "bg-indigo-500",
    textColor: "text-indigo-700",
    badgeBg: "bg-indigo-100 text-indigo-800",
  },
  OUT_FOR_DELIVERY: {
    label: "Out for Delivery",
    icon: MapPin,
    bg: "bg-violet-50/60",
    border: "border-violet-200",
    headerBg: "bg-violet-50",
    dot: "bg-violet-500",
    textColor: "text-violet-700",
    badgeBg: "bg-violet-100 text-violet-800",
  },
  DELIVERED: {
    label: "Delivered",
    icon: CheckCircle2,
    bg: "bg-emerald-50/60",
    border: "border-emerald-200",
    headerBg: "bg-emerald-50",
    dot: "bg-emerald-500",
    textColor: "text-emerald-700",
    badgeBg: "bg-emerald-100 text-emerald-800",
  },
  CANCELLED: {
    label: "Cancelled",
    icon: XCircle,
    bg: "bg-zinc-50/60",
    border: "border-zinc-200",
    headerBg: "bg-zinc-50",
    dot: "bg-zinc-400",
    textColor: "text-zinc-500",
    badgeBg: "bg-zinc-100 text-zinc-600",
  },
};

// ── Order Card ───────────────────────────────────────────────────────────────

function OrderCard({ order }: { order: AdminBoardOrderItem }) {
  const isCod = order.paymentMode === "COD";

  return (
    <Link
      href={`/admin/orders/${order.id}`}
      className="group flex flex-col gap-2 rounded-xl border border-border/60 bg-white p-3 shadow-sm transition-all hover:border-border hover:shadow-md active:scale-[0.98]"
    >
      {/* Top row: order number + payment mode */}
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-bold text-foreground leading-none group-hover:text-primary transition-colors">
          {order.orderNumber}
        </span>
        <span
          className={cn(
            "flex items-center gap-0.5 shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide",
            isCod
              ? "bg-amber-100 text-amber-800"
              : "bg-blue-100 text-blue-800",
          )}
        >
          {isCod ? (
            <Banknote className="h-2.5 w-2.5" />
          ) : (
            <CreditCard className="h-2.5 w-2.5" />
          )}
          {order.paymentMode}
        </span>
      </div>

      {/* Customer name */}
      <p className="text-xs text-muted-foreground truncate leading-none">
        {order.customerName}
      </p>

      {/* Amount */}
      <p className="text-sm font-semibold text-foreground leading-none">
        {formatPaise(order.total)}
      </p>

      {/* Ship status / action */}
      {order.canShipNow ? (
        <div className="flex items-center gap-1 rounded-lg bg-emerald-50 border border-emerald-200 px-2 py-1">
          <Zap className="h-3 w-3 text-emerald-600 shrink-0" />
          <span className="text-[10px] font-semibold text-emerald-700">
            Ready to ship
          </span>
        </div>
      ) : order.shipBlockReason ? (
        <div className="flex items-center gap-1 rounded-lg bg-amber-50 border border-amber-200 px-2 py-1">
          <AlertTriangle className="h-3 w-3 text-amber-600 shrink-0" />
          <span className="text-[10px] text-amber-700 truncate">
            {order.shipBlockReason}
          </span>
        </div>
      ) : order.awbNumber ? (
        <div className="flex items-center gap-1 rounded-lg bg-indigo-50 border border-indigo-200 px-2 py-1">
          <Truck className="h-3 w-3 text-indigo-600 shrink-0" />
          <span className="text-[10px] font-mono text-indigo-700 truncate">
            {order.awbNumber}
          </span>
        </div>
      ) : null}

      {/* Date */}
      <p className="text-[10px] text-muted-foreground/60 leading-none">
        {formatAdminDate(order.createdAt).split(",")[0]}
      </p>
    </Link>
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
    <div
      className={cn(
        "flex w-[17rem] shrink-0 flex-col rounded-2xl border",
        meta.border,
      )}
    >
      {/* Column header */}
      <div
        className={cn(
          "flex items-center justify-between gap-2 rounded-t-2xl px-3 py-2.5",
          meta.headerBg,
        )}
      >
        <div className="flex items-center gap-2">
          <Icon className={cn("h-4 w-4 shrink-0", meta.textColor)} />
          <span className={cn("text-sm font-semibold", meta.textColor)}>
            {meta.label}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {actionNeeded > 0 && (
            <span className="flex items-center gap-0.5 rounded-full bg-emerald-600 px-1.5 py-0.5 text-[9px] font-bold text-white">
              <Zap className="h-2.5 w-2.5" />
              {actionNeeded}
            </span>
          )}
          <span
            className={cn(
              "flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[11px] font-bold",
              meta.badgeBg,
            )}
          >
            {orders.length}
          </span>
        </div>
      </div>

      {/* Cards */}
      <div
        className={cn(
          "flex flex-col gap-2 overflow-y-auto p-2",
          meta.bg,
          "max-h-[calc(100vh-14rem)] rounded-b-2xl",
        )}
      >
        {orders.length === 0 ? (
          <div className="flex h-24 items-center justify-center">
            <p className="text-xs text-muted-foreground/50">Empty</p>
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
      className="flex gap-2 overflow-x-auto pb-1 scrollbar-none"
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
                ? cn(meta.border, meta.textColor, meta.headerBg, "shadow-sm")
                : "border-border/50 bg-card text-muted-foreground hover:bg-muted/50",
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {meta.label}
            <span
              className={cn(
                "flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[9px] font-bold",
                active ? meta.badgeBg : "bg-muted text-muted-foreground",
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
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border/40 bg-card px-4 py-3 lg:px-6">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={() => router.back()}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Back to orders"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="min-w-0">
            <h1 className="text-base font-bold text-foreground leading-none truncate">
              Order Board
            </h1>
            {loadedAt && (
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {totalOrders} orders · updated {loadedAt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
              </p>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {totalActionNeeded > 0 && (
            <div className="hidden sm:flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-3 py-1">
              <Zap className="h-3.5 w-3.5 text-emerald-600" />
              <span className="text-xs font-semibold text-emerald-700">
                {totalActionNeeded} ready to ship
              </span>
            </div>
          )}
          <button
            type="button"
            onClick={() => void load(true)}
            disabled={loading || refreshing}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
            aria-label="Refresh board"
          >
            <RefreshCw
              className={cn("h-4 w-4", refreshing && "animate-spin")}
            />
          </button>
        </div>
      </div>

      {/* ── States ──────────────────────────────────────────────── */}
      {loading && (
        <div className="flex flex-1 items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <RefreshCw className="h-7 w-7 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Loading board…</p>
          </div>
        </div>
      )}

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
              className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              <RotateCcw className="h-4 w-4" />
              Try again
            </button>
          </div>
        </div>
      )}

      {!loading && !error && board && totalOrders === 0 && (
        <div className="flex flex-1 items-center justify-center p-6">
          <div className="flex flex-col items-center gap-3 text-center">
            <Package className="h-12 w-12 text-muted-foreground/30" />
            <p className="font-semibold text-muted-foreground">No orders on the board</p>
            <p className="text-sm text-muted-foreground/70">
              Orders will appear here once placed.
            </p>
          </div>
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
              <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2">
                <Zap className="h-4 w-4 text-emerald-600 shrink-0" />
                <p className="text-xs font-semibold text-emerald-700">
                  {totalActionNeeded} order{totalActionNeeded !== 1 ? "s" : ""} ready to ship
                </p>
              </div>
            )}

            {/* Active column cards */}
            <div className="flex-1 overflow-y-auto rounded-2xl">
              <div
                className={cn(
                  "rounded-2xl border p-2 flex flex-col gap-2 min-h-full",
                  COLUMN_META[mobileCol].border,
                  COLUMN_META[mobileCol].bg,
                )}
              >
                {(board.columns[mobileCol] ?? []).length === 0 ? (
                  <div className="flex h-32 items-center justify-center">
                    <p className="text-sm text-muted-foreground/50">
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
          <div className="hidden lg:flex flex-1 gap-4 overflow-x-auto p-4 pb-6 lg:p-6 lg:pb-8 items-start">
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
