import type { Prisma } from '@prisma/client';

const COD_INVENTORY_DEDUCTED_TRIGGER = 'COD_ORDER_CREATED';

type CancelInventoryOrder = {
  id: string;
  paymentMode: string | null;
  items: Array<{ variantId: string; quantity: number }>;
  statusHistory?: Array<{ triggeredBy: string | null }>;
};

/** COD inventory is deducted asynchronously by the worker — only restore after that completes. */
export async function shouldRestoreInventoryOnCancel(
  tx: Prisma.TransactionClient,
  order: CancelInventoryOrder
): Promise<boolean> {
  if (order.paymentMode !== 'COD') {
    return true;
  }

  if (order.statusHistory?.some((entry) => entry.triggeredBy === COD_INVENTORY_DEDUCTED_TRIGGER)) {
    return true;
  }

  const workerHistory = await tx.orderStatusHistory.findFirst({
    where: {
      orderId: order.id,
      triggeredBy: COD_INVENTORY_DEDUCTED_TRIGGER
    },
    select: { id: true }
  });
  return workerHistory !== null;
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
