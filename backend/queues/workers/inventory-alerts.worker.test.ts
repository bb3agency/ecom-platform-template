import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createInventoryAlertsWorker } from './inventory-alerts.worker';

type InventoryAlertsDeps = NonNullable<Parameters<typeof createInventoryAlertsWorker>[1]>;
type InventoryAlertsWorkerType = NonNullable<InventoryAlertsDeps['Worker']>;
type InventoryAlertsPrismaType = NonNullable<InventoryAlertsDeps['PrismaClient']>;

describe('inventory alerts worker', () => {
  let processor: ((job: { name: string; data: unknown; id?: string }) => Promise<void>) | undefined;
  const inventoryFindMany = vi.fn();
  const inventoryUpdateMany = vi.fn();
  const lowStockAlertEventCreateMany = vi.fn();

  function MockWorker(_name: string, proc: (job: { name: string; data: unknown; id?: string }) => Promise<void>) {
    processor = proc;
  }

  function MockPrismaClient() {
    return {
      inventory: {
        findMany: inventoryFindMany,
        updateMany: inventoryUpdateMany
      },
      lowStockAlertEvent: {
        createMany: lowStockAlertEventCreateMany
      }
    };
  }

  const workerDeps = {
    Worker: MockWorker as unknown as InventoryAlertsWorkerType,
    PrismaClient: MockPrismaClient as unknown as InventoryAlertsPrismaType
  };

  beforeEach(() => {
    processor = undefined;
    inventoryFindMany.mockReset();
    inventoryUpdateMany.mockReset();
    lowStockAlertEventCreateMany.mockReset();
    process.env.ADMIN_ALERT_EMAIL = 'admin@example.com';
  });

  it('marks low-stock rows as alerted and creates alert events', async () => {
    createInventoryAlertsWorker({}, workerDeps);
    inventoryFindMany.mockResolvedValue([
      {
        id: 'inv_1',
        variantId: 'var_1',
        quantity: 2,
        lowStockThreshold: 5,
        variant: {
          product: { name: 'Product 1' },
          id: 'var_1',
          sku: 'SKU-1',
          name: 'Variant 1'
        }
      }
    ]);
    inventoryUpdateMany.mockResolvedValue({ count: 1 });
    lowStockAlertEventCreateMany.mockResolvedValue({ count: 1 });

    await processor?.({ name: 'check-low-stock', data: {}, id: 'job_1' });

    expect(inventoryUpdateMany).toHaveBeenCalledWith({
      where: { id: 'inv_1', lowStockAlerted: false },
      data: { lowStockAlerted: true }
    });
    expect(lowStockAlertEventCreateMany).toHaveBeenCalledWith({
      data: [
        {
          inventoryId: 'inv_1',
          variantId: 'var_1',
          sku: 'SKU-1',
          variantName: 'Variant 1',
          productName: 'Product 1',
          quantity: 2,
          lowStockThreshold: 5
        }
      ]
    });
  });

  it('does nothing when no low-stock items exist', async () => {
    createInventoryAlertsWorker({}, workerDeps);
    inventoryFindMany.mockResolvedValue([]);

    await processor?.({ name: 'check-low-stock', data: {} });

    expect(inventoryUpdateMany).not.toHaveBeenCalled();
    expect(lowStockAlertEventCreateMany).not.toHaveBeenCalled();
  });

  it('skips unknown job names', async () => {
    createInventoryAlertsWorker({}, workerDeps);
    inventoryFindMany.mockResolvedValue([]);

    await processor?.({ name: 'unknown-job', data: {} });

    expect(inventoryFindMany).not.toHaveBeenCalled();
  });
});
