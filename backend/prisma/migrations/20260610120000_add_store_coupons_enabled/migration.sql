-- Merchant-controlled storefront coupon toggle (Admin → Coupons).
ALTER TABLE "StoreSettings" ADD COLUMN "couponsEnabled" BOOLEAN NOT NULL DEFAULT false;

-- Existing stores with active coupons should keep storefront redemption enabled.
UPDATE "StoreSettings"
SET "couponsEnabled" = true
WHERE EXISTS (
  SELECT 1
  FROM "Coupon" c
  WHERE c."isActive" = true
    AND c."deletedAt" IS NULL
    AND c."validFrom" <= NOW()
    AND (c."validUntil" IS NULL OR c."validUntil" >= NOW())
);
