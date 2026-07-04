-- Merchant-managed social links (Admin → Settings → Store) rendered as footer
-- icons on the storefront. WhatsApp needs no column — its link derives from the
-- existing contactPhone.
ALTER TABLE "StoreSettings" ADD COLUMN "facebookUrl" TEXT;
ALTER TABLE "StoreSettings" ADD COLUMN "instagramUrl" TEXT;
