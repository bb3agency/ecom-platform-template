import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { featureFlags } from '@config/feature-flags';
import { OrdersService } from './orders.service';

function makeFastify(orderResult: unknown): FastifyInstance {
  return {
    prisma: {
      order: { findUnique: vi.fn().mockResolvedValue(orderResult) }
    },
    redis: { scan: vi.fn().mockResolvedValue(['0', []]), del: vi.fn() },
    queues: { analytics: { add: vi.fn() } },
    log: { error: vi.fn(), info: vi.fn() },
    config: { PAYMENT_PROVIDER: 'razorpay' }
  } as unknown as FastifyInstance;
}

describe('OrdersService adminGetInvoicePdf', () => {
  beforeEach(() => {
    featureFlags.gstInvoicing = true;
  });

  it('throws 404 when order does not exist', async () => {
    const fastify = makeFastify(null);
    const service = new OrdersService(fastify);

    await expect(service.adminGetInvoicePdf('nonexistent')).rejects.toMatchObject({ statusCode: 404 });
  });

  it('throws 404 when order has no invoice', async () => {
    const fastify = makeFastify({ invoice: null });
    const service = new OrdersService(fastify);

    await expect(service.adminGetInvoicePdf('order_1')).rejects.toMatchObject({ statusCode: 404 });
  });

  it('throws 404 when invoice has no pdfUrl', async () => {
    const fastify = makeFastify({ invoice: { invoiceNumber: 'INV-001', pdfUrl: null } });
    const service = new OrdersService(fastify);

    await expect(service.adminGetInvoicePdf('order_1')).rejects.toMatchObject({ statusCode: 404 });
  });

  it('returns invoiceNumber and content buffer when invoice exists', async () => {
    const fastify = makeFastify({ invoice: { invoiceNumber: 'INV-001', pdfUrl: '/storage/invoices/INV-001.pdf' } });
    const service = new OrdersService(fastify);

    const pdfBuffer = Buffer.from('%PDF-1.4 test content');
    vi.spyOn(
      service as unknown as { invoiceStorage: { readInvoicePdf: (url: string) => Promise<Buffer> } },
      'invoiceStorage',
      'get'
    ).mockReturnValue({ readInvoicePdf: vi.fn().mockResolvedValue(pdfBuffer) });

    const result = await service.adminGetInvoicePdf('order_1');

    expect(result.invoiceNumber).toBe('INV-001');
    expect(result.content).toEqual(pdfBuffer);
  });
});
