import { type InvoiceStorageAdapter } from '@common/interfaces/invoice-storage.interface';
import { AppError } from '@common/errors/app-error';
import { ERROR_CODES } from '@common/errors/error-codes';
import path from 'path';
import { LocalInvoiceStorageAdapter } from './adapters/local-invoice-storage.adapter';

export function createInvoiceStorageProvider(): InvoiceStorageAdapter {
  const configuredRoot = (process.env.INVOICE_STORAGE_ROOT ?? '').trim();
  const rootDir = configuredRoot.length > 0 ? configuredRoot : path.resolve(process.cwd(), 'storage', 'invoices');
  if (!rootDir) {
    throw new AppError(ERROR_CODES.INTERNAL_ERROR, 'INVOICE_STORAGE_ROOT must resolve to a valid path', 500);
  }

  return new LocalInvoiceStorageAdapter({
    rootDir,
    clientId: process.env.CLIENT_ID ?? 'client'
  });
}
