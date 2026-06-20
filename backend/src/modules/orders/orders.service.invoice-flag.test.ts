import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { featureFlags } from '@config/feature-flags';
import { OrdersService } from './orders.service';

describe('OrdersService invoice PDF feature flag', () => {
  const originalGstFlag = featureFlags.gstInvoicing;

  beforeEach(() => {
    featureFlags.gstInvoicing = false;
  });

  afterEach(() => {
    featureFlags.gstInvoicing = originalGstFlag;
  });

  it('rejects customer invoice download when GST invoicing is disabled', async () => {
    const findFirst = vi.fn();
    const service = new OrdersService({
      prisma: {
        order: { findFirst }
      }
    } as unknown as FastifyInstance);

    await expect(service.getMyInvoicePdf('user_1', 'order_1')).rejects.toMatchObject({
      statusCode: 400,
      message: 'GST invoicing is disabled'
    });
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('rejects admin invoice download when GST invoicing is disabled', async () => {
    const findUnique = vi.fn();
    const service = new OrdersService({
      prisma: {
        order: { findUnique }
      }
    } as unknown as FastifyInstance);

    await expect(service.adminGetInvoicePdf('order_1')).rejects.toMatchObject({
      statusCode: 400,
      message: 'GST invoicing is disabled'
    });
    expect(findUnique).not.toHaveBeenCalled();
  });
});

describe('OrdersService getMyInvoicePdf', () => {
  const originalGstFlag = featureFlags.gstInvoicing;

  beforeEach(() => {
    featureFlags.gstInvoicing = true;
  });

  afterEach(() => {
    featureFlags.gstInvoicing = originalGstFlag;
  });

  it('throws 404 when order does not belong to user', async () => {
    const service = new OrdersService({
      prisma: {
        order: {
          findFirst: vi.fn().mockResolvedValue(null)
        }
      }
    } as unknown as FastifyInstance);

    await expect(service.getMyInvoicePdf('user_1', 'order_1')).rejects.toMatchObject({
      statusCode: 404
    });
  });

  it('returns invoiceNumber and content buffer when invoice exists for user', async () => {
    const fastify = {
      prisma: {
        order: {
          findFirst: vi.fn().mockResolvedValue({
            invoice: {
              invoiceNumber: 'INV-001',
              pdfUrl: '/storage/invoices/INV-001.pdf'
            }
          })
        }
      }
    } as unknown as FastifyInstance;
    const service = new OrdersService(fastify);

    const pdfBuffer = Buffer.from('%PDF-1.4 test content');
    vi.spyOn(
      service as unknown as { invoiceStorage: { readInvoicePdf: (url: string) => Promise<Buffer> } },
      'invoiceStorage',
      'get'
    ).mockReturnValue({ readInvoicePdf: vi.fn().mockResolvedValue(pdfBuffer) });

    const result = await service.getMyInvoicePdf('user_1', 'order_1');

    expect(result.invoiceNumber).toBe('INV-001');
    expect(result.content).toEqual(pdfBuffer);
    expect(fastify.prisma.order.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'order_1', userId: 'user_1' }
      })
    );
  });
});
