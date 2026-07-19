"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
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

  const canEditItems = order ? EDITABLE_STATUSES.has(order.status) : false;

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

  if (!canWrite) return null;

  return (
    <section className="rounded-xl border border-border bg-card">
      <header className="flex items-center justify-between px-6 py-4">
        <div>
          <h2 className="font-heading text-sm font-semibold">Line items</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {canEditItems
              ? "Quantities editable while PENDING_PAYMENT or CONFIRMED."
              : "Read-only for this order status."}
          </p>
        </div>
        {loading ? <Skeleton className="h-4 w-20" /> : null}
      </header>

      {order ? (
        <>
          <div className="overflow-x-auto border-t border-border">
            <table className="w-full min-w-[520px] text-sm">
              <thead className="bg-muted/30">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Product
                  </th>
                  <th className="px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    SKU
                  </th>
                  <th className="px-3 py-3 text-center text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Qty
                  </th>
                  <th className="px-3 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Unit
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Total
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {order.items.map((item) => (
                  <tr key={item.id} className="transition-colors hover:bg-muted/20">
                    <td className="px-6 py-3.5">
                      <p className="font-medium">{item.productName}</p>
                      <p className="text-xs text-muted-foreground">{item.variantName}</p>
                    </td>
                    <td className="px-3 py-3.5 font-mono text-xs text-muted-foreground">
                      {item.sku}
                    </td>
                    <td className="px-3 py-3.5 text-center">
                      {canEditItems ? (
                        <input
                          className="h-8 w-16 rounded-lg border border-border bg-background px-2 text-center text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                          value={quantities[item.id] ?? ""}
                          onChange={(e) =>
                            setQuantities({ ...quantities, [item.id]: e.target.value })
                          }
                        />
                      ) : (
                        <span className="font-medium">{item.quantity}</span>
                      )}
                    </td>
                    <td className="px-3 py-3.5 text-right text-muted-foreground">
                      {formatPaise(item.unitPrice)}
                    </td>
                    <td className="px-6 py-3.5 text-right font-medium">
                      {formatPaise(item.totalPrice)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="border-t border-border px-6 py-4">
            <dl className="ml-auto grid w-full max-w-xs grid-cols-1 gap-1.5 text-sm">
              <div className="flex items-center justify-between">
                <dt className="text-muted-foreground">Subtotal</dt>
                <dd className="text-foreground">{formatPaise(order.subtotal)}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-muted-foreground">Discount</dt>
                <dd className="text-foreground">
                  {order.discountAmount > 0
                    ? `−${formatPaise(order.discountAmount)}`
                    : formatPaise(0)}
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-muted-foreground">Shipping</dt>
                <dd className="text-foreground">{formatPaise(order.shippingCharge)}</dd>
              </div>
              <div className="mt-1 flex items-center justify-between border-t border-border pt-2 font-semibold">
                <dt>Grand total</dt>
                <dd>{formatPaise(order.total)}</dd>
              </div>
            </dl>
          </div>

          {canEditItems ? (
            <div className="flex items-center gap-3 border-t border-border px-6 py-4">
              <Button
                className="px-4"
                loading={saving}
                onClick={() => void saveItems()}
              >
                {saving ? "Saving…" : "Save changes"}
              </Button>
            </div>
          ) : null}
        </>
      ) : !loading ? (
        <p className="px-6 pb-4 text-sm text-muted-foreground">No line items.</p>
      ) : null}
    </section>
  );
}
