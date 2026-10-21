"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Loader2, Lock, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Notice, Panel } from "@/components/ui/console";
import { Textarea } from "@/components/ui/textarea";
import { useAdminAuth } from "@/contexts/admin-auth-context";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import { ensureArray, type AdminOrderDetailFull, type AdminOrderTimeline } from "@/lib/admin-api";
import { formatAdminWhen } from "@/lib/admin-format";
import { notifyAdminDataChanged } from "@/lib/admin-data-refresh";
import { getApiErrorMessage } from "@/lib/error-messages";
import { createIdempotencyKey } from "@/lib/idempotency";
import { buildOrderJourney, type JourneyStage } from "@/lib/order-journey";
import type { OrderStatusValue } from "@/lib/order-state-machine";
import { ADMIN_PERMISSIONS, hasAdminPermission } from "@/lib/permissions";
import { shippingProviderLabel } from "@/lib/shipping-provider-labels";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

interface AdminOrderStatusPanelProps {
  order: AdminOrderDetailFull;
  onUpdated?: () => void;
}

const MOVE_VERB: Partial<Record<OrderStatusValue, string>> = {
  PROCESSING: "Mark as processing",
  SHIPPED: "Mark as shipped",
  OUT_FOR_DELIVERY: "Mark out for delivery",
  DELIVERED: "Mark as delivered",
  REFUNDED: "Mark as refunded",
  PAYMENT_FAILED: "Mark payment failed",
};

/**
 * Order progress: every stage of the delivery journey in order.
 * - Stages advance by themselves from courier webhooks and the "check courier" pull
 *   (backend: processShippingWebhook / adminSyncShipmentStatus); this panel refreshes
 *   whenever the order changes.
 * - Passed stages show when and how they happened and are not clickable.
 * - Only moves the API accepts are offered; each asks for confirmation because the
 *   customer is notified.
 */
export function AdminOrderStatusPanel({ order, onUpdated }: AdminOrderStatusPanelProps) {
  const api = useAuthenticatedApi();
  const { adminUser } = useAdminAuth();
  const canWrite = hasAdminPermission(adminUser, ADMIN_PERMISSIONS.ordersWrite);
  const canRefund = hasAdminPermission(adminUser, ADMIN_PERMISSIONS.ordersRefund);

  const [history, setHistory] = useState<AdminOrderTimeline["timeline"]>([]);
  const [pending, setPending] = useState<OrderStatusValue | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const isLocal = Boolean(order.isLocalDelivery);
  const shipment = order.shipment;

  // Re-read history whenever the order's status changes (manual move, webhook, sync).
  const loadHistory = useCallback(async () => {
    try {
      const timeline = await api<AdminOrderTimeline>(`/admin/orders/${order.id}/timeline`);
      setHistory(ensureArray<AdminOrderTimeline["timeline"][number]>(timeline.timeline));
    } catch {
      setHistory([]); // Times are a nicety; the stages still render from the status.
    }
  }, [api, order.id]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory, order.status, order.updatedAt]);

  const journey = buildOrderJourney({
    status: order.status,
    isLocalDelivery: isLocal,
    createdAt: order.createdAt,
    history,
    canRefund,
  });

  async function move(status: OrderStatusValue) {
    setSaving(true);
    try {
      await api(`/admin/orders/${order.id}/status`, {
        method: "PATCH",
        idempotencyKey: createIdempotencyKey(),
        body: JSON.stringify({ status, ...(note.trim() ? { note: note.trim() } : {}) }),
      });
      toast.success(`Order marked ${status === "OUT_FOR_DELIVERY" ? "out for delivery" : status.toLowerCase().replaceAll("_", " ")}.`);
      setPending(null);
      setNote("");
      onUpdated?.();
      notifyAdminDataChanged(["orders", "dashboard", "payments", "shipments"]);
    } catch (err) {
      toast.error(getApiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function syncFromCourier() {
    if (!shipment?.id) return;
    setSyncing(true);
    try {
      const result = await api<{ synced: boolean; message: string }>(`/admin/shipments/${shipment.id}/sync`, {
        method: "POST",
      });
      toast.success(result.message);
      if (result.synced) {
        onUpdated?.();
        notifyAdminDataChanged(["orders", "shipments", "dashboard"]);
      }
    } catch (err) {
      toast.error(getApiErrorMessage(err));
    } finally {
      setSyncing(false);
    }
  }

  const canSync =
    !isLocal && Boolean(shipment?.id && shipment.awb) && !["DELIVERED", "CANCELLED", "REFUNDED"].includes(order.status);

  return (
    <Panel
      title="Order progress"
      description={
        isLocal
          ? "Your team delivers this order — move it along here as you go."
          : shipment
            ? `Updates automatically from ${shippingProviderLabel(shipment.provider)}.`
            : "Updates automatically once the courier is booked."
      }
      actions={
        canSync && canWrite ? (
          <Button type="button" variant="outline" size="sm" onClick={() => void syncFromCourier()} disabled={syncing}>
            {syncing ? <Loader2 className="animate-spin" aria-hidden /> : <RefreshCw aria-hidden />}
            Check courier
          </Button>
        ) : null
      }
    >
      {journey.offTrack ? (
        <Notice tone={journey.offTrack.status === "PENDING_PAYMENT" ? "warning" : "danger"} className="mb-4">
          {journey.offTrack.status === "PENDING_PAYMENT"
            ? "Waiting for payment. The order confirms itself when the payment goes through."
            : journey.offTrack.status === "PAYMENT_FAILED"
              ? "Payment failed. The customer can retry from their account."
              : `This order is ${journey.offTrack.label.toLowerCase()}. No further steps.`}
        </Notice>
      ) : null}

      <ol className="flex flex-col">
        {journey.stages.map((stage, index) => (
          <StageRow
            key={stage.status}
            stage={stage}
            last={index === journey.stages.length - 1}
            canWrite={canWrite}
            selected={pending === stage.status}
            onSelect={() => {
              setPending(stage.status);
              setNote("");
            }}
          />
        ))}
      </ol>

      {canWrite && (journey.canMarkRefunded || journey.canMarkPaymentFailed) && !pending ? (
        <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-4">
          {journey.canMarkPaymentFailed ? (
            <Button type="button" variant="outline" size="sm" onClick={() => setPending("PAYMENT_FAILED")}>
              Mark payment failed
            </Button>
          ) : null}
          {journey.canMarkRefunded ? (
            <Button type="button" variant="outline" size="sm" onClick={() => setPending("REFUNDED")}>
              Mark as refunded
            </Button>
          ) : null}
        </div>
      ) : null}

      {pending ? (
        <div className="mt-4 flex flex-col gap-3 rounded-lg border border-border bg-muted/40 p-3">
          <p className="text-sm text-foreground">
            <span className="font-medium">{MOVE_VERB[pending] ?? "Update status"}?</span>{" "}
            <span className="text-muted-foreground">The customer will be notified.</span>
          </p>
          <Textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={2}
            maxLength={500}
            aria-label="Note (optional, internal)"
            placeholder="Note (optional, internal) — e.g. handed to Ravi for evening delivery"
            disabled={saving}
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="lg" onClick={() => setPending(null)} disabled={saving}>
              Cancel
            </Button>
            <Button type="button" size="lg" loading={saving} onClick={() => void move(pending)}>
              Confirm
            </Button>
          </div>
        </div>
      ) : null}
    </Panel>
  );
}

function StageRow({
  stage,
  last,
  canWrite,
  selected,
  onSelect,
}: {
  stage: JourneyStage;
  last: boolean;
  canWrite: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const actionable = stage.state === "next" && canWrite;
  const meta =
    stage.state === "done" || stage.state === "current"
      ? [stage.at ? formatAdminWhen(stage.at) : null, stage.source].filter(Boolean).join(" · ") || null
      : stage.state === "locked"
        ? "Not yet"
        : null;

  const marker = (
    <span className="flex flex-col items-center self-stretch">
      <span
        aria-hidden
        className={cn(
          "flex size-6 shrink-0 items-center justify-center rounded-full border",
          stage.state === "done" && "border-success bg-success text-white",
          stage.state === "current" && "border-primary bg-primary text-primary-foreground",
          stage.state === "next" && "border-primary/50 bg-card text-primary",
          stage.state === "locked" && "border-border bg-muted text-muted-foreground",
        )}
      >
        {stage.state === "done" ? (
          <Check className="size-3.5" />
        ) : stage.state === "locked" ? (
          <Lock className="size-3" />
        ) : (
          <span className={cn("size-2 rounded-full", stage.state === "current" ? "bg-primary-foreground" : "bg-primary/60")} />
        )}
      </span>
      {!last ? (
        <span aria-hidden className={cn("w-px flex-1", stage.state === "done" ? "bg-success" : "bg-border")} />
      ) : null}
    </span>
  );

  const text = (
    <span className="min-w-0 flex-1 pb-4">
      <span
        className={cn(
          "block text-sm leading-6",
          stage.state === "current" ? "font-semibold text-foreground" : stage.state === "locked" ? "text-muted-foreground" : "text-foreground",
        )}
      >
        {stage.label}
        {stage.state === "current" ? <span className="sr-only"> (current)</span> : null}
      </span>
      {meta ? <span className="block text-xs text-muted-foreground">{meta}</span> : null}
    </span>
  );

  return (
    <li className="flex min-w-0 gap-3">
      {marker}
      {actionable ? (
        <span className="flex min-w-0 flex-1 items-start justify-between gap-2 pb-4">
          <span className="block text-sm leading-6 text-foreground">{stage.label}</span>
          <Button
            type="button"
            variant={selected ? "default" : "outline"}
            size="sm"
            onClick={onSelect}
            aria-pressed={selected}
          >
            {MOVE_VERB[stage.status] ?? "Mark"}
          </Button>
        </span>
      ) : (
        text
      )}
    </li>
  );
}
