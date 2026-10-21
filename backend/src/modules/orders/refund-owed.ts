import { OrderStatus, PaymentStatus, type Prisma } from '@prisma/client';
import { REFUND_AUTO_RETRY_DELAYS_MS, REFUND_NOTE } from '@common/payments/refund-retry-policy';

/**
 * "Refund still owed": a cancelled, provider-paid order whose money has not
 * gone back — nothing refunded in full, nothing in flight. Derived from the
 * payment row (no extra state to drift):
 *   - status CAPTURED / PARTIALLY_REFUNDED  → not fully refunded
 *   - refundPendingAmountPaise = 0           → no refund currently with the provider
 * A just-cancelled order is excluded for a grace period so the normal refund
 * job (which runs within seconds) never shows up as "owed".
 */
export const REFUND_OWED_GRACE_MS = 10 * 60_000;

const AUTO_RETRY_WINDOW_MS =
  REFUND_AUTO_RETRY_DELAYS_MS.reduce((sum, delay) => sum + delay, 0) + 60 * 60_000;

export function refundOwedWhere(now: Date = new Date()): Prisma.OrderWhereInput {
  return {
    status: OrderStatus.CANCELLED,
    updatedAt: { lt: new Date(now.getTime() - REFUND_OWED_GRACE_MS) },
    payment: {
      is: {
        providerPaymentId: { not: null },
        status: { in: [PaymentStatus.CAPTURED, PaymentStatus.PARTIALLY_REFUNDED] },
        refundPendingAmountPaise: 0
      }
    }
  };
}

export type RefundOwed = {
  amountPaise: number;
  /** True while the refunds worker is still on its automatic retry schedule. */
  autoRetrying: boolean;
  lastError: string | null;
  lastFailedAt: string | null;
};

type HistoryLike = { note: string | null; createdAt: Date; toStatus: string };

const FAILURE_PREFIXES = [REFUND_NOTE.failedRetrying, REFUND_NOTE.stillOwed, REFUND_NOTE.failedAtProvider];

export function buildRefundOwed(
  order: {
    status: string;
    updatedAt: Date;
    payment: {
      providerPaymentId: string | null;
      status: string;
      amount: number;
      refundedAmountPaise: number;
      refundPendingAmountPaise: number;
    } | null;
    statusHistory: HistoryLike[];
  },
  now: Date = new Date(),
  options: { ignoreGracePeriod?: boolean } = {}
): RefundOwed | null {
  const payment = order.payment;
  if (
    order.status !== OrderStatus.CANCELLED ||
    !payment?.providerPaymentId ||
    (payment.status !== PaymentStatus.CAPTURED && payment.status !== PaymentStatus.PARTIALLY_REFUNDED) ||
    payment.refundPendingAmountPaise > 0
  ) {
    return null;
  }
  const amountPaise = Math.max(payment.amount - payment.refundedAmountPaise, 0);
  if (amountPaise <= 0) {
    return null;
  }

  const latestFailure = [...order.statusHistory]
    .filter((row) => row.note !== null && FAILURE_PREFIXES.some((prefix) => row.note!.startsWith(prefix)))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];

  if (!latestFailure && !options.ignoreGracePeriod && now.getTime() - order.updatedAt.getTime() < REFUND_OWED_GRACE_MS) {
    return null;
  }

  const autoRetrying =
    latestFailure !== undefined &&
    !latestFailure.note!.startsWith(REFUND_NOTE.stillOwed) &&
    now.getTime() - latestFailure.createdAt.getTime() < AUTO_RETRY_WINDOW_MS;

  return {
    amountPaise,
    autoRetrying,
    lastError: latestFailure ? extractReason(latestFailure.note!) : null,
    lastFailedAt: latestFailure ? latestFailure.createdAt.toISOString() : null
  };
}

/** "Refund failed (500 paise): <reason>. Retrying…" → "<reason>" (best effort). */
function extractReason(note: string): string {
  const lastError = note.match(/Last error: (.+?)\. Retry from/);
  if (lastError?.[1]) return lastError[1];
  const afterColon = note.match(/\): (.+?)\. Retrying automatically/);
  if (afterColon?.[1]) return afterColon[1];
  return note;
}
