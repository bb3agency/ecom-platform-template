import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInvoiceStorageProvider } from './invoice-storage-provider';
import { LocalInvoiceStorageAdapter } from './adapters/local-invoice-storage.adapter';

describe('invoice storage provider', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('creates local storage provider with default root when INVOICE_STORAGE_ROOT is absent', () => {
    vi.stubEnv('INVOICE_STORAGE_ROOT', '');
    vi.stubEnv('CLIENT_ID', 'client_dev');

    const provider = createInvoiceStorageProvider();

    expect(provider).toBeInstanceOf(LocalInvoiceStorageAdapter);
  });

  it('creates local storage provider with configured root', () => {
    vi.stubEnv('INVOICE_STORAGE_ROOT', '/tmp/invoices');
    vi.stubEnv('CLIENT_ID', 'client_prod');

    const provider = createInvoiceStorageProvider();

    expect(provider).toBeInstanceOf(LocalInvoiceStorageAdapter);
  });
});
