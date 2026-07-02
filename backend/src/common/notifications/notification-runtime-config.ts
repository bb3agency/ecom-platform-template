import type { PrismaClient } from '@prisma/client';
import { decryptOpsConfigValue } from '@common/security/ops-config-crypto';

/** Keys loaded from env + Ops DB overlay (same set as notifications worker). */
export const NOTIFICATION_RUNTIME_KEYS = [
  'NOTIFY_EMAIL_ENABLED',
  'NOTIFY_SMS_ENABLED',
  'NOTIFY_WHATSAPP_ENABLED',
  'OTP_WHATSAPP_ENABLED',
  'WHATSAPP_OTP_COST_PAISE',
  'SMS_PROVIDER',
  'RESEND_API_KEY',
  'RESEND_FROM',
  'MSG91_AUTH_KEY',
  'MSG91_SENDER_ID',
  'MSG91_ROUTE',
  'FAST2SMS_API_KEY',
  'META_WHATSAPP_ACCESS_TOKEN',
  'META_WHATSAPP_PHONE_NUMBER_ID',
  'META_WHATSAPP_API_VERSION'
] as const;

/**
 * Merges process.env with active OpsConfigSecret values (DB wins on overlap).
 * Matches notifications.worker resolveRuntimeConfig behaviour.
 */
export async function resolveNotificationRuntimeConfig(
  prisma?: PrismaClient
): Promise<NodeJS.ProcessEnv> {
  const runtimeConfig: NodeJS.ProcessEnv = {};

  for (const key of NOTIFICATION_RUNTIME_KEYS) {
    const envValue = process.env[key];
    if (envValue) {
      runtimeConfig[key] = envValue;
    }
  }

  if (!prisma) {
    return runtimeConfig;
  }

  const rows = await prisma.opsConfigSecret.findMany({
    where: {
      isActive: true,
      secretKey: { in: [...NOTIFICATION_RUNTIME_KEYS] }
    },
    select: {
      secretKey: true,
      encryptedValue: true
    }
  });

  for (const row of rows) {
    runtimeConfig[row.secretKey] = decryptOpsConfigValue(row.encryptedValue);
  }

  return runtimeConfig;
}
