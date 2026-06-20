-- Add seller legal fields to StoreSettings
ALTER TABLE "StoreSettings"
  ADD COLUMN IF NOT EXISTS "sellerLegalName" TEXT,
  ADD COLUMN IF NOT EXISTS "sellerAddress" TEXT;
