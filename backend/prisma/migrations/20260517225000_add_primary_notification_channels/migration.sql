-- Add per-template primary notification channel mapping to StoreSettings
ALTER TABLE "StoreSettings"
ADD COLUMN "primaryNotificationChannels" JSONB;
