import { addToWishlist } from "@/lib/wishlist-api";
import { useWishlistStore } from "@/stores/wishlist";

/**
 * Pushes guest-saved favourites (held in the local wishlist store / localStorage)
 * into the authenticated user's server wishlist after login. Best-effort: items
 * that already exist or fail transiently are ignored. Mirrors the guest-cart
 * merge pattern so favourites added while logged-out are not lost on sign-in.
 */
export async function mergeGuestWishlistAfterAuth(
  accessToken: string,
): Promise<void> {
  const localIds = Array.from(useWishlistStore.getState().items);
  if (localIds.length === 0) return;
  await Promise.all(
    localIds.map((productId) =>
      addToWishlist(productId, accessToken).catch(() => {
        // already in wishlist / transient failure — ignore
      }),
    ),
  );
}
