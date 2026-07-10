-- Merchant GST invoicing toggle (nullable — null inherits the FEATURE_GST_INVOICING_ENABLED
-- env default; a set value is authoritative and can enable invoicing without a restart).
ALTER TABLE "StoreSettings" ADD COLUMN "gstInvoicingEnabled" BOOLEAN;
