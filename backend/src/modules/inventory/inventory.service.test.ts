import { describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { InventoryService } from './inventory.service';

describe('InventoryService updateInventory low-stock alert reset', () => {
  it('resets lowStockAlerted when restocked above threshold', async () => {
    const findUnique = vi.fn().mockResolvedValue({
      id: 'inv_1',
      variantId: 'variant_1',
      quantity: 2,
      lowStockThreshold: 5,
      lowStockAlerted: true
    });
    const update = vi.fn().mockResolvedValue({
      id: 'inv_1',
      variantId: 'variant_1',
      quantity: 10,
      lowStockThreshold: 5,
      lowStockAlerted: false,
      variant: {
        id: 'variant_1',
        name: 'Variant 1',
        sku: 'SKU-1',
        product: {
          id: 'prod_1',
          name: 'Product 1',
          slug: 'product-1'
        }
      }
    });

    const fastify = {
      prisma: {
        inventory: {
          findUnique,
          update
        }
      },
      redis: {
        scan: vi.fn().mockResolvedValue(['0', []]),
        del: vi.fn().mockResolvedValue(0)
      },
      log: {
        error: vi.fn()
      }
    } as unknown as FastifyInstance;

    const service = new InventoryService(fastify);
    await service.updateInventory('variant_1', { quantity: 10 });

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          quantity: 10,
          lowStockAlerted: false
        })
      })
    );
  });

  it('adminBulkUpdateInventory updates only existing variants and reports failures', async () => {
    const findMany = vi.fn().mockResolvedValue([{ variantId: 'variant_1' }]);
    const update = vi.fn().mockResolvedValue({});
    const $transaction = vi.fn().mockResolvedValue([]);

    const fastify = {
      prisma: {
        inventory: { findMany, update },
        $transaction
      },
      redis: {
        scan: vi.fn().mockResolvedValue(['0', []]),
        del: vi.fn().mockResolvedValue(0)
      },
      log: { error: vi.fn() }
    } as unknown as FastifyInstance;

    const service = new InventoryService(fastify);
    const result = await service.adminBulkUpdateInventory({
      updates: [
        { variantId: 'variant_1', quantity: 50 },
        { variantId: 'variant_missing', quantity: 10 }
      ]
    });

    expect(result.updated).toBe(1);
    expect(result.failed).toEqual(['variant_missing']);
    expect($transaction).toHaveBeenCalledTimes(1);
  });

  it('adminBulkUpdateInventory returns early for empty updates', async () => {
    const fastify = {
      prisma: { inventory: { findMany: vi.fn(), update: vi.fn() }, $transaction: vi.fn() },
      redis: { scan: vi.fn(), del: vi.fn() },
      log: { error: vi.fn() }
    } as unknown as FastifyInstance;

    const service = new InventoryService(fastify);
    const result = await service.adminBulkUpdateInventory({ updates: [] });
    expect(result).toEqual({ updated: 0, failed: [] });
  });

  it('adminBulkUpdateInventory throws for more than 100 items', async () => {
    const fastify = {
      prisma: { inventory: { findMany: vi.fn(), update: vi.fn() }, $transaction: vi.fn() },
      redis: { scan: vi.fn(), del: vi.fn() },
      log: { error: vi.fn() }
    } as unknown as FastifyInstance;

    const service = new InventoryService(fastify);
    const updates = Array.from({ length: 101 }, (_, i) => ({ variantId: `v${i}`, quantity: i }));
    await expect(service.adminBulkUpdateInventory({ updates })).rejects.toThrow();
  });

  it('adminGetInventoryHistory returns paginated adjustment records', async () => {
    const adjustmentDate = new Date('2026-01-15T10:00:00Z');
    const findUnique = vi.fn().mockResolvedValue({ variantId: 'variant_1' });
    const $transaction = vi.fn().mockResolvedValue([
      [{ id: 'adj_1', delta: 10, quantityAfter: 60, reason: 'manual_admin_update', adminUserId: 'admin_1', createdAt: adjustmentDate }],
      1
    ]);

    const fastify = {
      prisma: {
        inventory: { findUnique },
        inventoryAdjustment: { findMany: vi.fn(), count: vi.fn() },
        $transaction
      },
      log: { error: vi.fn() }
    } as unknown as FastifyInstance;

    const service = new InventoryService(fastify);
    const result = await service.adminGetInventoryHistory('variant_1', { page: 1, limit: 20 });

    expect(result.variantId).toBe('variant_1');
    expect(result.total).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ id: 'adj_1', delta: 10, quantityAfter: 60, reason: 'manual_admin_update' });
    expect(result.items[0]!.createdAt).toBe('2026-01-15T10:00:00.000Z');
  });

  it('adminGetInventoryHistory throws NOT_FOUND when variant does not exist', async () => {
    const findUnique = vi.fn().mockResolvedValue(null);

    const fastify = {
      prisma: {
        inventory: { findUnique },
        inventoryAdjustment: {},
        $transaction: vi.fn()
      },
      log: { error: vi.fn() }
    } as unknown as FastifyInstance;

    const service = new InventoryService(fastify);
    await expect(service.adminGetInventoryHistory('missing_variant', {})).rejects.toThrow();
  });

  it('adminGetInventoryHistory respects page and limit params', async () => {
    const findUnique = vi.fn().mockResolvedValue({ variantId: 'variant_1' });
    const $transaction = vi.fn().mockResolvedValue([[], 0]);

    const fastify = {
      prisma: {
        inventory: { findUnique },
        inventoryAdjustment: { findMany: vi.fn(), count: vi.fn() },
        $transaction
      },
      log: { error: vi.fn() }
    } as unknown as FastifyInstance;

    const service = new InventoryService(fastify);
    const result = await service.adminGetInventoryHistory('variant_1', { page: 3, limit: 10 });

    expect(result.page).toBe(3);
    expect(result.limit).toBe(10);
    expect(result.items).toHaveLength(0);
  });

  it('does not reset lowStockAlerted when stock remains at or below threshold', async () => {
    const findUnique = vi.fn().mockResolvedValue({
      id: 'inv_1',
      variantId: 'variant_1',
      quantity: 2,
      lowStockThreshold: 5,
      lowStockAlerted: true
    });
    const update = vi.fn().mockResolvedValue({
      id: 'inv_1',
      variantId: 'variant_1',
      quantity: 5,
      lowStockThreshold: 5,
      lowStockAlerted: true,
      variant: {
        id: 'variant_1',
        name: 'Variant 1',
        sku: 'SKU-1',
        product: {
          id: 'prod_1',
          name: 'Product 1',
          slug: 'product-1'
        }
      }
    });

    const fastify = {
      prisma: {
        inventory: {
          findUnique,
          update
        }
      },
      redis: {
        scan: vi.fn().mockResolvedValue(['0', []]),
        del: vi.fn().mockResolvedValue(0)
      },
      log: {
        error: vi.fn()
      }
    } as unknown as FastifyInstance;

    const service = new InventoryService(fastify);
    await service.updateInventory('variant_1', { quantity: 5 });

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.not.objectContaining({
          lowStockAlerted: false
        })
      })
    );
  });
});
