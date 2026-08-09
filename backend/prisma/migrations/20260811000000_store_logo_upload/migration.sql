-- Uploaded invoice/brand logo stored in-row (small PNG/JPG, capped at upload).
-- Takes precedence over logoUrl; survives redeploys with zero storage plumbing
-- and lets the PDF renderer read bytes directly (backend-core 0.1.89).
ALTER TABLE "StoreSettings" ADD COLUMN "logoData" BYTEA;
ALTER TABLE "StoreSettings" ADD COLUMN "logoMimeType" TEXT;
