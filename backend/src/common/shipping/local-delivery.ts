import type { PrismaClient } from '@prisma/client';

/**
 * Merchant-fulfilled local delivery.
 *
 * When the customer's pincode is on the merchant's whitelist (Admin → Settings →
 * Local Delivery), the merchant delivers the order themselves: the order is flagged
 * `selectedShippingProvider = 'LOCAL'` and no courier is involved at all — no
 * serviceability calls, no rate quotes, no shipment booking, no webhooks. The merchant
 * advances the status manually from the admin panel.
 *
 * This module answers only "is this pincode locally deliverable, and at what fee". WHICH
 * items go local is decided by ./local-delivery-split.ts, because a product can be flagged
 * `isLocalDeliveryOnly`. The one case where a whitelisted pincode still touches a courier is
 * a SPLIT cart: flagged items become a LOCAL order and the remaining items become a separate
 * courier order, rated on those items alone.
 *
 * Fee model: each whitelisted pincode may carry its own fee; a pincode without an
 * explicit fee falls back to the store-wide default (₹20). One optional
 * free-above-subtotal threshold applies across all local pincodes. No weight,
 * box-dimension, or packaging computation is involved — the fee is purely
 * pincode-based.
 */

export const LOCAL_DELIVERY_DEFAULT_FEE_PAISE = 2000;
export const LOCAL_DELIVERY_DEFAULT_ESTIMATED_DAYS = 1;

export type LocalDeliveryPincode = {
  /** 6-digit Indian pincode. */
  pincode: string;
  /** Per-pincode fee in paise. Null/absent → store default fee applies. */
  feePaise?: number | null;
};

export type LocalDeliverySettings = {
  enabled: boolean;
  pincodes: LocalDeliveryPincode[];
  defaultFeePaise: number;
  /** Subtotal (paise) at/above which local delivery is free. Null = never free. */
  freeAbovePaise: number | null;
  estimatedDays: number;
};

const PINCODE_RE = /^[1-9][0-9]{5}$/;

export function isValidLocalPincode(value: string): boolean {
  return PINCODE_RE.test(value);
}

/** Parses the StoreSettings.localDeliveryPincodes JSON column defensively. */
export function parseLocalDeliveryPincodes(raw: unknown): LocalDeliveryPincode[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: LocalDeliveryPincode[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    const pincode = typeof record.pincode === 'string' ? record.pincode.trim() : '';
    if (!isValidLocalPincode(pincode) || seen.has(pincode)) continue;
    seen.add(pincode);
    const feeRaw = record.feePaise;
    const feePaise =
      typeof feeRaw === 'number' && Number.isFinite(feeRaw) && feeRaw >= 0
        ? Math.floor(feeRaw)
        : null;
    out.push({ pincode, feePaise });
  }
  return out;
}

/**
 * Loads the merchant's local delivery configuration. Fail-safe: any read error
 * returns a disabled config so the courier path proceeds exactly as before.
 */
export async function resolveLocalDeliverySettings(
  prisma: Pick<PrismaClient, 'storeSettings'>
): Promise<LocalDeliverySettings> {
  const disabled: LocalDeliverySettings = {
    enabled: false,
    pincodes: [],
    defaultFeePaise: LOCAL_DELIVERY_DEFAULT_FEE_PAISE,
    freeAbovePaise: null,
    estimatedDays: LOCAL_DELIVERY_DEFAULT_ESTIMATED_DAYS
  };
  try {
    const settings = (await prisma.storeSettings.findUnique({
      where: { singletonKey: 'default' },
      select: {
        localDeliveryEnabled: true,
        localDeliveryPincodes: true,
        localDeliveryDefaultFeePaise: true,
        localDeliveryFreeAbovePaise: true,
        localDeliveryEstimatedDays: true
      }
    })) as {
      localDeliveryEnabled?: boolean;
      localDeliveryPincodes?: unknown;
      localDeliveryDefaultFeePaise?: number;
      localDeliveryFreeAbovePaise?: number | null;
      localDeliveryEstimatedDays?: number;
    } | null;
    if (!settings) return disabled;
    return {
      enabled: settings.localDeliveryEnabled ?? false,
      pincodes: parseLocalDeliveryPincodes(settings.localDeliveryPincodes),
      defaultFeePaise:
        typeof settings.localDeliveryDefaultFeePaise === 'number' && settings.localDeliveryDefaultFeePaise >= 0
          ? settings.localDeliveryDefaultFeePaise
          : LOCAL_DELIVERY_DEFAULT_FEE_PAISE,
      freeAbovePaise:
        typeof settings.localDeliveryFreeAbovePaise === 'number' && settings.localDeliveryFreeAbovePaise > 0
          ? settings.localDeliveryFreeAbovePaise
          : null,
      estimatedDays:
        typeof settings.localDeliveryEstimatedDays === 'number' && settings.localDeliveryEstimatedDays >= 1
          ? settings.localDeliveryEstimatedDays
          : LOCAL_DELIVERY_DEFAULT_ESTIMATED_DAYS
    };
  } catch {
    return disabled;
  }
}

export type LocalDeliveryQuote = {
  provider: 'LOCAL';
  shippingChargePaise: number;
  estimatedDays: number;
};

/**
 * Returns the local delivery quote for a destination pincode, or null when the
 * pincode is not locally deliverable (feature off / pincode not whitelisted).
 *
 * `subtotalPaise` drives the free-above threshold; `freeShippingCoupon` zeroes
 * the customer-facing charge exactly like the courier path does.
 */
export function resolveLocalDeliveryQuote(
  settings: LocalDeliverySettings,
  destinationPincode: string,
  options?: { subtotalPaise?: number; freeShippingCoupon?: boolean }
): LocalDeliveryQuote | null {
  if (!settings.enabled) return null;
  const pincode = destinationPincode.trim();
  const match = settings.pincodes.find((entry) => entry.pincode === pincode);
  if (!match) return null;

  const baseFee = match.feePaise ?? settings.defaultFeePaise;
  const subtotal = options?.subtotalPaise ?? 0;
  const freeByThreshold = settings.freeAbovePaise != null && subtotal >= settings.freeAbovePaise;
  const shippingChargePaise = options?.freeShippingCoupon || freeByThreshold ? 0 : baseFee;

  return {
    provider: 'LOCAL',
    shippingChargePaise,
    estimatedDays: settings.estimatedDays
  };
}
