import type { PrismaClient } from '@prisma/client';
import { featureFlags } from '@config/feature-flags';

/**
 * Effective GST-invoicing switch — controls whether invoices carry GST, NOT whether
 * invoices exist.
 *
 * IMPORTANT (2026-08-10): turning this OFF must never stop an invoice from being
 * generated or downloaded. Every order still gets a document — a plain "INVOICE" with
 * no tax columns instead of a "TAX INVOICE". A customer is always entitled to a bill;
 * the merchant's GST registration status only changes what that bill looks like.
 * Previously this flag hard-gated generation and both download endpoints (400/404),
 * so switching it off broke invoicing entirely.
 *
 * `StoreSettings.gstInvoicingEnabled` (a merchant Admin → Settings toggle) is authoritative
 * once set — so the merchant can toggle it live, without editing `.env` or restarting. When
 * it is still null (never set), we inherit the `FEATURE_GST_INVOICING_ENABLED` env default.
 * Fail-safe: any read error falls back to the env flag.
 */
export async function resolveGstInvoicingEnabled(
  prisma: Pick<PrismaClient, 'storeSettings'>
): Promise<boolean> {
  try {
    const settings = (await prisma.storeSettings.findUnique({
      where: { singletonKey: 'default' },
      select: { gstInvoicingEnabled: true }
    })) as { gstInvoicingEnabled?: boolean | null } | null;
    const stored = settings?.gstInvoicingEnabled;
    return stored == null ? featureFlags.gstInvoicing : stored;
  } catch {
    return featureFlags.gstInvoicing;
  }
}
