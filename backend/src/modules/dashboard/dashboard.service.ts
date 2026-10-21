import { OrderStatus, ReturnRequestStatus } from '@prisma/client';
import { refundOwedWhere } from '@modules/orders/refund-owed';
import { FastifyInstance } from 'fastify';
import { AppError } from '@common/errors/app-error';
import { ERROR_CODES } from '@common/errors/error-codes';
import {
  DashboardGranularity,
  DashboardKpisQuery,
  DashboardOrderStatusCountsQuery,
  DashboardPeriod,
  DashboardSalesChartQuery,
  DashboardTopProductsQuery
} from './dashboard.types';

/** Upper bound on zero-filled chart buckets, so a wide hourly range cannot balloon the payload. */
const MAX_CHART_BUCKETS = 1000;

const includedStatuses: OrderStatus[] = [
  OrderStatus.CONFIRMED,
  OrderStatus.PROCESSING,
  OrderStatus.SHIPPED,
  OrderStatus.OUT_FOR_DELIVERY,
  OrderStatus.DELIVERED,
  OrderStatus.REFUNDED
];

export class DashboardService {
  constructor(private readonly fastify: FastifyInstance) {}

  async getKpis(query: DashboardKpisQuery) {
    const { period, from, to } = this.resolveRange(query.period, query.from, query.to);
    const where = { createdAt: { gte: from, lte: to }, status: { in: includedStatuses } };

    const [ordersCount, revenueAgg, customersCount] = await this.fastify.prisma.$transaction([
      this.fastify.prisma.order.count({ where }),
      this.fastify.prisma.order.aggregate({
        where,
        _sum: { total: true }
      }),
      this.fastify.prisma.user.count({
        where: {
          role: 'CUSTOMER',
          createdAt: { gte: from, lte: to }
        }
      })
    ]);

    const revenuePaise = revenueAgg._sum?.total ?? 0;
    const averageOrderValuePaise = ordersCount > 0 ? Math.round(revenuePaise / ordersCount) : 0;

    return {
      period,
      from: from.toISOString(),
      to: to.toISOString(),
      ordersCount,
      revenuePaise,
      averageOrderValuePaise,
      customersCount
    };
  }

  async getSalesChart(query: DashboardSalesChartQuery) {
    const granularity: DashboardGranularity = query.granularity ?? 'day';
    const { from, to } = this.resolveRange('30d', query.from, query.to);
    const orders = await this.fastify.prisma.order.findMany({
      where: {
        createdAt: { gte: from, lte: to },
        status: { in: includedStatuses }
      },
      select: {
        createdAt: true,
        total: true
      },
      orderBy: { createdAt: 'asc' }
    });

    const buckets = new Map<string, { ordersCount: number; revenuePaise: number }>();
    for (const order of orders) {
      const key = this.getBucketKey(order.createdAt, granularity);
      const existing = buckets.get(key);
      if (existing) {
        existing.ordersCount += 1;
        existing.revenuePaise += order.total;
      } else {
        buckets.set(key, { ordersCount: 1, revenuePaise: order.total });
      }
    }

    // Zero-fill every bucket in the range. Sparse points made charts draw a straight
    // line across quiet days and spaced the x-axis by data, not by time.
    const keys = this.enumerateBucketKeys(from, to, granularity);
    const points = (keys ?? Array.from(buckets.keys()).sort()).map((bucket) => {
      const value = buckets.get(bucket);
      return {
        bucket,
        ordersCount: value?.ordersCount ?? 0,
        revenuePaise: value?.revenuePaise ?? 0
      };
    });

    return { granularity, points };
  }

  /**
   * What needs the merchant's attention right now — the admin dashboard leads with this.
   * Each count matches the list it links to (same filters), so a click-through never
   * shows a different number.
   */
  async getActionQueue() {
    const prisma = this.fastify.prisma;
    // One count per status (not CONFIRMED+PROCESSING combined) so every number
    // equals the list it links to — the orders list filters by a single status.
    const [ordersToFulfil, ordersProcessing, ordersAwaitingPayment, refundsOwed, returnsToReview, reviewsToModerate, inventory, reserved] =
      await Promise.all([
        prisma.order.count({ where: { status: OrderStatus.CONFIRMED } }),
        prisma.order.count({ where: { status: OrderStatus.PROCESSING } }),
        prisma.order.count({ where: { status: OrderStatus.PENDING_PAYMENT } }),
        // Cancelled orders whose refund never completed — same predicate as
        // GET /admin/orders?refund=owed.
        prisma.order.count({ where: refundOwedWhere() }),
        prisma.returnRequest.count({ where: { status: ReturnRequestStatus.REQUESTED } }),
        prisma.review.count({ where: { approved: false } }),
        prisma.inventory.findMany({ select: { variantId: true, quantity: true, lowStockThreshold: true } }),
        prisma.cartReservation.groupBy({
          by: ['variantId'],
          where: { expiresAt: { gt: new Date() } },
          _sum: { quantity: true }
        })
      ]);

    // Same rule as GET /admin/inventory/low-stock: available = on hand − live cart holds.
    const reservedByVariant = new Map(reserved.map((row) => [row.variantId, row._sum.quantity ?? 0]));
    let lowStockVariants = 0;
    let outOfStockVariants = 0;
    for (const item of inventory) {
      const available = item.quantity - (reservedByVariant.get(item.variantId) ?? 0);
      if (available <= 0) outOfStockVariants += 1;
      else if (available <= item.lowStockThreshold) lowStockVariants += 1;
    }

    return {
      ordersToFulfil,
      ordersProcessing,
      ordersAwaitingPayment,
      refundsOwed,
      returnsToReview,
      reviewsToModerate,
      lowStockVariants,
      outOfStockVariants,
      generatedAt: new Date().toISOString()
    };
  }

  /**
   * Order counts per status for a window and the equally long window before it — one
   * round trip for the orders overview strip (it previously took eight list calls).
   */
  async getOrderStatusCounts(query: DashboardOrderStatusCountsQuery) {
    const from = new Date(query.from);
    const to = new Date(query.to);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Invalid date range', 400);
    }
    const span = to.getTime() - from.getTime();
    const previousTo = new Date(from.getTime() - 1);
    const previousFrom = new Date(previousTo.getTime() - span);

    const [current, previous] = await Promise.all([
      this.fastify.prisma.order.groupBy({
        by: ['status'],
        where: { createdAt: { gte: from, lte: to } },
        _count: { _all: true }
      }),
      this.fastify.prisma.order.groupBy({
        by: ['status'],
        where: { createdAt: { gte: previousFrom, lte: previousTo } },
        _count: { _all: true }
      })
    ]);

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      previousFrom: previousFrom.toISOString(),
      previousTo: previousTo.toISOString(),
      current: this.toStatusCounts(current),
      previous: this.toStatusCounts(previous)
    };
  }

  private toStatusCounts(rows: { status: OrderStatus; _count: { _all: number } }[]) {
    const byStatus = Object.fromEntries(Object.values(OrderStatus).map((status) => [status, 0])) as Record<
      OrderStatus,
      number
    >;
    let total = 0;
    for (const row of rows) {
      byStatus[row.status] = row._count._all;
      total += row._count._all;
    }
    return { total, byStatus };
  }

  /** Every bucket key from `from` to `to`, or null when the range would exceed MAX_CHART_BUCKETS. */
  private enumerateBucketKeys(from: Date, to: Date, granularity: DashboardGranularity): string[] | null {
    const keys: string[] = [];
    const cursor = new Date(from);
    if (granularity === 'hour') {
      cursor.setUTCMinutes(0, 0, 0);
    } else {
      cursor.setUTCHours(0, 0, 0, 0);
      if (granularity === 'week') {
        const day = cursor.getUTCDay();
        cursor.setUTCDate(cursor.getUTCDate() + (day === 0 ? -6 : 1 - day));
      }
    }
    while (cursor <= to) {
      keys.push(this.getBucketKey(cursor, granularity));
      if (keys.length > MAX_CHART_BUCKETS) return null;
      if (granularity === 'hour') cursor.setUTCHours(cursor.getUTCHours() + 1);
      else cursor.setUTCDate(cursor.getUTCDate() + (granularity === 'week' ? 7 : 1));
    }
    return keys;
  }

  async getTopProducts(query: DashboardTopProductsQuery) {
    const limit = Math.min(query.limit ?? 10, 100);
    const { from, to } = this.resolveRange('30d', query.from, query.to);
    const items = await this.fastify.prisma.orderItem.findMany({
      where: {
        order: {
          createdAt: { gte: from, lte: to },
          status: { in: includedStatuses }
        }
      },
      select: {
        variantId: true,
        productName: true,
        variantName: true,
        quantity: true,
        totalPrice: true
      }
    });

    const grouped = new Map<string, { variantId: string; productName: string; variantName: string; quantitySold: number; revenuePaise: number }>();
    for (const item of items) {
      const key = item.variantId;
      const existing = grouped.get(key);
      if (existing) {
        existing.quantitySold += item.quantity;
        existing.revenuePaise += item.totalPrice;
      } else {
        grouped.set(key, {
          variantId: item.variantId,
          productName: item.productName,
          variantName: item.variantName,
          quantitySold: item.quantity,
          revenuePaise: item.totalPrice
        });
      }
    }

    const sorted = Array.from(grouped.values())
      .sort((a, b) => b.revenuePaise - a.revenuePaise)
      .slice(0, limit);

    return { items: sorted };
  }

  private resolveRange(periodInput?: DashboardPeriod, fromInput?: string, toInput?: string) {
    const now = new Date();
    const period: DashboardPeriod = periodInput ?? '7d';

    if (period === 'custom') {
      if (!fromInput || !toInput) {
        throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'from and to are required for custom period', 400);
      }
      const from = new Date(fromInput);
      const to = new Date(toInput);
      if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
        throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Invalid custom date range', 400);
      }
      return { period, from, to };
    }

    const to = toInput ? new Date(toInput) : now;
    if (Number.isNaN(to.getTime())) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Invalid to date', 400);
    }

    const from = new Date(to);
    if (period === 'today') {
      from.setHours(0, 0, 0, 0);
    } else if (period === '7d') {
      from.setDate(from.getDate() - 7);
    } else {
      from.setDate(from.getDate() - 30);
    }

    if (fromInput) {
      const parsed = new Date(fromInput);
      if (Number.isNaN(parsed.getTime())) {
        throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Invalid from date', 400);
      }
      if (parsed > to) {
        throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'from must be less than or equal to to', 400);
      }
      return { period, from: parsed, to };
    }

    return { period, from, to };
  }

  private getBucketKey(value: Date, granularity: DashboardGranularity) {
    if (granularity === 'hour') {
      return value.toISOString().slice(0, 13);
    }
    if (granularity === 'week') {
      const weekStart = new Date(value);
      const day = weekStart.getUTCDay();
      const diff = day === 0 ? -6 : 1 - day;
      weekStart.setUTCDate(weekStart.getUTCDate() + diff);
      weekStart.setUTCHours(0, 0, 0, 0);
      return weekStart.toISOString().slice(0, 10);
    }
    return value.toISOString().slice(0, 10);
  }
}

