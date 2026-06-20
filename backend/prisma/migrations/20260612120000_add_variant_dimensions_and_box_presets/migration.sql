-- AlterTable: add packaging dimension columns to ProductVariant
ALTER TABLE "ProductVariant" ADD COLUMN "packageLengthCm" INTEGER,
ADD COLUMN "packageWidthCm" INTEGER,
ADD COLUMN "packageHeightCm" INTEGER;

-- AlterTable: add box presets JSON column to StoreSettings
ALTER TABLE "StoreSettings" ADD COLUMN "boxPresets" JSONB;
