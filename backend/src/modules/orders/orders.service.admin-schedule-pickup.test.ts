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
    order: {
      findUnique: vi.fn().mockResolvedValue({ status: 'SHIPPED' })
    },
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

  it('persists pickup when Shiprocket reports it is already in the pickup queue (no date returned)', async () => {
    // Regression: a warehouse pickup already arranged returns HTTP 400 "Already in
    // Pickup Queue" with no slot date. The shipment is covered, so we must still
    // record pickupScheduledDate — otherwise the admin UI re-shows the button on
    // every refresh. Fall back to the action timestamp when no date is returned.
    vi.stubEnv('SHIPROCKET_EMAIL', 'test@example.com');
    vi.stubEnv('SHIPROCKET_PASSWORD', 'secret');
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ token: 'sr-token-123' })
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => JSON.stringify({ message: 'Already in Pickup Queue.' })
      }));

    const fastify = buildFastify();
    const service = new OrdersService(fastify);

    const result = await service.adminSchedulePickup('order_1');

    expect(result.alreadyScheduled).toBe(true);
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

  // A missing shipment id is no longer a dead end: it is resolved from the AWB on
  // demand, because a parcel booked in the courier dashboard never had one. These two
  // cases used to collapse into one generic 422, which told the merchant to go looking
  // in Shiprocket for what was actually a server misconfiguration.
  it('reports a configuration problem when Shiprocket is not configured', async () => {
    const fastify = buildFastify({ shiprocketShipmentId: null });
    const service = new OrdersService(fastify);

    await expect(service.adminSchedulePickup('order_1')).rejects.toMatchObject({
      statusCode: 503,
      code: 'CONFIG_NOT_READY'
    });
  });

  it('reports an unrecognised AWB when the courier has no such shipment', async () => {
    const fastify = buildFastify({ shiprocketShipmentId: null });
    const service = new OrdersService(fastify);
    vi.spyOn(
      service as unknown as {
        resolveShiprocketShipmentId: () => Promise<string | null>;
      },
      'resolveShiprocketShipmentId'
    ).mockResolvedValue(null);

    await expect(service.adminSchedulePickup('order_1')).rejects.toMatchObject({
      statusCode: 422,
      code: 'VALIDATION_ERROR'
    });
  });

  it('proceeds once the shipment id is resolved from the AWB', async () => {
    const fastify = buildFastify({ shiprocketShipmentId: null });
    const service = new OrdersService(fastify);
    const resolve = vi
      .spyOn(
        service as unknown as {
          resolveShiprocketShipmentId: () => Promise<string | null>;
        },
        'resolveShiprocketShipmentId'
      )
      .mockResolvedValue('SHIP-RESOLVED');

    // The provider call itself is out of scope here; reaching it is the assertion.
    await service.adminSchedulePickup('order_1').catch(() => undefined);
    expect(resolve).toHaveBeenCalled();
  });

});
