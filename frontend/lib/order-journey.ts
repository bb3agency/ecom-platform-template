/**
 * The order's delivery journey as a list of stages, for the admin status tracker.
 *
 * Stages advance automatically (payment webhook, courier webhooks, "check courier"
 * sync) or manually. Each stage reports:
 *  - done:    passed — shown with when/how it happened, never clickable again;
 *  - current: where the order is now;
 *  - next:    a move the API accepts right now (lib/order-state-machine.ts);
 *  - locked:  later, but not reachable yet (e.g. Delivered before Shipped).
 */

import { manualNextStatuses, type OrderStatusValue } from "@/lib/order-state-machine";

export type JourneyStageState = "done" | "current" | "next" | "locked";

export interface JourneyHistoryEntry {
  /** Same as toStatus on event rows (refund notes, syncs) — those are not stage changes. */
  fromStatus?: string | null;
  toStatus: string;
  createdAt: string;
  triggeredBy?: string | null;
}

export interface JourneyStage {
  status: OrderStatusValue;
  label: string;
  state: JourneyStageState;
  /** When the order reached this stage, if recorded. */
  at: string | null;
  /** How it got there: "Courier update", "Manual", … */
  source: string | null;
}

export interface OrderJourney {
  stages: JourneyStage[];
  /** Order is outside the normal flow: waiting for / failed payment, cancelled or refunded. */
  offTrack: null | { status: OrderStatusValue; label: string };
  canMarkRefunded: boolean;
  canMarkPaymentFailed: boolean;
}

const COURIER_FLOW: OrderStatusValue[] = ["CONFIRMED", "PROCESSING", "SHIPPED", "OUT_FOR_DELIVERY", "DELIVERED"];
// Local delivery: the store's own team delivers — there is no courier "shipped" hop.
const LOCAL_FLOW: OrderStatusValue[] = ["CONFIRMED", "PROCESSING", "OUT_FOR_DELIVERY", "DELIVERED"];

const STAGE_LABEL: Record<OrderStatusValue, string> = {
  PENDING_PAYMENT: "Awaiting payment",
  PAYMENT_FAILED: "Payment failed",
  CONFIRMED: "Confirmed",
  PROCESSING: "Processing",
  SHIPPED: "Shipped",
  OUT_FOR_DELIVERY: "Out for delivery",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
  REFUNDED: "Refunded",
};

const SOURCE_LABEL: Record<string, string> = {
  ADMIN: "Manual",
  SHIPPING_WEBHOOK: "Courier update",
  SYSTEM: "Automatic",
  CUSTOMER: "Customer",
  COD_ORDER_CREATED: "Order placed",
  PREPAID_CONFIRMED: "Payment received",
};

export function journeySourceLabel(triggeredBy: string | null | undefined): string | null {
  if (!triggeredBy) return null;
  return SOURCE_LABEL[triggeredBy] ?? null;
}

export function buildOrderJourney(input: {
  status: string;
  isLocalDelivery?: boolean;
  createdAt: string;
  history: JourneyHistoryEntry[];
  canRefund?: boolean;
}): OrderJourney {
  const status = input.status as OrderStatusValue;
  const flow = input.isLocalDelivery ? LOCAL_FLOW : COURIER_FLOW;
  const allowed = new Set(
    manualNextStatuses(status, { isLocalDelivery: input.isLocalDelivery, canRefund: input.canRefund }),
  );

  // Latest time each status was reached (history is oldest → newest).
  const reached = new Map<string, JourneyHistoryEntry>();
  // Rows where from === to are events (refund notes, courier syncs), not moves — a
  // refund note written while the order was SHIPPED must not re-date "Shipped".
  for (const entry of input.history) {
    if (entry.fromStatus && entry.fromStatus === entry.toStatus) continue;
    reached.set(entry.toStatus, entry);
  }

  const currentIndex = flow.indexOf(status);
  // Off the main track: before payment, or cancelled/refunded. Progress made before a
  // cancellation still shows as done (from history) — nothing is clickable.
  const offTrack = currentIndex === -1;
  const furthestReached = offTrack
    ? Math.max(-1, ...flow.map((s, i) => (reached.has(s) ? i : -1)))
    : currentIndex;

  const stages: JourneyStage[] = flow.map((stageStatus, i) => {
    const entry = reached.get(stageStatus);
    let state: JourneyStageState;
    if (!offTrack && i === currentIndex) state = "current";
    else if (i <= furthestReached) state = "done";
    else if (allowed.has(stageStatus)) state = "next";
    else state = "locked";

    // CONFIRMED often has no history row (COD orders are created confirmed).
    const at = entry?.createdAt ?? (stageStatus === "CONFIRMED" && (state === "done" || state === "current") ? input.createdAt : null);
    return {
      status: stageStatus,
      label: STAGE_LABEL[stageStatus],
      state,
      at,
      source: journeySourceLabel(entry?.triggeredBy),
    };
  });

  return {
    stages,
    offTrack: offTrack ? { status, label: STAGE_LABEL[status] ?? status } : null,
    canMarkRefunded: allowed.has("REFUNDED"),
    canMarkPaymentFailed: allowed.has("PAYMENT_FAILED"),
  };
}
