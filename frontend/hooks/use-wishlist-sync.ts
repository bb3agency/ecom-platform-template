"use client";

import { useEffect } from "react";
import { useAuthStore } from "@/stores/auth";
import { useWishlistStore } from "@/stores/wishlist";
import { getWishlist } from "@/lib/wishlist-api";
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

    let cancelled = false;

    async function sync() {
      if (!accessToken) {
        clear();
        return;
      }
      try {
        const wishlist = await getWishlist(accessToken, { limit: 100 });
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
