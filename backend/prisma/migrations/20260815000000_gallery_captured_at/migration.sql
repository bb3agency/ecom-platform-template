-- Gallery timeline (backend-core 0.1.99): the date a photo was TAKEN, entered by
-- the merchant, as distinct from createdAt (when it was uploaded). Drives the
-- storefront gallery's date-grouped timeline — without it, a years-old farm photo
-- uploaded today would be filed under today. Nullable: existing rows keep falling
-- back to createdAt, so this is a pure add with no backfill required.
ALTER TABLE "GalleryImage" ADD COLUMN "capturedAt" TIMESTAMP(3);

-- The timeline reads active images newest-first by capture date.
CREATE INDEX "GalleryImage_isActive_capturedAt_idx" ON "GalleryImage"("isActive", "capturedAt");

-- Intrinsic pixel size, parsed from the image header at upload (no decode, no
-- new dependency). The timeline uses it to build aspect-preserving justified
-- rows without layout shift; existing rows stay NULL and fall back to a 4:3 box.
ALTER TABLE "GalleryImage" ADD COLUMN "width" INTEGER;
ALTER TABLE "GalleryImage" ADD COLUMN "height" INTEGER;
