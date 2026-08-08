import { beforeEach, describe, expect, it, vi } from 'vitest';

const mkdirMock = vi.fn();
const writeFileMock = vi.fn();
const readFileMock = vi.fn();

vi.mock('fs', () => ({
  promises: {
    mkdir: (...args: unknown[]) => mkdirMock(...args),
    writeFile: (...args: unknown[]) => writeFileMock(...args),
    readFile: (...args: unknown[]) => readFileMock(...args)
  }
}));

import { LocalInvoiceStorageAdapter } from './local-invoice-storage.adapter';

function errnoError(code: string): NodeJS.ErrnoException {
  const err = new Error(code) as NodeJS.ErrnoException;
  err.code = code;
  return err;
}

describe('LocalInvoiceStorageAdapter.uploadInvoicePdf error classification', () => {
  beforeEach(() => {
    mkdirMock.mockReset();
    writeFileMock.mockReset();
  });

  it('classifies EACCES as an actionable 422 config error (unwritable storage root)', async () => {
    mkdirMock.mockRejectedValue(errnoError('EACCES'));
    const adapter = new LocalInvoiceStorageAdapter({ rootDir: '/var/www/client/storage/invoices', clientId: 'client' });

    await expect(
      adapter.uploadInvoicePdf({ orderId: 'order1', invoiceNumber: 'INV-2026-00001', content: Buffer.from('%PDF-') })
    ).rejects.toMatchObject({
      statusCode: 422,
      message: expect.stringContaining('Invoice storage is not writable (EACCES')
    });
  });

  it('classifies ENOENT on write as the same actionable 422', async () => {
    mkdirMock.mockResolvedValue(undefined);
    writeFileMock.mockRejectedValue(errnoError('ENOENT'));
    const adapter = new LocalInvoiceStorageAdapter({ rootDir: '/app/storage/invoices', clientId: 'client' });

    await expect(
      adapter.uploadInvoicePdf({ orderId: 'order1', invoiceNumber: 'INV-2026-00001', content: Buffer.from('%PDF-') })
    ).rejects.toMatchObject({ statusCode: 422 });
  });

  it('rethrows unexpected write failures untouched (still alertable 500s upstream)', async () => {
    mkdirMock.mockResolvedValue(undefined);
    writeFileMock.mockRejectedValue(new Error('disk exploded'));
    const adapter = new LocalInvoiceStorageAdapter({ rootDir: '/app/storage/invoices', clientId: 'client' });

    await expect(
      adapter.uploadInvoicePdf({ orderId: 'order1', invoiceNumber: 'INV-2026-00001', content: Buffer.from('%PDF-') })
    ).rejects.toThrow('disk exploded');
  });

  it('uploads successfully when the filesystem cooperates', async () => {
    mkdirMock.mockResolvedValue(undefined);
    writeFileMock.mockResolvedValue(undefined);
    const adapter = new LocalInvoiceStorageAdapter({ rootDir: '/app/storage/invoices', clientId: 'client' });

    const result = await adapter.uploadInvoicePdf({
      orderId: 'order1',
      invoiceNumber: 'INV-2026-00001',
      content: Buffer.from('%PDF-')
    });
    expect(result.storageReference).toBe('client/invoices/order1/INV-2026-00001.pdf');
  });
});
