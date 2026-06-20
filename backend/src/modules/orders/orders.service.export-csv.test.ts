import type { FastifyInstance } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { OrdersService } from './orders.service';

describe('OrdersService admin export csv', () => {
  it('returns CSV with header and order rows', async () => {
    const fastify = {
      prisma: {
        order: {
          findMany: vi.fn().mockResolvedValue([
            {
              orderNumber: 'ORD-2026-00001',
              status: 'CONFIRMED',
              total: 12500,
              createdAt: new Date('2026-04-27T00:00:00.000Z'),
              user: {
                firstName: 'Asha',
                lastName: 'Reddy',
                email: 'asha@example.com',
                phone: '9999999999'
              },
              payment: {
                method: 'upi',
                status: 'CAPTURED'
              }
            }
          ])
        }
      }
    } as unknown as FastifyInstance;

    const service = new OrdersService(fastify);
    const csv = await service.adminExportOrdersCsv({
      from: '2026-04-01T00:00:00.000Z',
      to: '2026-04-30T23:59:59.999Z'
    });

    expect(csv).toContain('orderNumber,createdAt,status,totalPaise,customerName,customerEmail,customerPhone,paymentMethod,paymentStatus');
    expect(csv).toContain('"ORD-2026-00001"');
    expect(csv).toContain('"asha@example.com"');
    expect(csv).toContain('"CAPTURED"');
  });

  it('throws validation error when from is after to', async () => {
    const fastify = {
      prisma: {
        order: {
          findMany: vi.fn()
        }
      }
    } as unknown as FastifyInstance;

    const service = new OrdersService(fastify);

    await expect(
      service.adminExportOrdersCsv({
        from: '2026-05-01T00:00:00.000Z',
        to: '2026-04-01T00:00:00.000Z'
      })
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR'
    });
  });
});
