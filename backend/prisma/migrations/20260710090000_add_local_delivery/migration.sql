-- Merchant-fulfilled local delivery (whitelisted pincodes; courier providers never invoked)

-- AlterEnum: add LOCAL and drop the never-used SELF in one recreate (Postgres has no
-- ALTER TYPE ... DROP VALUE). SELF was never written by any code path (verified: zero
-- usages outside 0_init), so the USING casts are safe on every existing row.
CREATE TYPE "ShippingProvider_new" AS ENUM ('DELHIVERY', 'SHIPROCKET', 'LOCAL');
ALTER TABLE "Order" ALTER COLUMN "selectedShippingProvider" TYPE "ShippingProvider_new"
  USING ("selectedShippingProvider"::text::"ShippingProvider_new");
ALTER TABLE "Shipment" ALTER COLUMN "provider" TYPE "ShippingProvider_new"
  USING ("provider"::text::"ShippingProvider_new");
ALTER TYPE "ShippingProvider" RENAME TO "ShippingProvider_old";
ALTER TYPE "ShippingProvider_new" RENAME TO "ShippingProvider";
DROP TYPE "ShippingProvider_old";

-- AlterTable: local delivery configuration on the store settings singleton
ALTER TABLE "StoreSettings" ADD COLUMN "localDeliveryEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "StoreSettings" ADD COLUMN "localDeliveryPincodes" JSONB;
ALTER TABLE "StoreSettings" ADD COLUMN "localDeliveryDefaultFeePaise" INTEGER NOT NULL DEFAULT 2000;
ALTER TABLE "StoreSettings" ADD COLUMN "localDeliveryFreeAbovePaise" INTEGER;
ALTER TABLE "StoreSettings" ADD COLUMN "localDeliveryEstimatedDays" INTEGER NOT NULL DEFAULT 1;
