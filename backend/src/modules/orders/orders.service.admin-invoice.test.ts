import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { featureFlags } from '@config/feature-flags';
import { AppError } from '@common/errors/app-error';
import { ERROR_CODES } from '@common/errors/error-codes';
import * as generateInvoiceModule from '@modules/invoices/generate-invoice';
import { OrdersService } from './orders.service';

vi.mock('@modules/invoices/generate-invoice', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@modules/invoices/generate-invoice')>();
  return { ...actual, generateInvoiceForOrder: vi.fn(), regenerateInvoicePdfForOrder: vi.fn() };
});

const generateInvoiceMock = vi.mocked(generateInvoiceModule.generateInvoiceForOrder);
const regenerateInvoiceMock = vi.mocked(generateInvoiceModule.regenerateInvoicePdfForOrder);

function makeFastify(orderResult: unknown, invoiceResult: unknown = null): FastifyInstance {
  return {
    prisma: {
      order: { findUnique: vi.fn().mockResolvedValue(orderResult) },
      invoice: { findUnique: vi.fn().mockResolvedValue(invoiceResult) }
    },
    redis: { scan: vi.fn().mockResolvedValue(['0', []]), del: vi.fn() },
    queues: { analytics: { add: vi.fn() } },
    log: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
    config: { PAYMENT_PROVIDER: 'razorpay' }
  } as unknown as FastifyInstance;
}

function mockInvoiceStorage(service: OrdersService, pdfBuffer: Buffer) {
  vi.spyOn(
    service as unknown as { invoiceStorage: { readInvoicePdf: (url: string) => Promise<Buffer> } },
    'invoiceStorage',
    'get'
  ).mockReturnValue({ readInvoicePdf: vi.fn().mockResolvedValue(pdfBuffer) });
}

describe('OrdersService adminGetInvoicePdf', () => {
  beforeEach(() => {
    featureFlags.gstInvoicing = true;
    generateInvoiceMock.mockReset();
    regenerateInvoiceMock.mockReset();
  });

  it('throws 404 when order does not exist', async () => {
    const fastify = makeFastify(null);
    const service = new OrdersService(fastify);

    await expect(service.adminGetInvoicePdf('nonexistent')).rejects.toMatchObject({ statusCode: 404 });
  });

  it('throws 404 when order has no invoice and is not invoice-eligible', async () => {
    const fastify = makeFastify({ id: 'order_1', status: 'PENDING_PAYMENT', invoice: null });
    const service = new OrdersService(fastify);

    await expect(service.adminGetInvoicePdf('order_1')).rejects.toMatchObject({ statusCode: 404 });
    expect(generateInvoiceMock).not.toHaveBeenCalled();
  });

  it('throws 404 when on-demand generation still yields no invoice', async () => {
    const fastify = makeFastify({ id: 'order_1', status: 'CONFIRMED', invoice: null }, null);
    const service = new OrdersService(fastify);

    await expect(service.adminGetInvoicePdf('order_1')).rejects.toMatchObject({ statusCode: 404 });
    expect(generateInvoiceMock).toHaveBeenCalledWith(fastify.prisma, 'order_1', expect.anything());
  });

  it('generates the invoice on demand when missing for an eligible order', async () => {
    const fastify = makeFastify(
      { id: 'order_1', status: 'CONFIRMED', invoice: null },
      { invoiceNumber: 'INV-2026-00042', pdfUrl: '/storage/invoices/INV-2026-00042.pdf' }
    );
    const service = new OrdersService(fastify);
    const pdfBuffer = Buffer.from('%PDF-1.4 generated on demand');
    mockInvoiceStorage(service, pdfBuffer);

    const result = await service.adminGetInvoicePdf('order_1');

    expect(generateInvoiceMock).toHaveBeenCalledTimes(1);
    expect(result.invoiceNumber).toBe('INV-2026-00042');
    expect(result.content).toEqual(pdfBuffer);
  });

  it('serves the winning invoice when concurrent generation loses the unique race', async () => {
    const fastify = makeFastify(
      { id: 'order_1', status: 'DELIVERED', invoice: null },
      { id: 'inv_1', invoiceNumber: 'INV-2026-00007', pdfUrl: '/storage/invoices/INV-2026-00007.pdf' }
    );
    generateInvoiceMock.mockRejectedValue(new Error('unique constraint P2002'));
    const service = new OrdersService(fastify);
    const pdfBuffer = Buffer.from('%PDF-1.4 raced');
    mockInvoiceStorage(service, pdfBuffer);

    const result = await service.adminGetInvoicePdf('order_1');

    expect(result.invoiceNumber).toBe('INV-2026-00007');
    expect(result.content).toEqual(pdfBuffer);
  });

  it('rethrows generation failure when no invoice exists after the attempt', async () => {
    const fastify = makeFastify({ id: 'order_1', status: 'CONFIRMED', invoice: null }, null);
    generateInvoiceMock.mockRejectedValue(new Error('renderer exploded'));
    const service = new OrdersService(fastify);

    await expect(service.adminGetInvoicePdf('order_1')).rejects.toThrow('renderer exploded');
  });

  it('passes the actionable config VALIDATION_ERROR through to admins', async () => {
    const fastify = makeFastify({ id: 'order_1', status: 'CONFIRMED', invoice: null }, null);
    generateInvoiceMock.mockRejectedValue(
      new AppError(
        ERROR_CODES.VALIDATION_ERROR,
        'Invoice generation is not configured: missing seller address. Complete the store profile in Admin → Settings → Store.',
        422
      )
    );
    const service = new OrdersService(fastify);

    await expect(service.adminGetInvoicePdf('order_1')).rejects.toMatchObject({
      statusCode: 422,
      code: ERROR_CODES.VALIDATION_ERROR,
      message: expect.stringContaining('Complete the store profile')
    });
  });

  it('self-heals a missing stored PDF by re-rendering under the issued invoice number', async () => {
    const fastify = makeFastify({
      id: 'order_1',
      status: 'DELIVERED',
      invoice: { invoiceNumber: 'INV-2026-00001', pdfUrl: 'client/invoices/order_1/INV-2026-00001.pdf' }
    });
    const service = new OrdersService(fastify);
    const healedBuffer = Buffer.from('%PDF-1.4 re-rendered');
    const readMock = vi
      .fn()
      .mockRejectedValueOnce(new AppError(ERROR_CODES.NOT_FOUND, 'Invoice file not found', 404))
      .mockResolvedValueOnce(healedBuffer);
    vi.spyOn(
      service as unknown as { invoiceStorage: { readInvoicePdf: (url: string) => Promise<Buffer> } },
      'invoiceStorage',
      'get'
    ).mockReturnValue({ readInvoicePdf: readMock });
    regenerateInvoiceMock.mockResolvedValue({
      invoiceNumber: 'INV-2026-00001',
      pdfUrl: 'client/invoices/order_1/INV-2026-00001.pdf'
    });

    const result = await service.adminGetInvoicePdf('order_1');

    expect(regenerateInvoiceMock).toHaveBeenCalledWith(fastify.prisma, 'order_1', expect.anything());
    expect(result.invoiceNumber).toBe('INV-2026-00001');
    expect(result.content).toEqual(healedBuffer);
    expect(readMock).toHaveBeenCalledTimes(2);
  });

  it('throws 404 when the file is missing and the invoice row no longer exists', async () => {
    const fastify = makeFastify({
      id: 'order_1',
      status: 'DELIVERED',
      invoice: { invoiceNumber: 'INV-001', pdfUrl: 'client/invoices/order_1/INV-001.pdf' }
    });
    const service = new OrdersService(fastify);
    const readMock = vi
      .fn()
      .mockRejectedValue(new AppError(ERROR_CODES.NOT_FOUND, 'Invoice file not found', 404));
    vi.spyOn(
      service as unknown as { invoiceStorage: { readInvoicePdf: (url: string) => Promise<Buffer> } },
      'invoiceStorage',
      'get'
    ).mockReturnValue({ readInvoicePdf: readMock });
    regenerateInvoiceMock.mockResolvedValue(null);

    await expect(service.adminGetInvoicePdf('order_1')).rejects.toMatchObject({ statusCode: 404 });
  });

  it('passes actionable config errors from self-heal regeneration through to admins', async () => {
    const fastify = makeFastify({
      id: 'order_1',
      status: 'DELIVERED',
      invoice: { invoiceNumber: 'INV-001', pdfUrl: 'client/invoices/order_1/INV-001.pdf' }
    });
    const service = new OrdersService(fastify);
    const readMock = vi
      .fn()
      .mockRejectedValue(new AppError(ERROR_CODES.NOT_FOUND, 'Invoice file not found', 404));
    vi.spyOn(
      service as unknown as { invoiceStorage: { readInvoicePdf: (url: string) => Promise<Buffer> } },
      'invoiceStorage',
      'get'
    ).mockReturnValue({ readInvoicePdf: readMock });
    regenerateInvoiceMock.mockRejectedValue(
      new AppError(ERROR_CODES.VALIDATION_ERROR, 'Invoice storage is not writable (EACCES at /app/storage/invoices).', 422)
    );

    await expect(service.adminGetInvoicePdf('order_1')).rejects.toMatchObject({
      statusCode: 422,
      code: ERROR_CODES.VALIDATION_ERROR
    });
  });

  it('returns invoiceNumber and content buffer when invoice exists', async () => {
    const fastify = makeFastify({
      id: 'order_1',
      status: 'CONFIRMED',
      invoice: { invoiceNumber: 'INV-001', pdfUrl: '/storage/invoices/INV-001.pdf' }
    });
    const service = new OrdersService(fastify);
    const pdfBuffer = Buffer.from('%PDF-1.4 test content');
    mockInvoiceStorage(service, pdfBuffer);

    const result = await service.adminGetInvoicePdf('order_1');

    expect(generateInvoiceMock).not.toHaveBeenCalled();
    expect(result.invoiceNumber).toBe('INV-001');
    expect(result.content).toEqual(pdfBuffer);
  });
});
