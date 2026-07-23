/**
 * Product-level local delivery and cart splitting.
 *
 * A product flagged `isLocalDeliveryOnly` is fulfilled by the merchant directly and is never
 * handed to a courier (Delhivery/Shiprocket). It can therefore only reach pincodes on the
 * merchant's local-delivery whitelist (Admin → Settings → Local Delivery).
 *
 * Two independent signals decide fulfilment, and BOTH matter:
 *
 *   the product flag  — a flagged product is local-delivery-ONLY, always, whatever the pincode
 *   the pincode       — a whitelisted pincode is an area the merchant drives to
 *
 * Which gives this table:
 *
 *   cart contents          pincode whitelisted   result
 *   ────────────────────── ───────────────────── ──────────────────────────────────────────
 *   no flagged products    yes                   ALL_LOCAL  — merchant delivers the whole cart
 *   no flagged products    no                    ALL_COURIER
 *   some flagged, some not yes                   SPLIT      — two sibling orders
 *   some flagged, some not no                    BLOCKED    — remove the flagged items
 *   all flagged            yes                   ALL_LOCAL
 *   all flagged            no                    BLOCKED
 *
 * The key point: an unflagged product is NOT "courier-only" — it is "either is fine", so a
 * whitelisted pincode pulls it into the local channel. That is why a store with zero flagged
 * products keeps working exactly as it did before product-level flags existed. The flag only
 * ever ADDS a restriction (never couriered), it never removes the whitelist's reach.
 *
 * A SPLIT therefore happens only when the cart genuinely needs both channels: flagged items the
 * merchant must hand-deliver alongside items being couriered. The courier leg is then rated on
 * the courier items ONLY — the flagged items' weight and box dimensions are excluded, since
 * they never enter the courier network.
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

  // No local-only products: the pincode whitelist alone decides. A whitelisted pincode means
  // the merchant drives to that area, so they deliver the whole cart themselves at the local
  // fee — no courier, no split. This is the long-standing local-delivery behaviour and the
  // reason an ordinary store needs zero per-product configuration to keep working.
  if (localOnly.length === 0) {
    if (opts.pincodeLocallyDeliverable) {
      return { mode: 'ALL_LOCAL', localItems: courier, courierItems: [], blockedItems: [] };
    }
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
