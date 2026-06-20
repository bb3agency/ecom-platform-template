import { mergeCart } from "@/lib/cart-api";
import { useCartStore } from "@/stores/cart";

/**
 * Merges guest cart (cart_session cookie) into the authenticated user's cart.
 * Always attempted after login/signup — not only when pendingMerge was flagged.
 */
export async function mergeGuestCartAfterAuth(accessToken: string): Promise<void> {
  try {
    await mergeCart(accessToken);
  } catch {
    // Non-fatal: user may have no guest cart or merge already completed.
  }
  useCartStore.getState().clearPendingMerge();
}
