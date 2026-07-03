-- Merchant toggle for customer order returns (Admin → Settings → Store Policies).
-- Default TRUE preserves current behaviour (returns have been available to customers).
ALTER TABLE "StoreSettings" ADD COLUMN "returnsEnabled" BOOLEAN NOT NULL DEFAULT true;
