import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { featureFlags } from '@config/feature-flags';
import { AppError } from '@common/errors/app-error';
import { ERROR_CODES } from '@common/errors/error-codes';
import * as generateInvoiceModule from '@modules/invoices/generate-invoice';
import { OrdersService } from './orders.service';

vi.mock('@modules/invoices/generate-invoice', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@modules/invoices/generate-invoice')>();
  return { ...actual, generateInvoiceForOrder: vi.fn() };
});

const generateInvoiceMock = vi.mocked(generateInvoiceModule.generateInvoiceForOrder);

describe('OrdersService invoice PDF feature flag', () => {
  const originalGstFlag = featureFlags.gstInvoicing;

  beforeEach(() => {
    featureFlags.gstInvoicing = false;
  });

  afterEach(() => {
    featureFlags.gstInvoicing = originalGstFlag;
  });

  it('rejects customer invoice download with a plain 404 when GST invoicing is disabled (no config leak)', async () => {
    const findFirst = vi.fn();
    const service = new OrdersService({
      prisma: {
        order: { findFirst }
      }
    } as unknown as FastifyInstance);

    await expect(service.getMyInvoicePdf('user_1', 'order_1')).rejects.toMatchObject({
      statusCode: 404,
      message: 'Invoice not found'
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

  it('generates the invoice on demand when missing for an eligible order', async () => {
    generateInvoiceMock.mockReset();
    const fastify = {
      prisma: {
        order: {
          findFirst: vi.fn().mockResolvedValue({ id: 'order_1', status: 'DELIVERED', invoice: null })
        },
        invoice: {
          findUnique: vi.fn().mockResolvedValue({
            invoiceNumber: 'INV-2026-00099',
            pdfUrl: '/storage/invoices/INV-2026-00099.pdf'
          })
        }
      },
      log: { warn: vi.fn() }
    } as unknown as FastifyInstance;
    const service = new OrdersService(fastify);

    const pdfBuffer = Buffer.from('%PDF-1.4 on demand');
    vi.spyOn(
      service as unknown as { invoiceStorage: { readInvoicePdf: (url: string) => Promise<Buffer> } },
      'invoiceStorage',
      'get'
    ).mockReturnValue({ readInvoicePdf: vi.fn().mockResolvedValue(pdfBuffer) });

    const result = await service.getMyInvoicePdf('user_1', 'order_1');

    expect(generateInvoiceMock).toHaveBeenCalledWith(fastify.prisma, 'order_1', expect.anything());
    expect(result.invoiceNumber).toBe('INV-2026-00099');
    expect(result.content).toEqual(pdfBuffer);
  });

  it('does not attempt generation for a pre-payment order', async () => {
    generateInvoiceMock.mockReset();
    const fastify = {
      prisma: {
        order: {
          findFirst: vi.fn().mockResolvedValue({ id: 'order_1', status: 'PENDING_PAYMENT', invoice: null })
        }
      }
    } as unknown as FastifyInstance;
    const service = new OrdersService(fastify);

    await expect(service.getMyInvoicePdf('user_1', 'order_1')).rejects.toMatchObject({ statusCode: 404 });
    expect(generateInvoiceMock).not.toHaveBeenCalled();
  });

  it('never leaks config errors to customers — generation config failure surfaces as 404', async () => {
    generateInvoiceMock.mockReset();
    generateInvoiceMock.mockRejectedValue(
      new AppError(
        ERROR_CODES.VALIDATION_ERROR,
        'Invoice generation is not configured: missing seller address. Complete the store profile in Admin → Settings → Store.',
        422
      )
    );
    const fastify = {
      prisma: {
        order: {
          findFirst: vi.fn().mockResolvedValue({ id: 'order_1', status: 'DELIVERED', invoice: null })
        },
        invoice: {
          findUnique: vi.fn().mockResolvedValue(null)
        }
      },
      log: { warn: vi.fn(), error: vi.fn() }
    } as unknown as FastifyInstance;
    const service = new OrdersService(fastify);

    await expect(service.getMyInvoicePdf('user_1', 'order_1')).rejects.toMatchObject({
      statusCode: 404,
      message: 'Invoice not found'
    });
  });

  it('rethrows unexpected generation failures for customers so the 500 alert path still fires', async () => {
    generateInvoiceMock.mockReset();
    generateInvoiceMock.mockRejectedValue(new Error('storage upload failed'));
    const fastify = {
      prisma: {
        order: {
          findFirst: vi.fn().mockResolvedValue({ id: 'order_1', status: 'DELIVERED', invoice: null })
        },
        invoice: {
          findUnique: vi.fn().mockResolvedValue(null)
        }
      },
      log: { warn: vi.fn(), error: vi.fn() }
    } as unknown as FastifyInstance;
    const service = new OrdersService(fastify);

    await expect(service.getMyInvoicePdf('user_1', 'order_1')).rejects.toThrow('storage upload failed');
    expect((fastify.log as unknown as { error: ReturnType<typeof vi.fn> }).error).toHaveBeenCalled();
  });
});
