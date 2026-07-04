-- Per-ADMIN opt-in for new-order notifications (Admin → Settings → Notifications
-- → "Notify me about new orders"), with the channels each admin selected.
ALTER TABLE "User" ADD COLUMN "orderNotificationsEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "orderNotificationChannels" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
