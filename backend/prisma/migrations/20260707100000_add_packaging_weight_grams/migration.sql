-- Flat packaging (carton + tape + void fill) weight override in grams, set by the
-- merchant in Admin → Settings → Shipping → Packing boxes. When NULL, packaging
-- weight is estimated from the selected box's surface area (see
-- backend/src/common/shipping/cartonize.ts estimatePackagingWeightGrams).
ALTER TABLE "StoreSettings" ADD COLUMN "packagingWeightGrams" INTEGER;
