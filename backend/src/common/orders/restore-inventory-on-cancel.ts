import type { Prisma } from '@prisma/client';

const COD_INVENTORY_DEDUCTED_TRIGGER = 'COD_ORDER_CREATED';
/** Written by the order-processing worker once the new-flow PREPAID deduction committed. */
const PREPAID_INVENTORY_DEDUCTED_TRIGGER = 'PREPAID_CONFIRMED';

type CancelInventoryOrder = {
  id: string;
  paymentMode: string | null;
  items: Array<{ variantId: string; quantity: number }>;
  /** Full rows (with from/to status) let the decision skip the DB lookups. */
  statusHistory?: Array<{ triggeredBy: string | null; fromStatus?: string | null; toStatus?: string | null }>;
};

function hasFullHistory(order: CancelInventoryOrder): order is CancelInventoryOrder & {
  statusHistory: Array<{ triggeredBy: string | null; fromStatus: string | null; toStatus: string }>;
} {
  return (
    Array.isArray(order.statusHistory) &&
    order.statusHistory.length > 0 &&
    order.statusHistory.every((entry) => 'toStatus' in entry && 'fromStatus' in entry)
  );
}

async function hasHistoryTrigger(
  tx: Prisma.TransactionClient,
  order: CancelInventoryOrder,
  trigger: string
): Promise<boolean> {
  if (order.statusHistory?.some((entry) => entry.triggeredBy === trigger)) {
    return true;
  }
  const row = await tx.orderStatusHistory.findFirst({
    where: { orderId: order.id, triggeredBy: trigger },
    select: { id: true }
  });
  return Boolean(row);
}

/**
 * Restore stock on cancel only when the order actually took it.
 *
 * - COD: deducted asynchronously by the worker (`COD_ORDER_CREATED` history row).
 * - New-flow PREPAID (confirmPrepaid): the order is BORN `CONFIRMED` (initial history row
 *   `fromStatus: null → CONFIRMED`) and stock is deducted asynchronously by the worker
 *   (`PREPAID_CONFIRMED` history row). Until that row exists nothing left the shelf, so
 *   restoring would mint phantom stock.
 * - Old-flow PREPAID: born `PENDING_PAYMENT` and confirmed by the worker in the same
 *   transaction that deducted stock — unchanged, always restored.
 */
export async function shouldRestoreInventoryOnCancel(
  tx: Prisma.TransactionClient,
  order: CancelInventoryOrder
): Promise<boolean> {
  if (order.paymentMode === 'COD') {
    return hasHistoryTrigger(tx, order, COD_INVENTORY_DEDUCTED_TRIGGER);
  }

  if (hasFullHistory(order)) {
    if (order.statusHistory.some((entry) => entry.triggeredBy === PREPAID_INVENTORY_DEDUCTED_TRIGGER)) {
      return true;
    }
    return !order.statusHistory.some((entry) => entry.fromStatus === null && entry.toStatus === 'CONFIRMED');
  }

  if (await hasHistoryTrigger(tx, order, PREPAID_INVENTORY_DEDUCTED_TRIGGER)) {
    return true;
  }

  const bornConfirmed = await tx.orderStatusHistory.findFirst({
    where: { orderId: order.id, fromStatus: null, toStatus: 'CONFIRMED' },
    select: { id: true }
  });
  return !bornConfirmed;
}

export async function restoreOrderInventoryOnCancel(
  tx: Prisma.TransactionClient,
  order: CancelInventoryOrder
): Promise<void> {
  if (!(await shouldRestoreInventoryOnCancel(tx, order))) {
    return;
  }

  for (const item of order.items) {
    await tx.inventory.updateMany({
      where: { variantId: item.variantId },
      data: {
        quantity: {
          increment: item.quantity
        }
      }
    });
  }
}
