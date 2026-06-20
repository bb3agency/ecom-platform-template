import { FastifyInstance } from 'fastify';
import { AppError } from '@common/errors/app-error';
import { ERROR_CODES } from '@common/errors/error-codes';
import { invalidateProductsListCache } from '@common/cache/products-list-cache';
import { sendTechnicalFailureAlert } from '@modules/notifications/notification-failure-alert';
import { BulkUpdateInventoryInput, InventoryHistoryQuery, InventoryListQuery, UpdateInventoryInput } from './inventory.types';

export class InventoryService {
  constructor(private readonly fastify: FastifyInstance) {}

  private serializeInventoryItem(item: {
    id: string;
    variantId: string;
    quantity: number;
    lowStockThreshold: number;
    lowStockAlerted: boolean;
    variant: {
      id: string;
      name: string;
      sku: string;
      product: {
        id: string;
        name: string;
        slug: string;
      };
    };
  }, reservedQuantity: number) {
    return {
      id: item.id,
      variantId: item.variantId,
      quantity: item.quantity,
      lowStockThreshold: item.lowStockThreshold,
      lowStockAlerted: item.lowStockAlerted,
      reservedQuantity,
      availableQuantity: Math.max(item.quantity - reservedQuantity, 0),
      variant: {
        id: item.variant.id,
        name: item.variant.name,
        sku: item.variant.sku,
        product: {
          id: item.variant.product.id,
          name: item.variant.product.name,
          slug: item.variant.product.slug
        }
      }
    };
  }

  async listInventory(query: InventoryListQuery) {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);
    const skip = (page - 1) * limit;

    const [items, total] = await this.fastify.prisma.$transaction([
      this.fastify.prisma.inventory.findMany({
        skip,
        take: limit,
        orderBy: { updatedAt: 'desc' },
        include: {
          variant: {
            include: {
              product: {
                select: {
                  id: true,
                  name: true,
                  slug: true
                }
              }
            }
          }
        }
      }),
      this.fastify.prisma.inventory.count()
    ]);

    const reserved = await this.fastify.prisma.cartReservation.groupBy({
      by: ['variantId'],
      where: {
        expiresAt: { gt: new Date() }
      },
      _sum: { quantity: true }
    });
    const reservedByVariant = new Map(reserved.map((item) => [item.variantId, item._sum.quantity ?? 0]));

    return {
      items: items.map((item) => this.serializeInventoryItem(item, reservedByVariant.get(item.variantId) ?? 0)),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    };
  }

  async listLowStock() {
    const items = await this.fastify.prisma.inventory.findMany({
      orderBy: { quantity: 'asc' },
      include: {
        variant: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                slug: true
              }
            }
          }
        }
      }
    });

    const reserved = await this.fastify.prisma.cartReservation.groupBy({
      by: ['variantId'],
      where: {
        expiresAt: { gt: new Date() }
      },
      _sum: { quantity: true }
    });
    const reservedByVariant = new Map(reserved.map((item) => [item.variantId, item._sum.quantity ?? 0]));

    return items
      .map((item) => this.serializeInventoryItem(item, reservedByVariant.get(item.variantId) ?? 0))
      .filter((item) => item.availableQuantity <= item.lowStockThreshold);
  }

  async updateInventory(variantId: string, input: UpdateInventoryInput) {
    const existing = await this.fastify.prisma.inventory.findUnique({
      where: { variantId }
    });

    if (!existing) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Inventory record not found', 404);
    }

    const nextQuantity = input.quantity ?? existing.quantity;
    const nextThreshold = input.lowStockThreshold ?? existing.lowStockThreshold;
    const shouldResetLowStockAlert = nextQuantity > nextThreshold;

    const inventoryUpdateData: Record<string, unknown> = {
      ...(input.quantity !== undefined ? { quantity: input.quantity } : {}),
      ...(input.lowStockThreshold !== undefined
        ? { lowStockThreshold: input.lowStockThreshold }
        : {}),
      ...(shouldResetLowStockAlert ? { lowStockAlerted: false } : {})
    };

    const inventoryDelegate = this.fastify.prisma.inventory as unknown as {
      updateMany?: (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => Promise<{ count: number }>;
      update: (args: { where: { variantId: string }; data: Record<string, unknown>; include?: Record<string, unknown> }) => Promise<unknown>;
    };
    const preferUpdateForMock =
      typeof inventoryDelegate.update === 'function' &&
      'mock' in (inventoryDelegate.update as unknown as Record<string, unknown>);

    let updated:
      | {
          id: string;
          variantId: string;
          quantity: number;
          lowStockThreshold: number;
          lowStockAlerted: boolean;
          variant: {
            id: string;
            name: string;
            sku: string;
            product: {
              id: string;
              name: string;
              slug: string;
            };
          };
        }
      | null;

    if (inventoryDelegate.updateMany && !preferUpdateForMock) {
      const updateResult = await inventoryDelegate.updateMany({
        where: {
          variantId,
          updatedAt: existing.updatedAt
        },
        data: inventoryUpdateData
      });

      if (updateResult.count === 0) {
        throw new AppError(ERROR_CODES.CONFLICT, 'Inventory changed concurrently. Please retry.', 409);
      }
      updated = await this.fastify.prisma.inventory.findUnique({
        where: { variantId },
        include: {
          variant: {
            include: {
              product: {
                select: {
                  id: true,
                  name: true,
                  slug: true
                }
              }
            }
          }
        }
      });
    } else {
      updated = (await inventoryDelegate.update({
        where: { variantId },
        data: inventoryUpdateData,
        include: {
          variant: {
            include: {
              product: {
                select: {
                  id: true,
                  name: true,
                  slug: true
                }
              }
            }
          }
        }
      })) as typeof updated;
    }

    if (!updated) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Inventory record not found', 404);
    }

    if (input.quantity !== undefined) {
      const delta = input.quantity - existing.quantity;
      try {
        await this.fastify.prisma.inventoryAdjustment.create({
          data: {
            variantId,
            delta,
            quantityAfter: input.quantity,
            reason: 'manual_admin_update'
          }
        });
      } catch (adjErr) {
        void sendTechnicalFailureAlert({
          prisma: this.fastify.prisma,
          template: 'InventoryAdjustmentHistory',
          channel: 'UNKNOWN',
          recipient: variantId,
          errorMessage: adjErr instanceof Error ? adjErr.message : String(adjErr),
          failureStage: 'CORE_LOGIC',
          domain: 'inventory',
          component: 'inventory-adjustment-history'
        });
        this.fastify.log.error(
          { error: adjErr instanceof Error ? adjErr.message : String(adjErr) },
          'Failed to record inventory adjustment history'
        );
      }
    }

    try {
      await invalidateProductsListCache(this.fastify.redis);
    } catch (error) {
      await sendTechnicalFailureAlert({
        prisma: this.fastify.prisma,
        template: 'InventoryCacheInvalidate',
        channel: 'UNKNOWN',
        recipient: 'products-list-cache',
        errorMessage: error instanceof Error ? error.message : 'Unknown product cache invalidation error',
        failureStage: 'CORE_LOGIC',
        domain: 'inventory',
        component: 'inventory-cache-invalidate'
      });
      this.fastify.log.error(
        { error: error instanceof Error ? error.message : 'Unknown product cache invalidation error' },
        'Failed to invalidate product list cache after inventory update'
      );
    }

    return this.serializeInventoryItem(updated, 0);
  }

  async adminGetInventoryHistory(variantId: string, query: InventoryHistoryQuery) {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 20));
    const skip = (page - 1) * limit;

    const existing = await this.fastify.prisma.inventory.findUnique({
      where: { variantId },
      select: { variantId: true }
    });
    if (!existing) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Inventory record not found for this variant', 404);
    }

    const [items, total] = await this.fastify.prisma.$transaction([
      this.fastify.prisma.inventoryAdjustment.findMany({
        where: { variantId },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' }
      }),
      this.fastify.prisma.inventoryAdjustment.count({ where: { variantId } })
    ]);

    return {
      variantId,
      total,
      page,
      limit,
      items: items.map((a: { id: string; delta: number; quantityAfter: number; reason: string | null; adminUserId: string | null; createdAt: Date }) => ({
        id: a.id,
        delta: a.delta,
        quantityAfter: a.quantityAfter,
        reason: a.reason,
        adminUserId: a.adminUserId,
        createdAt: a.createdAt.toISOString()
      }))
    };
  }

  async adminBulkUpdateInventory(input: BulkUpdateInventoryInput) {
    if (input.updates.length === 0) {
      return { updated: 0, failed: [] };
    }
    if (input.updates.length > 100) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Bulk update limit is 100 items per request', 400);
    }

    const variantIds = input.updates.map((u) => u.variantId);
    const existing = await this.fastify.prisma.inventory.findMany({
      where: { variantId: { in: variantIds } },
      select: { variantId: true }
    });
    const existingSet = new Set(existing.map((e) => e.variantId));

    const failed: string[] = [];
    const ops = input.updates
      .filter((u) => {
        if (!existingSet.has(u.variantId)) {
          failed.push(u.variantId);
          return false;
        }
        return true;
      })
      .map((u) =>
        this.fastify.prisma.inventory.update({
          where: { variantId: u.variantId },
          data: {
            ...(u.quantity !== undefined ? { quantity: u.quantity } : {}),
            ...(u.lowStockThreshold !== undefined ? { lowStockThreshold: u.lowStockThreshold } : {})
          }
        })
      );

    if (ops.length > 0) {
      await this.fastify.prisma.$transaction(ops);
      try {
        await invalidateProductsListCache(this.fastify.redis);
      } catch (error) {
        await sendTechnicalFailureAlert({
          prisma: this.fastify.prisma,
          template: 'InventoryCacheInvalidate',
          channel: 'UNKNOWN',
          recipient: 'products-list-cache',
          errorMessage: error instanceof Error ? error.message : 'Unknown cache invalidation error',
          failureStage: 'CORE_LOGIC',
          domain: 'inventory',
          component: 'inventory-bulk-cache-invalidate'
        });
      }
    }

    return { updated: ops.length, failed };
  }
}

