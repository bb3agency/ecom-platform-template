import { OrderStatus } from '@prisma/client';
import { FastifyInstance } from 'fastify';
import { AppError } from '@common/errors/app-error';
import { ERROR_CODES } from '@common/errors/error-codes';
import {
  DashboardGranularity,
  DashboardKpisQuery,
  DashboardPeriod,
  DashboardSalesChartQuery,
  DashboardTopProductsQuery
} from './dashboard.types';

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

    return {
      granularity,
      points: Array.from(buckets.entries()).map(([bucket, value]) => ({
        bucket,
        ordersCount: value.ordersCount,
        revenuePaise: value.revenuePaise
      }))
    };
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

