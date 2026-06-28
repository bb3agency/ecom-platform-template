-- AlterTable: add keepUpright packing constraint to ProductVariant.
-- When true, the cartonization engine only rotates the item about its vertical
-- axis (height stays fixed) — for fragile / "this side up" / liquid products.
ALTER TABLE "ProductVariant" ADD COLUMN "keepUpright" BOOLEAN NOT NULL DEFAULT false;
