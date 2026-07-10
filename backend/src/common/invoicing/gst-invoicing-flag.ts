import type { PrismaClient } from '@prisma/client';
import { featureFlags } from '@config/feature-flags';

/**
 * Effective GST-invoicing switch.
 *
 * `StoreSettings.gstInvoicingEnabled` (a merchant Admin → Settings toggle) is authoritative
 * once set — so the merchant can turn invoicing on or off live, without editing `.env` or
 * restarting. When it is still null (never set), we inherit the `FEATURE_GST_INVOICING_ENABLED`
 * env default, preserving each deployment's current behaviour. Fail-safe: any read error falls
 * back to the env flag.
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
