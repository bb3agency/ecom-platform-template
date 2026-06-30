-- AlterTable: add manual display ordering to ProductVariant.
-- Admins can drag-and-drop variants; this column drives the order they appear in
-- the admin editor AND on the storefront (product detail + product cards).
ALTER TABLE "ProductVariant" ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- Backfill: preserve the current visual order (price ascending) so existing
-- catalogs look unchanged until an admin reorders. Each product's variants get
-- a 0-based rank by price (createdAt as a stable tie-break).
WITH ranked AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "productId"
      ORDER BY "price" ASC, "createdAt" ASC
    ) - 1 AS rn
  FROM "ProductVariant"
)
UPDATE "ProductVariant" v
SET "sortOrder" = ranked.rn
FROM ranked
WHERE v."id" = ranked."id";

-- Helps the per-product ordered reads.
CREATE INDEX "ProductVariant_productId_sortOrder_idx" ON "ProductVariant" ("productId", "sortOrder");
