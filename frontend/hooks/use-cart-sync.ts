"use client";

import { useEffect } from "react";
import { getCart } from "@/lib/cart-api";
import { useAuthStore } from "@/stores/auth";
import { useCartStore } from "@/stores/cart";

export function useCartSync(options?: { resyncKey?: unknown }) {
  const accessToken = useAuthStore((s) => s.accessToken);
  const setCart = useCartStore((s) => s.setCart);
  const resyncKey = options?.resyncKey;

  useEffect(() => {
    let cancelled = false;

    async function sync() {
      try {
        const cart = await getCart(accessToken);
        if (!cancelled) {
          setCart(cart);
        }
      } catch {
        // Keep last known cart state if sync fails.
      }
    }

    void sync();

    return () => {
      cancelled = true;
    };
  }, [accessToken, setCart, resyncKey]);
}
