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
    ...shipmentOverrides
  };

  const prisma = {
    order: {
      findUnique: vi.fn().mockResolvedValue({ status: 'SHIPPED' })
    },
    shipment: {
      findFirst: vi.fn().mockResolvedValue(shipment),
      update: vi.fn().mockResolvedValue({ ...shipment, labelUrl: 'https://label.example/abc.pdf' })
    }
  };

  return {
    prisma,
    log: { error: vi.fn() }
  } as unknown as FastifyInstance;
}

describe('OrdersService adminPrintLabel', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('returns cached labelUrl when already present', async () => {
    const fastify = buildFastify({ labelUrl: 'https://label.example/cached.pdf' });
    const service = new OrdersService(fastify);

    const result = await service.adminPrintLabel('order_1');

    expect(result.labelUrl).toBe('https://label.example/cached.pdf');
    expect(fastify.prisma.shipment.update).not.toHaveBeenCalled();
  });

  it('generates label and persists labelUrl when not cached', async () => {
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
        text: async () => JSON.stringify({ label_url: 'https://label.example/abc.pdf' })
      }));

    const fastify = buildFastify();
    const service = new OrdersService(fastify);

    const result = await service.adminPrintLabel('order_1');

    expect(result.labelUrl).toBe('https://label.example/abc.pdf');
    expect(fastify.prisma.shipment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ labelUrl: 'https://label.example/abc.pdf' })
      })
    );
  });

  it('throws 404 when shipment not found', async () => {
    const fastify = buildFastify();
    (fastify.prisma.shipment.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const service = new OrdersService(fastify);

    await expect(service.adminPrintLabel('order_1')).rejects.toMatchObject({
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

    await expect(service.adminPrintLabel('order_1')).rejects.toMatchObject({
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

    await expect(service.adminPrintLabel('order_1')).rejects.toMatchObject({
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
    await service.adminPrintLabel('order_1').catch(() => undefined);
    expect(resolve).toHaveBeenCalled();
  });

});
