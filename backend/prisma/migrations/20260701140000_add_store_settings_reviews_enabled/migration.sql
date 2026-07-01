-- Merchant toggle for storefront customer reviews (Admin → Settings, replaces the
-- build-time FEATURE_REVIEWS_ENABLED env flag). Mirrors StoreSettings.couponsEnabled.
ALTER TABLE "StoreSettings" ADD COLUMN "reviewsEnabled" BOOLEAN NOT NULL DEFAULT false;
