export type UploadInvoiceInput = {
  orderId: string;
  invoiceNumber: string;
  content: Buffer;
};

export type UploadInvoiceResult = {
  storageReference: string;
  providerPayload: Record<string, unknown>;
};

export interface InvoiceStorageAdapter {
  uploadInvoicePdf(input: UploadInvoiceInput): Promise<UploadInvoiceResult>;
  readInvoicePdf(storageReference: string): Promise<Buffer>;
}
