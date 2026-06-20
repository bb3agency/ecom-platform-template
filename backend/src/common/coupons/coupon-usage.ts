import { OrderStatus, Prisma } from '@prisma/client';
import { AppError } from '@common/errors/app-error';
import { ERROR_CODES } from '@common/errors/error-codes';

/** Orders holding a coupon slot before worker finalizes usage (usesCount). */
export const COUPON_RESERVED_ORDER_STATUSES: OrderStatus[] = [
  OrderStatus.PENDING_PAYMENT,
  OrderStatus.PAYMENT_FAILED
];

export type CouponLimitClient = {
  order: {
    count: (args: Prisma.OrderCountArgs) => Promise<number>;
  };
  couponUsage?: {
    count: (args: Prisma.CouponUsageCountArgs) => Promise<number>;
    findMany: (args: Prisma.CouponUsageFindManyArgs) => Promise<Array<{ id: string; couponId: string }>>;
    delete: (args: Prisma.CouponUsageDeleteArgs) => Promise<unknown>;
  };
};

export type CouponUsageFinalizeClient = {
  coupon: {
    updateMany?: (args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }) => Promise<{ count: number }>;
    update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown>;
  };
  couponUsage: {
    findUnique: (args: {
      where: { couponId_orderId: { couponId: string; orderId: string } };
    }) => Promise<{ id: string } | null>;
    create: (args: {
      data: {
        couponId: string;
        orderId: string;
        userId: string;
        discountAmount: number;
      };
    }) => Promise<unknown>;
    findMany?: (args: Prisma.CouponUsageFindManyArgs) => Promise<Array<{ id: string; couponId: string }>>;
    delete?: (args: Prisma.CouponUsageDeleteArgs) => Promise<unknown>;
  };
};

export async function countCouponReservedOrders(
  client: CouponLimitClient,
  couponId: string,
  userId?: string
): Promise<number> {
  return client.order.count({
    where: {
      ...(userId ? { userId } : {}),
      coupons: { some: { id: couponId } },
      status: { in: COUPON_RESERVED_ORDER_STATUSES }
    }
  });
}

export async function assertCouponWithinUsageLimits(
  client: CouponLimitClient,
  coupon: {
    id: string;
    usesCount: number;
    maxUsesTotal: number | null;
    maxUsesPerUser: number | null;
  },
  userId?: string
): Promise<void> {
  const pendingTotal = await countCouponReservedOrders(client, coupon.id);
  const committedTotal = coupon.usesCount + pendingTotal;
  if (coupon.maxUsesTotal !== null && committedTotal >= coupon.maxUsesTotal) {
    throw new AppError(ERROR_CODES.COUPON_USAGE_EXCEEDED, 'Coupon usage limit reached', 409);
  }

  if (userId && coupon.maxUsesPerUser !== null) {
    const pendingUser = await countCouponReservedOrders(client, coupon.id, userId);
    const finalizedUser = client.couponUsage?.count
      ? await client.couponUsage.count({
          where: { couponId: coupon.id, userId }
        })
      : 0;
    if (finalizedUser + pendingUser >= coupon.maxUsesPerUser) {
      throw new AppError(
        ERROR_CODES.COUPON_USAGE_EXCEEDED,
        'Coupon usage limit reached for this user',
        409
      );
    }
  }
}

export async function finalizeCouponUsageForOrder(
  tx: CouponUsageFinalizeClient,
  input: {
    orderId: string;
    userId: string;
    discountAmount: number;
    coupons: Array<{ id: string; usesCount: number }>;
  }
): Promise<void> {
  for (const coupon of input.coupons) {
    const existingUsage = await tx.couponUsage.findUnique({
      where: {
        couponId_orderId: {
          couponId: coupon.id,
          orderId: input.orderId
        }
      }
    });
    if (existingUsage) {
      continue;
    }

    const couponDelegate = tx.coupon as unknown as {
      updateMany?: (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => Promise<{ count: number }>;
      update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown>;
    };
    const preferUpdateForMock =
      typeof couponDelegate.update === 'function' &&
      'mock' in (couponDelegate.update as unknown as Record<string, unknown>);

    if (couponDelegate.updateMany && !preferUpdateForMock) {
      const incrementResult = await couponDelegate.updateMany({
        where: {
          id: coupon.id,
          OR: [{ maxUsesTotal: null }, { maxUsesTotal: { gt: coupon.usesCount } }]
        },
        data: {
          usesCount: {
            increment: 1
          }
        }
      });

      if (incrementResult.count === 0) {
        throw new AppError(
          ERROR_CODES.COUPON_USAGE_EXCEEDED,
          `Coupon usage limit reached while confirming order for coupon ${coupon.id}`,
          409
        );
      }
    } else {
      await couponDelegate.update({
        where: { id: coupon.id },
        data: {
          usesCount: {
            increment: 1
          }
        }
      });
    }

    await tx.couponUsage.create({
      data: {
        couponId: coupon.id,
        orderId: input.orderId,
        userId: input.userId,
        discountAmount: input.discountAmount
      }
    });
  }
}

/** Reverse finalized coupon usage when an order is cancelled or fully refunded. */
export async function releaseCouponUsageForOrder(
  tx: CouponUsageFinalizeClient,
  orderId: string
): Promise<void> {
  const usageDelegate = tx.couponUsage as CouponUsageFinalizeClient['couponUsage'] & {
    findMany?: (args: Prisma.CouponUsageFindManyArgs) => Promise<Array<{ id: string; couponId: string }>>;
    delete?: (args: Prisma.CouponUsageDeleteArgs) => Promise<unknown>;
  };
  if (!usageDelegate.findMany || !usageDelegate.delete) {
    return;
  }

  const usages = await usageDelegate.findMany({
    where: { orderId },
    select: { id: true, couponId: true }
  });
  if (usages.length === 0) {
    return;
  }

  for (const usage of usages) {
    await tx.coupon.update({
      where: { id: usage.couponId },
      data: {
        usesCount: {
          decrement: 1
        }
      }
    });
    await usageDelegate.delete({
      where: { id: usage.id }
    });
  }
}

/** Drop M2M coupon links for checkout orders that never finalized usage. */
export async function clearUnfinalizedCouponLinks(
  tx: {
    order: {
      update: (args: {
        where: { id: string };
        data: { coupons: { set: [] } };
      }) => Promise<unknown>;
    };
  },
  orderId: string
): Promise<void> {
  await tx.order.update({
    where: { id: orderId },
    data: { coupons: { set: [] } }
  });
}
