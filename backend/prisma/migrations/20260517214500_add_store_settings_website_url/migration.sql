-- Add website URL for DB-first client metadata in alerting
ALTER TABLE "StoreSettings"
ADD COLUMN "websiteUrl" TEXT;
