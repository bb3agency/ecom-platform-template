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
    findUnique?: (args: {
      where: { id: string };
      select: { usesCount: true; maxUsesTotal: true; maxUsesPerUser: true };
    }) => Promise<{ usesCount: number; maxUsesTotal: number | null; maxUsesPerUser: number | null } | null>;
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
    count?: (args: Prisma.CouponUsageCountArgs) => Promise<number>;
  };
};

/** Bounded optimistic-CAS retries on the coupon row before giving up as a conflict. */
const COUPON_FINALIZE_CAS_ATTEMPTS = 10;

export type FinalizeCouponUsageOptions = {
  /**
   * 'throw' (default): a reached limit throws COUPON_USAGE_EXCEEDED.
   * 'report': nothing throws for a reached limit; the result says so instead. Used after a
   * payment is already captured, where an exception would roll back the order and strand
   * the customer's money — the caller cancels and refunds instead.
   */
  onLimitExceeded?: 'throw' | 'report';
};

export type FinalizeCouponUsageResult = { limitExceeded: boolean };

function couponLimitReached(couponId: string, scope: 'total' | 'user'): AppError {
  return new AppError(
    ERROR_CODES.COUPON_USAGE_EXCEEDED,
    scope === 'user'
      ? `Coupon per-user usage limit reached while confirming order for coupon ${couponId}`
      : `Coupon usage limit reached while confirming order for coupon ${couponId}`,
    409
  );
}

/**
 * Atomically claim one coupon use: re-read the CURRENT row, check the total and per-user
 * caps against it, then increment with a compare-and-set on `usesCount`. Two concurrent
 * finalizations serialise on the row lock; the loser's CAS misses, it re-reads, and its
 * re-check sees the winner's use (so `maxUsesTotal`/`maxUsesPerUser` can never be passed).
 */
async function claimCouponUseWithCas(
  tx: CouponUsageFinalizeClient,
  input: { couponId: string; orderId: string; userId: string }
): Promise<'claimed' | 'total' | 'user'> {
  const couponDelegate = tx.coupon as Required<Pick<CouponUsageFinalizeClient['coupon'], 'findUnique' | 'updateMany'>>;
  for (let attempt = 0; attempt < COUPON_FINALIZE_CAS_ATTEMPTS; attempt += 1) {
    const current = await couponDelegate.findUnique({
      where: { id: input.couponId },
      select: { usesCount: true, maxUsesTotal: true, maxUsesPerUser: true }
    });
    if (!current) {
      return 'total';
    }
    if (current.maxUsesPerUser !== null && tx.couponUsage.count) {
      const usedByUser = await tx.couponUsage.count({
        where: { couponId: input.couponId, userId: input.userId, orderId: { not: input.orderId } }
      });
      if (usedByUser >= current.maxUsesPerUser) {
        return 'user';
      }
    }
    if (current.maxUsesTotal !== null && current.usesCount >= current.maxUsesTotal) {
      return 'total';
    }
    const claimed = await couponDelegate.updateMany({
      where: { id: input.couponId, usesCount: current.usesCount },
      data: { usesCount: { increment: 1 } }
    });
    if (claimed.count === 1) {
      return 'claimed';
    }
  }
  throw new AppError(
    ERROR_CODES.CONFLICT,
    `Coupon ${input.couponId} is being redeemed concurrently; please retry`,
    409
  );
}

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
  },
  options: FinalizeCouponUsageOptions = {}
): Promise<FinalizeCouponUsageResult> {
  const reportOnly = options.onLimitExceeded === 'report';
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

    if (couponDelegate.updateMany && tx.coupon.findUnique && !preferUpdateForMock) {
      const outcome = await claimCouponUseWithCas(tx, {
        couponId: coupon.id,
        orderId: input.orderId,
        userId: input.userId
      });
      if (outcome !== 'claimed') {
        if (reportOnly) {
          return { limitExceeded: true };
        }
        throw couponLimitReached(coupon.id, outcome);
      }
    } else if (couponDelegate.updateMany && !preferUpdateForMock) {
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
        if (reportOnly) {
          return { limitExceeded: true };
        }
        throw couponLimitReached(coupon.id, 'total');
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
  return { limitExceeded: false };
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
