-- Align OpsUser table with invite/bootstrap flow (API-key auth removed).
-- Hosts created from older squashed baseline may still require apiKeyId/apiKeyHash NOT NULL.

ALTER TABLE "OpsUser"
  ALTER COLUMN "apiKeyId" DROP NOT NULL,
  ALTER COLUMN "apiKeyHash" DROP NOT NULL;

-- Current schema default is false (browser-session login, no mandatory TOTP bootstrap).
ALTER TABLE "OpsUser"
  ALTER COLUMN "mfaEnabled" SET DEFAULT false;
