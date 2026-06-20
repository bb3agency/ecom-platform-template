-- Add mobileOtpSignupEnabled to StoreSettings.
-- Controls whether the mobile OTP signup tab is shown to customers.
-- Defaults to false so existing stores only show email signup until
-- the merchant explicitly enables it from the admin panel.
ALTER TABLE "StoreSettings" ADD COLUMN "mobileOtpSignupEnabled" BOOLEAN NOT NULL DEFAULT false;
