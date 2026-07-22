/**
 * Product-level local delivery and cart splitting.
 *
 * A product flagged `isLocalDeliveryOnly` is fulfilled by the merchant directly and is never
 * handed to a courier (Delhivery/Shiprocket). It can therefore only reach pincodes on the
 * merchant's local-delivery whitelist (Admin → Settings → Local Delivery).
 *
 * That gives a cart four possible shapes at checkout:
 *
 *   ALL_COURIER  no local-only products      → one ordinary courier order
 *   ALL_LOCAL    only local-only products,   → one order with selectedShippingProvider = LOCAL
 *                pincode whitelisted
 *   SPLIT        both kinds, pincode         → TWO sibling orders sharing an orderGroupId:
 *                whitelisted                   the local one and the courier one
 *   BLOCKED      local-only products present → checkout refused; the customer must remove the
 *                but pincode NOT whitelisted   offending products (they cannot be shipped there)
 *
 * Note the deliberate asymmetry: an *unflagged* product always goes by courier, even to a
 * whitelisted pincode. The whitelist gates what local-only products can reach; it does not
 * pull ordinary products into the local channel.
 *
 * This module is pure — no Prisma, no network — so every branch is unit-testable.
 * Fee resolution for the local leg lives in ./local-delivery.ts.
 */

export type LocalDeliverySplitMode = 'ALL_COURIER' | 'ALL_LOCAL' | 'SPLIT' | 'BLOCKED';

/** Minimum shape the classifier needs. Cart items and checkout-session items both satisfy it. */
export type SplittableItem = {
  isLocalDeliveryOnly: boolean;
};

export type LocalDeliverySplitResult<T extends SplittableItem> = {
  mode: LocalDeliverySplitMode;
  /** Items fulfilled by the merchant locally. Empty unless mode is ALL_LOCAL or SPLIT. */
  localItems: T[];
  /** Items handed to a courier. Empty unless mode is ALL_COURIER or SPLIT. */
  courierItems: T[];
  /**
   * Local-only items that cannot reach the destination pincode. Non-empty only when
   * mode is BLOCKED — these are exactly the items the customer has to remove.
   */
  blockedItems: T[];
};

/**
 * Decides how a cart must be fulfilled for a given destination.
 *
 * `pincodeLocallyDeliverable` is the outcome of resolveLocalDeliveryQuote() — i.e. the local
 * delivery feature is enabled AND this pincode is whitelisted.
 */
export function classifyLocalDeliverySplit<T extends SplittableItem>(
  items: readonly T[],
  opts: { pincodeLocallyDeliverable: boolean }
): LocalDeliverySplitResult<T> {
  const localOnly = items.filter((item) => item.isLocalDeliveryOnly);
  const courier = items.filter((item) => !item.isLocalDeliveryOnly);

  // No local-only products: ordinary courier order regardless of whether the pincode
  // happens to be whitelisted.
  if (localOnly.length === 0) {
    return { mode: 'ALL_COURIER', localItems: [], courierItems: courier, blockedItems: [] };
  }

  // Local-only products present but the merchant does not deliver to this pincode. Nothing
  // can be shipped — the customer must remove these items to proceed.
  if (!opts.pincodeLocallyDeliverable) {
    return { mode: 'BLOCKED', localItems: [], courierItems: [], blockedItems: localOnly };
  }

  if (courier.length === 0) {
    return { mode: 'ALL_LOCAL', localItems: localOnly, courierItems: [], blockedItems: [] };
  }

  return { mode: 'SPLIT', localItems: localOnly, courierItems: courier, blockedItems: [] };
}

/**
 * Splits `totalPaise` across `weights` proportionally, exactly — the returned parts always
 * sum back to `totalPaise`, with no rounding loss.
 *
 * Uses the largest-remainder method: everyone gets their floor, then leftover paise go to the
 * largest fractional remainders (ties broken toward the heavier weight, then the lower index,
 * so the result is deterministic).
 *
 * Used to apportion the cart's coupon discount across split orders by subtotal, so the
 * customer pays exactly the total they were quoted no matter how the cart divides.
 */
export function apportionPaise(totalPaise: number, weights: readonly number[]): number[] {
  const n = weights.length;
  if (n === 0) return [];

  const safeWeights = weights.map((w) => (Number.isFinite(w) && w > 0 ? w : 0));
  const totalWeight = safeWeights.reduce((sum, w) => sum + w, 0);
  const amount = Math.max(0, Math.floor(totalPaise));

  // Degenerate: nothing to weigh by (e.g. a zero-subtotal cart). Put it all on the first
  // bucket rather than silently dropping paise.
  if (totalWeight === 0) {
    return safeWeights.map((_, i) => (i === 0 ? amount : 0));
  }

  const exact = safeWeights.map((w) => (amount * w) / totalWeight);
  const parts = exact.map((value) => Math.floor(value));
  let remaining = amount - parts.reduce((sum, p) => sum + p, 0);

  const order = exact
    .map((value, index) => ({ index, frac: value - Math.floor(value), weight: safeWeights[index] ?? 0 }))
    .sort((a, b) => b.frac - a.frac || b.weight - a.weight || a.index - b.index);

  for (let i = 0; remaining > 0 && i < order.length; i += 1) {
    parts[order[i]!.index] = (parts[order[i]!.index] ?? 0) + 1;
    remaining -= 1;
  }

  return parts;
}

export type SplitLegTotals = {
  subtotalPaise: number;
  shippingChargePaise: number;
  discountAmountPaise: number;
  totalPaise: number;
};

/**
 * Computes the per-order money for a split cart.
 *
 * The discount is apportioned pro-rata by subtotal so neither leg absorbs the whole coupon.
 * Eligibility thresholds (coupon minimum, free-shipping-above, store minimum order value) are
 * deliberately evaluated upstream on the WHOLE cart — the customer must never lose a benefit
 * merely because the cart happened to divide across fulfilment channels.
 *
 * Each leg carries its own shipping: the local fee for the local leg, the courier quote
 * (computed on the courier items only) for the courier leg.
 */
export function computeSplitLegTotals(input: {
  localSubtotalPaise: number;
  courierSubtotalPaise: number;
  localShippingPaise: number;
  courierShippingPaise: number;
  totalDiscountPaise: number;
}): { local: SplitLegTotals; courier: SplitLegTotals } {
  const [localDiscount = 0, courierDiscount = 0] = apportionPaise(input.totalDiscountPaise, [
    input.localSubtotalPaise,
    input.courierSubtotalPaise
  ]);

  const build = (subtotal: number, shipping: number, discount: number): SplitLegTotals => ({
    subtotalPaise: subtotal,
    shippingChargePaise: shipping,
    discountAmountPaise: discount,
    totalPaise: Math.max(subtotal + shipping - discount, 0)
  });

  return {
    local: build(input.localSubtotalPaise, input.localShippingPaise, localDiscount),
    courier: build(input.courierSubtotalPaise, input.courierShippingPaise, courierDiscount)
  };
}
