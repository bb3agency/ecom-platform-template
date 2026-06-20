import { Worker, type ConnectionOptions } from 'bullmq';
import { PrismaClient as RealPrismaClient } from '@prisma/client';
import { sendTechnicalFailureAlert } from '../../src/modules/notifications/notification-failure-alert';

type InventoryAlertsWorkerDeps = {
  PrismaClient?: typeof RealPrismaClient;
  Worker?: typeof Worker;
};

export function createInventoryAlertsWorker(
  connection: ConnectionOptions,
  deps?: InventoryAlertsWorkerDeps
): Worker {
  const PrismaClientCtor = deps?.PrismaClient ?? RealPrismaClient;
  const WorkerCtor = deps?.Worker ?? Worker;
  const prisma = new PrismaClientCtor();

  return new WorkerCtor(
    'inventory-alerts',
    async (job) => {
      if (job.name !== 'check-low-stock') {
        return;
      }

      const candidateItems = await prisma.inventory.findMany({
        where: {
          lowStockAlerted: false
        },
        include: {
          variant: {
            select: {
              product: {
                select: {
                  name: true
                }
              },
              id: true,
              sku: true,
              name: true
            }
          }
        }
      });
      const reservationDelegate = (prisma as unknown as { cartReservation?: RealPrismaClient['cartReservation'] }).cartReservation;
      const reserved = reservationDelegate
        ? await reservationDelegate.groupBy({
            by: ['variantId'],
            where: {
              expiresAt: { gt: new Date() }
            },
            _sum: { quantity: true }
          })
        : [];
      const reservedByVariant = new Map(reserved.map((item) => [item.variantId, item._sum.quantity ?? 0]));
      const lowStockItems = candidateItems
        .map((item) => {
          const reservedQuantity = reservedByVariant.get(item.variantId) ?? 0;
          const availableQuantity = Math.max(item.quantity - reservedQuantity, 0);
          return {
            ...item,
            availableQuantity
          };
        })
        .filter((item) => item.availableQuantity <= item.lowStockThreshold);

      if (lowStockItems.length === 0) {
        return;
      }

      const claimedItems: typeof lowStockItems = [];
      for (const item of lowStockItems) {
        const claimResult = await prisma.inventory.updateMany({
          where: {
            id: item.id,
            lowStockAlerted: false
          },
          data: {
            lowStockAlerted: true
          }
        });

        if (claimResult.count > 0) {
          claimedItems.push(item);
        }
      }

      if (claimedItems.length === 0) {
        return;
      }

      void sendTechnicalFailureAlert({
        prisma,
        template: 'LowStockAlert',
        channel: 'UNKNOWN',
        recipient: 'inventory-alerts-worker',
        errorMessage: `Low stock detected for ${claimedItems.length} item(s): ${claimedItems.map((i) => i.variant.sku).join(', ')}`,
        failureStage: 'CORE_LOGIC',
        queueName: 'inventory-alerts',
        jobName: job.name,
        jobId: job.id ?? 'unknown',
        domain: 'inventory',
        component: 'inventory-alerts-worker',
        terminalFailure: false
      });

      await prisma.lowStockAlertEvent.createMany({
        data: claimedItems.map((item) => ({
          inventoryId: item.id,
          variantId: item.variantId,
          sku: item.variant.sku,
          variantName: item.variant.name,
          productName: item.variant.product.name,
          quantity: item.availableQuantity,
          lowStockThreshold: item.lowStockThreshold
        }))
      });
    },
    { connection }
  );
}

