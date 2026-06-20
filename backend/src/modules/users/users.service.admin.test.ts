import { describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { UsersService } from './users.service';

describe('UsersService admin APIs', () => {
  it('returns admin user list with search and aggregate fields', async () => {
    const fastify = {
      prisma: {
        user: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: 'user_1',
              email: 'test@example.com',
              phone: '9999999999',
              firstName: 'Test',
              lastName: 'User',
              isBanned: false,
              createdAt: new Date('2026-04-27T00:00:00.000Z')
            }
          ]),
          count: vi.fn().mockResolvedValue(1)
        },
        order: {
          groupBy: vi.fn().mockResolvedValue([
            {
              userId: 'user_1',
              _count: { _all: 3 },
              _sum: { total: 15000 }
            }
          ])
        },
        $transaction: vi
          .fn()
          .mockImplementation(async (queries: Array<Promise<unknown>>) =>
            Promise.all(queries)
          )
      }
    } as unknown as FastifyInstance;

    const service = new UsersService(fastify);
    const result = await service.adminListUsers({ page: 1, limit: 20, search: 'test' });

    expect(result.items[0]).toMatchObject({
      id: 'user_1',
      totalOrders: 3,
      totalSpendPaise: 15000
    });

    // Verify the groupBy query excludes non-completed order statuses
    expect(fastify.prisma.order.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { notIn: ['PENDING_PAYMENT', 'PAYMENT_FAILED', 'CANCELLED'] }
        })
      })
    );
  });

  it('excludes cancelled and payment-failed orders from totalOrders and totalSpendPaise', async () => {
    const fastify = {
      prisma: {
        user: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: 'user_2',
              email: 'bad@example.com',
              phone: '8888888888',
              firstName: 'Bad',
              lastName: 'Luck',
              isBanned: false,
              createdAt: new Date('2026-04-27T00:00:00.000Z')
            }
          ]),
          count: vi.fn().mockResolvedValue(1)
        },
        // groupBy returns empty because all orders are cancelled/failed
        order: { groupBy: vi.fn().mockResolvedValue([]) },
        $transaction: vi
          .fn()
          .mockImplementation(async (queries: Array<Promise<unknown>>) =>
            Promise.all(queries)
          )
      }
    } as unknown as FastifyInstance;

    const service = new UsersService(fastify);
    const result = await service.adminListUsers({ page: 1, limit: 20 });

    expect(result.items[0]).toMatchObject({
      id: 'user_2',
      totalOrders: 0,
      totalSpendPaise: 0
    });
  });

  it('applies banned and createdAt filters for admin user list', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);
    const fastify = {
      prisma: {
        user: { findMany, count },
        order: { groupBy: vi.fn().mockResolvedValue([]) },
        $transaction: vi
          .fn()
          .mockImplementation(async (queries: Array<Promise<unknown>>) =>
            Promise.all(queries)
          )
      }
    } as unknown as FastifyInstance;

    const service = new UsersService(fastify);
    await service.adminListUsers({
      banned: true,
      from: '2026-05-01T00:00:00.000Z',
      to: '2026-05-31T23:59:59.999Z'
    });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          role: 'CUSTOMER',
          isBanned: true,
          createdAt: {
            gte: new Date('2026-05-01T00:00:00.000Z'),
            lte: new Date('2026-05-31T23:59:59.999Z')
          }
        })
      })
    );
  });

  it('returns addresses along with admin user detail', async () => {
    const fastify = {
      prisma: {
        user: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'user_1',
            email: 'test@example.com',
            phone: '9999999999',
            firstName: 'Test',
            lastName: 'User',
            isBanned: false,
            bannedAt: null,
            bannedReason: null,
            createdAt: new Date('2026-04-27T00:00:00.000Z'),
            addresses: [
              {
                id: 'addr_1',
                fullName: 'Test User',
                phone: '9999999999',
                line1: 'Street 1',
                line2: null,
                city: 'Hyderabad',
                state: 'Telangana',
                pincode: '500001',
                isDefault: true
              }
            ],
            orders: []
          })
        }
      }
    } as unknown as FastifyInstance;

    const service = new UsersService(fastify);
    const result = await service.adminGetUserById('user_1');

    expect(result.addresses).toHaveLength(1);
    expect(result.addresses[0]?.id).toBe('addr_1');
    expect(result.isBanned).toBe(false);
    expect(result.bannedAt).toBeNull();
    expect(result.bannedReason).toBeNull();
  });

  it('returns paginated customer orders with shipment projection', async () => {
    const fastify = {
      prisma: {
        user: {
          findFirst: vi.fn().mockResolvedValue({ id: 'user_1' })
        },
        order: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: 'order_1',
              orderNumber: 'ORD-001',
              status: 'DELIVERED',
              subtotal: 2000,
              shippingCharge: 100,
              discountAmount: 0,
              total: 2100,
              createdAt: new Date('2026-04-27T00:00:00.000Z'),
              shipment: {
                status: 'DELIVERED',
                awbNumber: 'AWB001',
                trackingUrl: 'https://track.example/AWB001',
                events: [{ status: 'DELIVERED', occurredAt: new Date('2026-04-28T10:00:00.000Z') }]
              }
            }
          ]),
          count: vi.fn().mockResolvedValue(1)
        },
        $transaction: vi.fn().mockImplementation(async (queries: Array<Promise<unknown>>) => Promise.all(queries))
      }
    } as unknown as FastifyInstance;

    const service = new UsersService(fastify);
    const result = await service.adminGetCustomerOrders('user_1', { page: 1, limit: 20 });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      id: 'order_1',
      orderNumber: 'ORD-001',
      shipmentStatus: 'DELIVERED',
      awb: 'AWB001',
      trackingUrl: 'https://track.example/AWB001',
      latestShipmentEventStatus: 'DELIVERED',
      latestShipmentEventAt: '2026-04-28T10:00:00.000Z'
    });
    expect(result.meta.total).toBe(1);
  });

  it('throws 404 when customer not found in adminGetCustomerOrders', async () => {
    const fastify = {
      prisma: {
        user: {
          findFirst: vi.fn().mockResolvedValue(null)
        }
      }
    } as unknown as FastifyInstance;

    const service = new UsersService(fastify);
    await expect(
      service.adminGetCustomerOrders('nonexistent', { page: 1, limit: 20 })
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('returns null shipment fields when order has no shipment in adminGetCustomerOrders', async () => {
    const fastify = {
      prisma: {
        user: {
          findFirst: vi.fn().mockResolvedValue({ id: 'user_1' })
        },
        order: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: 'order_2',
              orderNumber: 'ORD-002',
              status: 'PROCESSING',
              subtotal: 1000,
              shippingCharge: 0,
              discountAmount: 0,
              total: 1000,
              createdAt: new Date('2026-04-27T00:00:00.000Z'),
              shipment: null
            }
          ]),
          count: vi.fn().mockResolvedValue(1)
        },
        $transaction: vi.fn().mockImplementation(async (queries: Array<Promise<unknown>>) => Promise.all(queries))
      }
    } as unknown as FastifyInstance;

    const service = new UsersService(fastify);
    const result = await service.adminGetCustomerOrders('user_1', { page: 1, limit: 20 });

    expect(result.items[0]).toMatchObject({
      shipmentStatus: null,
      awb: null,
      trackingUrl: null,
      latestShipmentEventStatus: null,
      latestShipmentEventAt: null
    });
  });

  it('returns shipment projection fields in admin user order detail', async () => {
    const fastify = {
      prisma: {
        user: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'user_2',
            email: 'u2@example.com',
            phone: '9999999998',
            firstName: 'U',
            lastName: 'Two',
            isBanned: false,
            bannedAt: null,
            bannedReason: null,
            createdAt: new Date('2026-04-27T00:00:00.000Z'),
            addresses: [],
            orders: [
              {
                id: 'order_2',
                orderNumber: 'ORD-2',
                status: 'SHIPPED',
                subtotal: 1000,
                shippingCharge: 0,
                discountAmount: 0,
                total: 1000,
                createdAt: new Date('2026-04-27T00:00:00.000Z'),
                shipment: {
                  status: 'OUT_FOR_DELIVERY',
                  awbNumber: 'AWB2',
                  trackingUrl: 'https://track.example/AWB2',
                  events: [{ status: 'OUT_FOR_DELIVERY', occurredAt: new Date('2026-04-27T10:00:00.000Z') }]
                }
              }
            ]
          })
        }
      }
    } as unknown as FastifyInstance;

    const service = new UsersService(fastify);
    const result = await service.adminGetUserById('user_2');
    expect(result.orders[0]).toMatchObject({
      shipmentStatus: 'OUT_FOR_DELIVERY',
      awb: 'AWB2',
      trackingUrl: 'https://track.example/AWB2',
      latestShipmentEventStatus: 'OUT_FOR_DELIVERY',
      latestShipmentEventAt: '2026-04-27T10:00:00.000Z'
    });
  });
});
