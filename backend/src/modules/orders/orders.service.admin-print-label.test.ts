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

  it('throws 422 when shiprocketShipmentId is missing', async () => {
    const fastify = buildFastify({ shiprocketShipmentId: null });
    const service = new OrdersService(fastify);

    await expect(service.adminPrintLabel('order_1')).rejects.toMatchObject({
      statusCode: 422,
      code: 'VALIDATION_ERROR'
    });
  });
});
