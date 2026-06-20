-- Change notifySmsEnabled default from true to false.
-- SMS is an opt-in channel; email is the only default-active channel.
ALTER TABLE "StoreSettings" ALTER COLUMN "notifySmsEnabled" SET DEFAULT false;
