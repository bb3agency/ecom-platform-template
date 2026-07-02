"use client";

import { useCallback, useEffect, useState } from "react";
import { AdminSection } from "@/components/admin/AdminSection";
import { useAdminAuth } from "@/contexts/admin-auth-context";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import { ORDER_FILTER_STATUSES, type AdminOrderDetailFull } from "@/lib/admin-api";
import { getApiErrorMessage } from "@/lib/error-messages";
import { toast } from "@/lib/toast";
import { createIdempotencyKey } from "@/lib/idempotency";
import { notifyAdminDataChanged } from "@/lib/admin-data-refresh";
import { ADMIN_PERMISSIONS, hasAdminPermission } from "@/lib/permissions";

const inputClass =
  "h-10 w-full rounded-md border border-border bg-background px-3 text-sm";

interface AdminOrderStatusPanelProps {
  orderId: string;
  onUpdated?: () => void;
}

export function AdminOrderStatusPanel({ orderId, onUpdated }: AdminOrderStatusPanelProps) {
  const api = useAuthenticatedApi();
  const { adminUser } = useAdminAuth();
  const canWrite = hasAdminPermission(adminUser, ADMIN_PERMISSIONS.ordersWrite);
  const canRefund = hasAdminPermission(adminUser, ADMIN_PERMISSIONS.ordersRefund);

  const [order, setOrder] = useState<AdminOrderDetailFull | null>(null);
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
  const [status, setStatus] = useState("");
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const detail = await api<AdminOrderDetailFull>(`/admin/orders/${orderId}`);
      setOrder(detail);
      setStatus(detail.status);
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [api, orderId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveStatus() {
    if (!canWrite || !order) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await api(`/admin/orders/${orderId}/status`, {
        method: "PATCH",
        idempotencyKey: createIdempotencyKey(),
        body: JSON.stringify({
          status,
          ...(note.trim() ? { note: note.trim() } : {}),
        }),
      });
      setSuccess("Order status updated.");
      setNote("");
      await load();
      onUpdated?.();
      notifyAdminDataChanged(["orders", "dashboard", "payments", "shipments"]);
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  if (!canWrite) return null;

  return (
    <AdminSection
      title="Update order status"
      description="General status transitions. Refunds and cancellations remain in fulfillment actions."
      loading={loading}
      error={error}
    >
      {order ? (
        <div className="grid max-w-md gap-3">
          <label className="grid gap-1 text-sm">
            Status
            <select className={inputClass} value={status} onChange={(e) => setStatus(e.target.value)}>
              {ORDER_FILTER_STATUSES.filter(
                (value) => value !== "REFUNDED" || canRefund,
              ).map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            Note (optional)
            <textarea
              className="min-h-20 rounded-md border border-border bg-background px-3 py-2 text-sm"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Reason for status change"
            />
          </label>
          <button
            type="button"
            disabled={saving || status === order.status}
            className="h-9 w-fit rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-60"
            onClick={() => void saveStatus()}
          >
            {saving ? "Saving…" : "Update status"}
          </button>
        </div>
      ) : null}
    </AdminSection>
  );
}
