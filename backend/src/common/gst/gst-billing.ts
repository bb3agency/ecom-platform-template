import { featureFlags } from '@config/feature-flags';
import { resolvePickupPincode } from '@common/shipping/resolve-pickup-pincode';

/**
 * Effective GST billing mode — the single rule shared by the invoice PDF and the
 * checkout tax breakup. GST amounts appear only when BOTH switches allow it:
 *  • the GST-invoicing master flag (StoreSettings.gstInvoicingEnabled, else the
 *    FEATURE_GST_INVOICING_ENABLED env default), and
 *  • the GST-billing toggle (merchant setting; auto-default = on when a GSTIN exists).
 * When off, the customer-facing price IS the base price — no CGST/SGST/IGST rows
 * anywhere. Never changes totals either way (prices are GST-inclusive).
 */
export function computeEffectiveGstBillingEnabled(settings: {
  gstInvoicingEnabled?: boolean | null;
  gstBillingEnabled?: boolean | null;
  gstin?: string | null;
}): boolean {
  const gstInvoicingFlag = settings.gstInvoicingEnabled ?? featureFlags.gstInvoicing;
  return gstInvoicingFlag && (settings.gstBillingEnabled ?? Boolean((settings.gstin ?? '').trim()));
}

type GstCheckoutContextPrisma = {
  storeSettings?: {
    findUnique(args: {
      where: { singletonKey: string };
      select: {
        sellerState: true;
        gstin: true;
        gstBillingEnabled: true;
        gstInvoicingEnabled: true;
      };
    }): Promise<{
      sellerState: string | null;
      gstin: string | null;
      gstBillingEnabled: boolean | null;
      gstInvoicingEnabled: boolean | null;
    } | null>;
  };
} & Parameters<typeof resolvePickupPincode>[0];

export type GstCheckoutContext = {
  gstBillingEnabled: boolean;
  /** Seller origin for place-of-supply: admin pickup pincode + typed seller state. */
  sellerPincode: string | null;
  sellerStateName: string | null;
};

/**
 * Non-throwing seller-side GST context for checkout surfaces. Unlike the invoice
 * path this never blocks on an incomplete store profile — a tax DISPLAY must not
 * stop a checkout — it just reports gstBillingEnabled=false when unset.
 */
export async function resolveGstCheckoutContext(
  prisma: GstCheckoutContextPrisma
): Promise<GstCheckoutContext> {
  if (!prisma.storeSettings?.findUnique) {
    return { gstBillingEnabled: false, sellerPincode: null, sellerStateName: null };
  }
  const settings = await prisma.storeSettings.findUnique({
    where: { singletonKey: 'default' },
    select: {
      sellerState: true,
      gstin: true,
      gstBillingEnabled: true,
      gstInvoicingEnabled: true
    }
  });
  const sellerPincode = await resolvePickupPincode(prisma);
  return {
    gstBillingEnabled: computeEffectiveGstBillingEnabled(settings ?? {}),
    sellerPincode,
    sellerStateName: (settings?.sellerState ?? '').trim() || null
  };
}
