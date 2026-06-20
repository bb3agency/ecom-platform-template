import type { Prisma } from '@prisma/client';

/** Release cart reservations for order line variants after checkout completes or is abandoned. */
export async function releaseReservationsForOrder(
  tx: Prisma.TransactionClient,
  orderId: string
): Promise<void> {
  const reservationDelegate = (tx as unknown as { cartReservation?: Prisma.TransactionClient['cartReservation'] })
    .cartReservation;
  if (!reservationDelegate) {
    return;
  }

  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: {
      userId: true,
      items: {
        select: {
          variantId: true
        }
      }
    }
  });
  if (!order?.userId) {
    return;
  }

  const cart = await tx.cart.findFirst({
    where: { userId: order.userId },
    select: { id: true }
  });
  if (!cart) {
    return;
  }

  const variantIds = order.items.map((item) => item.variantId);
  if (variantIds.length === 0) {
    return;
  }

  await reservationDelegate.deleteMany({
    where: {
      cartId: cart.id,
      variantId: {
        in: variantIds
      }
    }
  });
}
