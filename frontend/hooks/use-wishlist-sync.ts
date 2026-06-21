"use client";

import { useEffect } from "react";
import { useAuthStore } from "@/stores/auth";
import { useWishlistStore } from "@/stores/wishlist";
import { getWishlist } from "@/lib/wishlist-api";
import { mergeGuestWishlistAfterAuth } from "@/lib/post-auth-wishlist-merge";
import { useStoreConfig } from "@/components/providers/StoreConfigProvider";

export function useWishlistSync() {
  const { wishlistEnabled } = useStoreConfig();
  const accessToken = useAuthStore((s) => s.accessToken);
  const setItems = useWishlistStore((s) => s.setItems);
  const clear = useWishlistStore((s) => s.clear);

  useEffect(() => {
    if (!wishlistEnabled) {
      clear();
      return;
    }

    // Guests keep their locally-saved favourites (persisted in localStorage);
    // they merge into the account on login. Do NOT clear here — clearing only
    // happens on explicit sign-out. (Logged-out ≠ wipe the guest's favourites.)
    if (!accessToken) {
      return;
    }
    const token = accessToken;

    let cancelled = false;

    async function sync() {
      try {
        // Push any guest-saved favourites into the account, then load the
        // server wishlist as the source of truth for the signed-in session.
        await mergeGuestWishlistAfterAuth(token);
        const wishlist = await getWishlist(token, { limit: 100 });
        if (!cancelled) {
          const items = Array.isArray(wishlist.items) ? wishlist.items : [];
          setItems(items.map((i) => i.product.id));
        }
      } catch {
        // Ignore failure, retain local state
      }
    }

    void sync();

    return () => {
      cancelled = true;
    };
  }, [accessToken, setItems, clear, wishlistEnabled]);
}
