/**
 * Product-level local delivery routing.
 *
 * A product flagged `isLocalDeliveryOnly` is fulfilled by the merchant directly and can NEVER
 * be handed to a courier (Delhivery/Shiprocket), so it can only reach pincodes on the merchant's
 * local-delivery whitelist (Admin → Settings → Local Delivery).
 *
 * Two signals decide fulfilment, and the routing is a single order every time — a cart is never
 * split across channels:
 *
 *   pincode whitelisted?   cart has a flagged product?   result
 *   ────────────────────── ───────────────────────────── ─────────────────────────────────────
 *   yes                    (either)                      ALL_LOCAL  — merchant delivers the cart
 *   no                     no                            ALL_COURIER
 *   no                     yes                           BLOCKED    — remove the flagged items
 *
 * The whitelist is the merchant saying "I drive to this area", so a whitelisted pincode means
 * the WHOLE cart is delivered by the merchant at the pincode fee — the flagged and unflagged
 * items ride together, no courier, no second order. The flag only matters when the pincode is
 * NOT whitelisted: a flagged item cannot be couriered, so checkout is refused until the customer
 * removes it, while any unflagged items would have gone by courier.
 *
 * This module is pure — no Prisma, no network — so every branch is unit-testable.
 * Fee resolution for the local channel lives in ./local-delivery.ts.
 */

export type LocalDeliverySplitMode = 'ALL_COURIER' | 'ALL_LOCAL' | 'BLOCKED';

/** Minimum shape the classifier needs. Cart items and checkout-session items both satisfy it. */
export type SplittableItem = {
  isLocalDeliveryOnly: boolean;
};

export type LocalDeliverySplitResult<T extends SplittableItem> = {
  mode: LocalDeliverySplitMode;
  /** Items the merchant delivers directly. Populated only when mode is ALL_LOCAL. */
  localItems: T[];
  /** Items handed to a courier. Populated only when mode is ALL_COURIER. */
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
  // Whitelisted pincode: the merchant delivers the whole cart themselves at the local fee,
  // regardless of which items are flagged. No courier, no split.
  if (opts.pincodeLocallyDeliverable) {
    return { mode: 'ALL_LOCAL', localItems: [...items], courierItems: [], blockedItems: [] };
  }

  // Not whitelisted: any local-delivery-only item cannot be shipped here at all, so checkout
  // is refused until the customer removes them.
  const localOnly = items.filter((item) => item.isLocalDeliveryOnly);
  if (localOnly.length > 0) {
    return { mode: 'BLOCKED', localItems: [], courierItems: [], blockedItems: localOnly };
  }

  // Not whitelisted, nothing flagged: ordinary courier order.
  return { mode: 'ALL_COURIER', localItems: [], courierItems: [...items], blockedItems: [] };
}
