import { promises as fs } from 'fs';
import path from 'path';
import { AppError } from '@common/errors/app-error';
import { ERROR_CODES } from '@common/errors/error-codes';
import {
  type InvoiceStorageAdapter,
  type UploadInvoiceInput,
  type UploadInvoiceResult
} from '@common/interfaces/invoice-storage.interface';

type LocalInvoiceStorageAdapterOptions = {
  rootDir: string;
  clientId: string;
};

const SAFE_REFERENCE_REGEX = /^[a-zA-Z0-9_\-./]+$/;

export class LocalInvoiceStorageAdapter implements InvoiceStorageAdapter {
  private readonly rootDir: string;
  private readonly clientId: string;

  constructor(options: LocalInvoiceStorageAdapterOptions) {
    this.rootDir = path.resolve(options.rootDir);
    this.clientId = options.clientId.trim() || 'client';
  }

  async uploadInvoicePdf(input: UploadInvoiceInput): Promise<UploadInvoiceResult> {
    const storageReference = this.buildStorageReference(input.orderId, input.invoiceNumber);
    const absolutePath = this.resolveAbsolutePath(storageReference);
    const parentDir = path.dirname(absolutePath);

    await fs.mkdir(parentDir, { recursive: true });
    await fs.writeFile(absolutePath, input.content);

    return {
      storageReference,
      providerPayload: {
        provider: 'local-filesystem',
        absolutePath
      }
    };
  }

  async readInvoicePdf(storageReference: string): Promise<Buffer> {
    const absolutePath = this.resolveAbsolutePath(storageReference);

    try {
      return await fs.readFile(absolutePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new AppError(ERROR_CODES.NOT_FOUND, 'Invoice file not found', 404);
      }
      throw new AppError(ERROR_CODES.INTERNAL_ERROR, 'Failed to read invoice file', 500);
    }
  }

  private buildStorageReference(orderId: string, invoiceNumber: string): string {
    const safeOrderId = this.sanitizeSegment(orderId, 'orderId');
    const safeInvoiceNumber = this.sanitizeSegment(invoiceNumber, 'invoiceNumber');
    return `${this.clientId}/invoices/${safeOrderId}/${safeInvoiceNumber}.pdf`;
  }

  private sanitizeSegment(value: string, label: string): string {
    const trimmed = value.trim();
    if (!trimmed || !/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, `Invalid ${label} for invoice storage`, 400);
    }
    return trimmed;
  }

  private resolveAbsolutePath(storageReference: string): string {
    const normalized = storageReference.replace(/\\/g, '/').trim();
    if (!normalized || !SAFE_REFERENCE_REGEX.test(normalized) || normalized.includes('..')) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Invalid invoice storage reference', 400);
    }

    const absolutePath = path.resolve(this.rootDir, normalized);
    const relative = path.relative(this.rootDir, absolutePath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Invoice storage reference escapes root directory', 400);
    }

    return absolutePath;
  }
}
