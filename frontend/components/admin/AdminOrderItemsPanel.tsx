"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Panel } from "@/components/ui/console";
import { useAdminAuth } from "@/contexts/admin-auth-context";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import {
  ensureArray,
  type AdminOrderDetailFull,
  type AdminOrderLineItem,
} from "@/lib/admin-api";
import { formatPaise } from "@/lib/admin-format";
import { getApiErrorMessage } from "@/lib/error-messages";
import { toast } from "@/lib/toast";
import { createIdempotencyKey } from "@/lib/idempotency";
import { notifyAdminDataChanged } from "@/lib/admin-data-refresh";
import { ADMIN_PERMISSIONS, hasAdminPermission } from "@/lib/permissions";

const EDITABLE_STATUSES = new Set(["PENDING_PAYMENT", "CONFIRMED"]);

interface AdminOrderItemsPanelProps {
  orderId: string;
  onUpdated?: () => void;
}

export function AdminOrderItemsPanel({ orderId, onUpdated }: AdminOrderItemsPanelProps) {
  const api = useAuthenticatedApi();
  const { adminUser } = useAdminAuth();
  const canWrite = hasAdminPermission(adminUser, ADMIN_PERMISSIONS.ordersWrite);

  const [order, setOrder] = useState<AdminOrderDetailFull | null>(null);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Surface transient error/success as global toast popups instead of large in-panel banners.
  useEffect(() => {
    if (error) toast.error(error);
  }, [error]);
  useEffect(() => {
    if (success) toast.success(success);
  }, [success]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const detail = await api<AdminOrderDetailFull>(`/admin/orders/${orderId}`);
      const normalized = {
        ...detail,
        items: ensureArray<AdminOrderLineItem>(detail.items),
      };
      setOrder(normalized);
      const next: Record<string, string> = {};
      for (const item of normalized.items) {
        next[item.id] = String(item.quantity);
      }
      setQuantities(next);
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [api, orderId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Read-only admins still see the items; only editing needs orders:write.
  const canEditItems = canWrite && order ? EDITABLE_STATUSES.has(order.status) : false;

  async function saveItems() {
    if (!canWrite || !order || !canEditItems) return;
    const updates = order.items
      .map((item) => {
        const quantity = Number(quantities[item.id]);
        if (!Number.isFinite(quantity) || quantity < 1) return null;
        if (quantity === item.quantity) return null;
        return { orderItemId: item.id, quantity: Math.round(quantity) };
      })
      .filter(
        (u): u is { orderItemId: string; quantity: number } => u !== null,
      );

    if (updates.length === 0) {
      setError("Change at least one line item quantity before saving.");
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await api(`/admin/orders/${orderId}/items`, {
        method: "PATCH",
        idempotencyKey: createIdempotencyKey(),
        body: JSON.stringify({ updates }),
      });
      setSuccess("Line items updated.");
      await load();
      onUpdated?.();
      notifyAdminDataChanged(["orders", "dashboard", "payments", "inventory"]);
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const dirty = order ? order.items.some((item) => (quantities[item.id] ?? "") !== String(item.quantity)) : false;

  return (
    <Panel
      title="Items"
      description={
        canEditItems
          ? "You can change quantities until the order is being processed."
          : order
            ? `${order.items.length} ${order.items.length === 1 ? "item" : "items"}`
            : undefined
      }
      flush
      footer={
        canEditItems && dirty ? (
          <>
            <p className="text-sm text-muted-foreground">Totals and stock update when you save.</p>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="lg"
                disabled={saving}
                onClick={() =>
                  order &&
                  setQuantities(Object.fromEntries(order.items.map((i) => [i.id, String(i.quantity)])))
                }
              >
                Discard
              </Button>
              <Button type="button" size="lg" loading={saving} onClick={() => void saveItems()}>
                Save changes
              </Button>
            </div>
          </>
        ) : undefined
      }
    >
      {loading && !order ? (
        <div className="space-y-3 p-4 sm:p-5">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : order && order.items.length > 0 ? (
        <>
          <ul className="divide-y divide-border">
            {order.items.map((item) => (
              <li key={item.id} className="flex min-w-0 items-center gap-3 px-4 py-3 sm:px-5">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-foreground">{item.productName}</p>
                  <p className="text-xs text-muted-foreground">
                    {item.variantName} · <span className="tabular">{item.sku}</span>
                  </p>
                </div>
                <div className="shrink-0">
                  {canEditItems ? (
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      aria-label={`Quantity of ${item.productName} ${item.variantName}`}
                      className="h-9 w-16 rounded-lg border border-input bg-card px-2 text-center text-sm tabular outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
                      value={quantities[item.id] ?? ""}
                      onChange={(e) => setQuantities({ ...quantities, [item.id]: e.target.value.replace(/[^0-9]/g, "") })}
                    />
                  ) : (
                    <span className="text-sm text-muted-foreground tabular">× {item.quantity}</span>
                  )}
                </div>
                <div className="w-24 shrink-0 text-right">
                  <p className="font-medium text-foreground tabular">{formatPaise(item.totalPrice)}</p>
                  <p className="text-xs text-muted-foreground tabular">{formatPaise(item.unitPrice)} each</p>
                </div>
              </li>
            ))}
          </ul>
          <dl className="ml-auto grid w-full max-w-xs grid-cols-1 gap-1.5 border-t border-border px-4 py-4 text-sm sm:px-5">
            <div className="flex items-center justify-between">
              <dt className="text-muted-foreground">Subtotal</dt>
              <dd className="tabular">{formatPaise(order.subtotal)}</dd>
            </div>
            {order.discountAmount > 0 ? (
              <div className="flex items-center justify-between">
                <dt className="text-muted-foreground">Discount</dt>
                <dd className="tabular">−{formatPaise(order.discountAmount)}</dd>
              </div>
            ) : null}
            <div className="flex items-center justify-between">
              <dt className="text-muted-foreground">Shipping</dt>
              <dd className="tabular">{order.shippingCharge > 0 ? formatPaise(order.shippingCharge) : "Free"}</dd>
            </div>
            <div className="mt-1 flex items-center justify-between border-t border-border pt-2 font-semibold">
              <dt>Total</dt>
              <dd className="tabular">{formatPaise(order.total)}</dd>
            </div>
          </dl>
        </>
      ) : (
        <p className="p-4 text-sm text-muted-foreground sm:p-5">No items on this order.</p>
      )}
    </Panel>
  );
}
