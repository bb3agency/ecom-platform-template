import { OrderStatus } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import {
  assertCouponWithinUsageLimits,
  clearUnfinalizedCouponLinks,
  COUPON_RESERVED_ORDER_STATUSES,
  countCouponReservedOrders,
  finalizeCouponUsageForOrder,
  releaseCouponUsageForOrder
} from './coupon-usage';

describe('coupon usage helpers', () => {
  it('reserves coupons for pending payment and payment failed orders', () => {
    expect(COUPON_RESERVED_ORDER_STATUSES).toEqual([
      OrderStatus.PENDING_PAYMENT,
      OrderStatus.PAYMENT_FAILED
    ]);
    expect(COUPON_RESERVED_ORDER_STATUSES).not.toContain(OrderStatus.CONFIRMED);
    expect(COUPON_RESERVED_ORDER_STATUSES).not.toContain(OrderStatus.REFUNDED);
    expect(COUPON_RESERVED_ORDER_STATUSES).not.toContain(OrderStatus.CANCELLED);
  });

  it('counts reserved coupon orders globally and per user', async () => {
    const count = vi
      .fn()
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(1);
    const client = { order: { count } };

    await expect(countCouponReservedOrders(client, 'coupon_1')).resolves.toBe(3);
    await expect(countCouponReservedOrders(client, 'coupon_1', 'user_1')).resolves.toBe(1);

    expect(count).toHaveBeenNthCalledWith(1, {
      where: {
        coupons: { some: { id: 'coupon_1' } },
        status: { in: COUPON_RESERVED_ORDER_STATUSES }
      }
    });
    expect(count).toHaveBeenNthCalledWith(2, {
      where: {
        userId: 'user_1',
        coupons: { some: { id: 'coupon_1' } },
        status: { in: COUPON_RESERVED_ORDER_STATUSES }
      }
    });
  });

  it('rejects when usesCount plus pending orders reach total limit', async () => {
    const client = {
      order: {
        count: vi.fn().mockResolvedValue(1)
      },
      couponUsage: {
        count: vi.fn(),
        findMany: vi.fn(),
        delete: vi.fn()
      }
    };

    await expect(
      assertCouponWithinUsageLimits(
        client,
        { id: 'coupon_1', usesCount: 4, maxUsesTotal: 5, maxUsesPerUser: null }
      )
    ).rejects.toMatchObject({ code: 'COUPON_USAGE_EXCEEDED' });
  });

  it('rejects when finalized plus pending per-user usage reaches limit', async () => {
    const client = {
      order: {
        count: vi.fn().mockResolvedValueOnce(0).mockResolvedValueOnce(1)
      },
      couponUsage: {
        count: vi.fn().mockResolvedValue(1),
        findMany: vi.fn(),
        delete: vi.fn()
      }
    };

    await expect(
      assertCouponWithinUsageLimits(
        client,
        { id: 'coupon_1', usesCount: 0, maxUsesTotal: 10, maxUsesPerUser: 2 },
        'user_1'
      )
    ).rejects.toMatchObject({ code: 'COUPON_USAGE_EXCEEDED' });

    await expect(
      assertCouponWithinUsageLimits(
        client,
        { id: 'coupon_1', usesCount: 0, maxUsesTotal: 10, maxUsesPerUser: 2 },
        'user_1'
      )
    ).resolves.toBeUndefined();
  });

  it('allows reuse after refund when only usesCount reflects finalized orders', async () => {
    const client = {
      order: {
        count: vi.fn().mockResolvedValue(0)
      },
      couponUsage: {
        count: vi.fn().mockResolvedValue(0),
        findMany: vi.fn(),
        delete: vi.fn()
      }
    };

    await expect(
      assertCouponWithinUsageLimits(
        client,
        { id: 'coupon_1', usesCount: 0, maxUsesTotal: 1, maxUsesPerUser: 1 },
        'user_1'
      )
    ).resolves.toBeUndefined();
  });

  it('finalizes coupon usage idempotently after successful payment', async () => {
    const tx = {
      couponUsage: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue(undefined)
      },
      coupon: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        update: vi.fn().mockResolvedValue(undefined)
      }
    };

    await finalizeCouponUsageForOrder(tx, {
      orderId: 'order_1',
      userId: 'user_1',
      discountAmount: 500,
      coupons: [{ id: 'coupon_1', usesCount: 2 }]
    });

    expect(tx.coupon.update).toHaveBeenCalledOnce();
    expect(tx.couponUsage.create).toHaveBeenCalledWith({
      data: {
        couponId: 'coupon_1',
        orderId: 'order_1',
        userId: 'user_1',
        discountAmount: 500
      }
    });

    tx.couponUsage.findUnique.mockResolvedValueOnce({ id: 'usage_1' });
    await finalizeCouponUsageForOrder(tx, {
      orderId: 'order_1',
      userId: 'user_1',
      discountAmount: 500,
      coupons: [{ id: 'coupon_1', usesCount: 3 }]
    });

    expect(tx.coupon.update).toHaveBeenCalledOnce();
    expect(tx.couponUsage.create).toHaveBeenCalledOnce();
  });

  it('releases finalized coupon usage on cancel or refund', async () => {
    const tx = {
      couponUsage: {
        findUnique: vi.fn(),
        create: vi.fn(),
        findMany: vi.fn().mockResolvedValue([{ id: 'usage_1', couponId: 'coupon_1' }]),
        delete: vi.fn().mockResolvedValue(undefined)
      },
      coupon: {
        update: vi.fn().mockResolvedValue(undefined)
      }
    };

    await releaseCouponUsageForOrder(tx, 'order_1');

    expect(tx.coupon.update).toHaveBeenCalledWith({
      where: { id: 'coupon_1' },
      data: { usesCount: { decrement: 1 } }
    });
    expect(tx.couponUsage.delete).toHaveBeenCalledWith({ where: { id: 'usage_1' } });
  });

  it('clears unfinalized coupon links without changing usesCount', async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    await clearUnfinalizedCouponLinks({ order: { update } }, 'order_1');
    expect(update).toHaveBeenCalledWith({
      where: { id: 'order_1' },
      data: { coupons: { set: [] } }
    });
  });

  describe('atomic finalize (CAS on the live row)', () => {
    function casTx(rows: Array<{ usesCount: number; maxUsesTotal: number | null; maxUsesPerUser: number | null }>, perUserUsed = 0) {
      const findUnique = vi.fn();
      rows.forEach((row) => findUnique.mockResolvedValueOnce(row));
      return {
        coupon: {
          findUnique,
          updateMany: vi.fn(),
          // Plain function: the atomic path is taken only when update is not a vi mock.
          update: async () => undefined
        },
        couponUsage: {
          findUnique: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue(undefined),
          count: vi.fn().mockResolvedValue(perUserUsed)
        }
      };
    }
    const input = { orderId: 'order_1', userId: 'user_1', discountAmount: 500, coupons: [{ id: 'coupon_1', usesCount: 0 }] };

    it('increments with a compare-and-set on the freshly read usesCount', async () => {
      const tx = casTx([{ usesCount: 7, maxUsesTotal: 10, maxUsesPerUser: null }]);
      tx.coupon.updateMany.mockResolvedValue({ count: 1 });

      await expect(finalizeCouponUsageForOrder(tx, input)).resolves.toEqual({ limitExceeded: false });

      expect(tx.coupon.updateMany).toHaveBeenCalledWith({
        where: { id: 'coupon_1', usesCount: 7 },
        data: { usesCount: { increment: 1 } }
      });
      expect(tx.couponUsage.create).toHaveBeenCalledOnce();
    });

    it('re-reads after losing the race and refuses the slot the winner took (cap 100 never becomes 101)', async () => {
      const tx = casTx([
        { usesCount: 99, maxUsesTotal: 100, maxUsesPerUser: null },
        { usesCount: 100, maxUsesTotal: 100, maxUsesPerUser: null }
      ]);
      tx.coupon.updateMany.mockResolvedValueOnce({ count: 0 });

      await expect(finalizeCouponUsageForOrder(tx, input)).rejects.toMatchObject({ code: 'COUPON_USAGE_EXCEEDED' });
      expect(tx.coupon.updateMany).toHaveBeenCalledTimes(1);
      expect(tx.couponUsage.create).not.toHaveBeenCalled();
    });

    it('enforces maxUsesPerUser at finalize (a once-per-user coupon cannot be redeemed twice)', async () => {
      const tx = casTx([{ usesCount: 3, maxUsesTotal: null, maxUsesPerUser: 1 }], 1);

      await expect(finalizeCouponUsageForOrder(tx, input)).rejects.toMatchObject({ code: 'COUPON_USAGE_EXCEEDED' });
      expect(tx.couponUsage.count).toHaveBeenCalledWith({
        where: { couponId: 'coupon_1', userId: 'user_1', orderId: { not: 'order_1' } }
      });
      expect(tx.coupon.updateMany).not.toHaveBeenCalled();
    });

    it("reports instead of throwing in 'report' mode (post-capture callers)", async () => {
      const tx = casTx([{ usesCount: 5, maxUsesTotal: 5, maxUsesPerUser: null }]);

      await expect(
        finalizeCouponUsageForOrder(tx, input, { onLimitExceeded: 'report' })
      ).resolves.toEqual({ limitExceeded: true });
      expect(tx.couponUsage.create).not.toHaveBeenCalled();
    });
  });
});
