import type { PrismaClient } from '@prisma/client';

/**
 * Estimates the money spent sending auth OTPs over WhatsApp.
 *
 * WhatsApp Cloud API bills authentication/utility messages per message. We can't read Meta's
 * actual invoice from the API, so we approximate: count the WhatsApp OTP notifications we
 * successfully sent and multiply by a configurable per-message rate (WHATSAPP_OTP_COST_PAISE,
 * default ~12 paise ≈ ₹0.115 + GST for India). This is a display-only estimate for Ops — it is
 * intentionally independent of whether OTP-over-WhatsApp is currently enabled, because it reports
 * on historical sends.
 */

/** Internal template names logged in NotificationLog for auth OTP messages. */
export const OTP_TEMPLATE_NAMES = ['CustomerOtpVerification', 'OtpVerification'] as const;

/** Default per-message cost in paise (₹0.115 + 18% GST ≈ ₹0.136, rounded up to whole paise). */
export const DEFAULT_WHATSAPP_OTP_COST_PAISE = 14;

export type WhatsappOtpCostEstimate = {
  costPerMessagePaise: number;
  billingCycleStart: string;
  allTime: { count: number; costPaise: number };
  currentCycle: { count: number; costPaise: number };
};

export function resolveWhatsappOtpCostPaise(runtime: NodeJS.ProcessEnv): number {
  const raw = (runtime.WHATSAPP_OTP_COST_PAISE ?? '').trim();
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_WHATSAPP_OTP_COST_PAISE;
}

/** Start of the current WhatsApp billing cycle: first day of the current calendar month (UTC). */
export function currentBillingCycleStart(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export async function computeWhatsappOtpCost(
  prisma: PrismaClient,
  runtime: NodeJS.ProcessEnv,
  now: Date = new Date()
): Promise<WhatsappOtpCostEstimate> {
  const cycleStart = currentBillingCycleStart(now);
  const baseWhere = {
    channel: 'WHATSAPP' as const,
    status: 'SENT' as const,
    template: { in: [...OTP_TEMPLATE_NAMES] }
  };

  const [totalCount, cycleCount] = await Promise.all([
    prisma.notificationLog.count({ where: baseWhere }),
    prisma.notificationLog.count({ where: { ...baseWhere, createdAt: { gte: cycleStart } } })
  ]);

  const costPerMessagePaise = resolveWhatsappOtpCostPaise(runtime);

  return {
    costPerMessagePaise,
    billingCycleStart: cycleStart.toISOString(),
    allTime: { count: totalCount, costPaise: totalCount * costPerMessagePaise },
    currentCycle: { count: cycleCount, costPaise: cycleCount * costPerMessagePaise }
  };
}
