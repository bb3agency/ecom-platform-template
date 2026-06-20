import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { OrdersService } from './orders.service';

function buildFastify(shipmentOverrides?: Record<string, unknown>) {
  const shipment = {
    id: 'shipment_1',
    orderId: 'order_1',
    provider: 'SHIPROCKET',
    status: 'BOOKED',
    awbNumber: 'AWB123',
    trackingUrl: 'https://track.example/AWB123',
    shiprocketShipmentId: 'SHIP202',
    labelUrl: null,
    pickupScheduledDate: null,
    ...shipmentOverrides
  };

  const prisma = {
    shipment: {
      findFirst: vi.fn().mockResolvedValue(shipment),
      update: vi.fn().mockResolvedValue({ ...shipment, pickupScheduledDate: new Date('2026-05-06') })
    }
  };

  return {
    prisma,
    log: { error: vi.fn() }
  } as unknown as FastifyInstance;
}

describe('OrdersService adminSchedulePickup', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('schedules pickup for Shiprocket shipment and updates pickupScheduledDate', async () => {
    vi.stubEnv('SHIPROCKET_EMAIL', 'test@example.com');
    vi.stubEnv('SHIPROCKET_PASSWORD', 'secret');
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ token: 'sr-token-123' })
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          status: 1,
          pickup_scheduled_date: '2026-05-06',
          pickup_token_number: 'PKP123'
        })
      }));

    const fastify = buildFastify();
    const service = new OrdersService(fastify);

    const result = await service.adminSchedulePickup('order_1');

    expect(result.scheduled).toBe(true);
    expect(fastify.prisma.shipment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          pickupScheduledDate: expect.any(Date)
        })
      })
    );
  });

  it('throws 404 when shipment not found', async () => {
    const fastify = buildFastify();
    (fastify.prisma.shipment.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const service = new OrdersService(fastify);

    await expect(service.adminSchedulePickup('order_1')).rejects.toMatchObject({
      statusCode: 404,
      code: 'NOT_FOUND'
    });
  });

  it('throws 422 when shiprocketShipmentId is missing', async () => {
    const fastify = buildFastify({ shiprocketShipmentId: null });
    const service = new OrdersService(fastify);

    await expect(service.adminSchedulePickup('order_1')).rejects.toMatchObject({
      statusCode: 422,
      code: 'VALIDATION_ERROR'
    });
  });
});
