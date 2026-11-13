import { describe, expect, it, vi } from 'vitest';
import {
  restoreOrderInventoryOnCancel,
  shouldRestoreInventoryOnCancel
} from './restore-inventory-on-cancel';

describe('restore-inventory-on-cancel', () => {
  it('always restores prepaid order inventory on cancel', async () => {
    const tx = {
      orderStatusHistory: { findFirst: vi.fn() },
      inventory: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) }
    };

    const shouldRestore = await shouldRestoreInventoryOnCancel(tx as never, {
      id: 'order_1',
      paymentMode: 'PREPAID',
      items: [{ variantId: 'v1', quantity: 2 }]
    });

    expect(shouldRestore).toBe(true);
    await restoreOrderInventoryOnCancel(tx as never, {
      id: 'order_1',
      paymentMode: 'PREPAID',
      items: [{ variantId: 'v1', quantity: 2 }]
    });
    expect(tx.inventory.updateMany).toHaveBeenCalledOnce();
  });

  it('skips COD inventory restore before worker side effects complete', async () => {
    const tx = {
      orderStatusHistory: { findFirst: vi.fn().mockResolvedValue(null) },
      inventory: { updateMany: vi.fn() }
    };

    const shouldRestore = await shouldRestoreInventoryOnCancel(tx as never, {
      id: 'order_cod',
      paymentMode: 'COD',
      items: [{ variantId: 'v1', quantity: 1 }],
      statusHistory: [{ triggeredBy: 'SYSTEM' }]
    });

    expect(shouldRestore).toBe(false);
    await restoreOrderInventoryOnCancel(tx as never, {
      id: 'order_cod',
      paymentMode: 'COD',
      items: [{ variantId: 'v1', quantity: 1 }],
      statusHistory: [{ triggeredBy: 'SYSTEM' }]
    });
    expect(tx.inventory.updateMany).not.toHaveBeenCalled();
  });

  it('restores COD inventory after COD_ORDER_CREATED worker history exists', async () => {
    const tx = {
      orderStatusHistory: { findFirst: vi.fn().mockResolvedValue({ id: 'hist_1' }) },
      inventory: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) }
    };

    const shouldRestore = await shouldRestoreInventoryOnCancel(tx as never, {
      id: 'order_cod',
      paymentMode: 'COD',
      items: [{ variantId: 'v1', quantity: 1 }],
      statusHistory: [{ triggeredBy: 'COD_ORDER_CREATED' }]
    });

    expect(shouldRestore).toBe(true);
    await restoreOrderInventoryOnCancel(tx as never, {
      id: 'order_cod',
      paymentMode: 'COD',
      items: [{ variantId: 'v1', quantity: 1 }],
      statusHistory: [{ triggeredBy: 'COD_ORDER_CREATED' }]
    });
    expect(tx.inventory.updateMany).toHaveBeenCalledOnce();
  });

  it('skips new-flow PREPAID restore before the PREPAID_CONFIRMED deduction ran (no phantom stock)', async () => {
    const findFirst = vi.fn(async (args: { where: { triggeredBy?: string; fromStatus?: null } }) =>
      args.where.fromStatus === null ? { id: 'hist_born_confirmed' } : null
    );
    const tx = {
      orderStatusHistory: { findFirst },
      inventory: { updateMany: vi.fn() }
    };
    const order = {
      id: 'order_new_flow',
      paymentMode: 'PREPAID',
      items: [{ variantId: 'v1', quantity: 3 }],
      statusHistory: [{ triggeredBy: 'SYSTEM' }]
    };

    expect(await shouldRestoreInventoryOnCancel(tx as never, order)).toBe(false);
    await restoreOrderInventoryOnCancel(tx as never, order);
    expect(tx.inventory.updateMany).not.toHaveBeenCalled();
  });

  it('restores new-flow PREPAID inventory once the PREPAID_CONFIRMED history row exists', async () => {
    const tx = {
      orderStatusHistory: { findFirst: vi.fn() },
      inventory: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) }
    };
    const order = {
      id: 'order_new_flow',
      paymentMode: 'PREPAID',
      items: [{ variantId: 'v1', quantity: 3 }],
      statusHistory: [{ triggeredBy: 'SYSTEM' }, { triggeredBy: 'PREPAID_CONFIRMED' }]
    };

    expect(await shouldRestoreInventoryOnCancel(tx as never, order)).toBe(true);
    expect(tx.orderStatusHistory.findFirst).not.toHaveBeenCalled();
  });

  it('restores old-flow PREPAID inventory (born PENDING_PAYMENT, deducted at confirmation)', async () => {
    const tx = {
      orderStatusHistory: { findFirst: vi.fn().mockResolvedValue(null) },
      inventory: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) }
    };

    expect(
      await shouldRestoreInventoryOnCancel(tx as never, {
        id: 'order_old_flow',
        paymentMode: 'PREPAID',
        items: [{ variantId: 'v1', quantity: 1 }],
        statusHistory: [{ triggeredBy: 'PAYMENT_WEBHOOK' }]
      })
    ).toBe(true);
  });
});
