"use client";

import { useState } from "react";
import { Banknote, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Notice } from "@/components/ui/console";
import { useAdminAuth } from "@/contexts/admin-auth-context";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import type { AdminOrderDetailFull } from "@/lib/admin-api";
import { formatAdminWhen, formatPaise } from "@/lib/admin-format";
import { notifyAdminDataChanged } from "@/lib/admin-data-refresh";
import { getApiErrorMessage } from "@/lib/error-messages";
import { createIdempotencyKey } from "@/lib/idempotency";
import { ADMIN_PERMISSIONS, hasAdminPermission } from "@/lib/permissions";
import { toast } from "@/lib/toast";

interface AdminOrderRefundOwedNoticeProps {
  order: AdminOrderDetailFull;
  onUpdated: () => void;
}

/**
 * Shown on a cancelled order whose refund has not reached the customer — most
 * often because the Razorpay balance was too low once the payment had been
 * settled to the bank. The backend keeps retrying automatically for 3 days;
 * this lets the merchant see why and retry now (e.g. after adding funds).
 */
export function AdminOrderRefundOwedNotice({ order, onUpdated }: AdminOrderRefundOwedNoticeProps) {
  const api = useAuthenticatedApi();
  const { adminUser } = useAdminAuth();
  const { confirm, confirmDialog } = useConfirm();
  const [busy, setBusy] = useState(false);

  const owed = order.refundOwed;
  if (!owed) return null;

  const canRefund = hasAdminPermission(adminUser, ADMIN_PERMISSIONS.ordersRefund);
  const amount = formatPaise(owed.amountPaise);

  async function retry() {
    const ok = await confirm({
      title: `Refund ${amount} now?`,
      description:
        "This asks Razorpay to send the money back to the customer. If the Razorpay balance is still too low it will fail again and keep retrying automatically.",
      confirmLabel: "Retry refund",
      tone: "primary",
      icon: Banknote,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api(`/admin/orders/${order.id}/refund/retry`, {
        method: "POST",
        idempotencyKey: createIdempotencyKey(),
      });
      toast.success("Refund sent to Razorpay");
      notifyAdminDataChanged(["orders", "dashboard"]);
      onUpdated();
    } catch (err) {
      toast.error(getApiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Notice
        tone={owed.autoRetrying ? "warning" : "danger"}
        icon={Banknote}
        title={`Refund of ${amount} hasn't reached the customer`}
        action={
          canRefund ? (
            <Button type="button" size="lg" variant="outline" disabled={busy} onClick={() => void retry()}>
              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              Retry refund
            </Button>
          ) : null
        }
      >
        {owed.lastError ? (
          <p>
            Reason: <span className="text-foreground">{owed.lastError}</span>
            {owed.lastFailedAt ? <> ({formatAdminWhen(owed.lastFailedAt)})</> : null}.
          </p>
        ) : (
          <p>The refund didn&apos;t go through.</p>
        )}
        <p className="mt-1">
          {owed.autoRetrying
            ? "It is being retried automatically for up to 3 days — new payments refill the Razorpay balance. If you add funds in the Razorpay dashboard you can retry now."
            : "Automatic retries have stopped. Check the Razorpay balance (add funds if it is low), then retry."}
        </p>
      </Notice>
      {confirmDialog}
    </>
  );
}
