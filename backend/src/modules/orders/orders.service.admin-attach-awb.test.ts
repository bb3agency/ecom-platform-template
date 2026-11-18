import { OrderStatus } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { ERROR_CODES } from '@common/errors/error-codes';
import { OrdersService } from './orders.service';

/**
 * Recovery path for a parcel booked outside the app — the merchant cloned the order in
 * the courier dashboard after our reference was cancelled, shipped it from there, and the
 * order here would otherwise stay "not booked" with the customer never getting tracking.
 */
describe('OrdersService adminAttachAwb', () => {
  function buildHarness(order: Record<string, unknown> | null) {
    const tx = {
      shipment: { upsert: vi.fn().mockResolvedValue(undefined) },
      order: { update: vi.fn().mockResolvedValue(undefined) },
      orderStatusHistory: { create: vi.fn().mockResolvedValue(undefined) }
    };
    const fastify = {
      log: { error: vi.fn() },
      prisma: {
        order: { findUnique: vi.fn().mockResolvedValue(order) },
        $transaction: vi.fn(async (fn: (arg: typeof tx) => Promise<unknown>) => fn(tx))
      }
    } as unknown as FastifyInstance;
    const service = new OrdersService(fastify);
    // The customer notification is exercised by its own tests; stub it so a messaging
    // failure cannot mask the attach behaviour under test.
    vi.spyOn(service, 'adminRetriggerNotification').mockResolvedValue({ queuedJobs: 1 } as never);
    return { tx, service };
  }

  const baseOrder = {
    id: 'order_1',
    orderNumber: 'ORD-2026-00001',
    status: OrderStatus.SHIPPED,
    selectedShippingProvider: 'SHIPROCKET',
    shipment: null
  };

  it('attaches the AWB, books the shipment and records who did it', async () => {
    const { tx, service } = buildHarness({ ...baseOrder });

    const result = await service.adminAttachAwb('order_1', { awbNumber: ' 1234567890 ' });

    expect(result.attached).toBe(true);
    expect(result.awbNumber).toBe('1234567890');
    expect(tx.shipment.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { orderId: 'order_1' },
        create: expect.objectContaining({ awbNumber: '1234567890', status: 'BOOKED' })
      })
    );
    // A recorded booking failure is history once a real AWB is attached.
    expect(tx.order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ shipmentBookingError: null })
      })
    );
    expect(tx.orderStatusHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ triggeredBy: 'ADMIN' })
      })
    );
  });

  it('refuses when the order already has an AWB, so a live booking is never overwritten', async () => {
    const { tx, service } = buildHarness({
      ...baseOrder,
      shipment: { awbNumber: 'EXISTING', provider: 'SHIPROCKET' }
    });

    await expect(service.adminAttachAwb('order_1', { awbNumber: 'NEW123' })).rejects.toMatchObject({
      statusCode: 409
    });
    expect(tx.shipment.upsert).not.toHaveBeenCalled();
  });

  it('refuses for a local delivery order, which never has a courier AWB', async () => {
    const { tx, service } = buildHarness({ ...baseOrder, selectedShippingProvider: 'LOCAL' });

    await expect(service.adminAttachAwb('order_1', { awbNumber: 'NEW123' })).rejects.toMatchObject({
      code: ERROR_CODES.VALIDATION_ERROR
    });
    expect(tx.shipment.upsert).not.toHaveBeenCalled();
  });

  it('refuses on a cancelled order', async () => {
    const { tx, service } = buildHarness({ ...baseOrder, status: OrderStatus.CANCELLED });

    await expect(service.adminAttachAwb('order_1', { awbNumber: 'NEW123' })).rejects.toMatchObject({
      statusCode: 422
    });
    expect(tx.shipment.upsert).not.toHaveBeenCalled();
  });

  it('404s for an unknown order', async () => {
    const { service } = buildHarness(null);
    await expect(service.adminAttachAwb('nope', { awbNumber: 'NEW123' })).rejects.toMatchObject({
      statusCode: 404
    });
  });
});
