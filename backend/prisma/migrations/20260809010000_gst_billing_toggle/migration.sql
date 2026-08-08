-- Merchant GST billing toggle: whether invoices show a GST breakdown (carved out of
-- GST-inclusive catalog prices) and are titled "TAX INVOICE". NULL = auto (on when a
-- GSTIN is configured). Independent of gstInvoicingEnabled, which gates whether
-- invoice PDFs exist at all.
ALTER TABLE "StoreSettings" ADD COLUMN "gstBillingEnabled" BOOLEAN;
