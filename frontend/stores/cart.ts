"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Cart, CartLineItem } from "@/types/cart";
import { STORAGE_PREFIX } from "@/lib/constants";

interface CartState {
  cart: Cart | null;
  items: CartLineItem[];
  setCart: (cart: Cart | null) => void;
  setItems: (items: CartLineItem[]) => void;
  clearCart: () => void;
  /** Called after login — Tier 6 wires POST /cart/merge */
  markPendingMerge: () => void;
  clearPendingMerge: () => void;
  pendingMerge: boolean;
}

export const useCartStore = create<CartState>()(
  persist(
    (set) => ({
      cart: null,
      items: [],
      pendingMerge: false,
      setCart: (cart) => set({ cart, items: cart?.items ?? [] }),
      setItems: (items) => set({ items }),
      clearCart: () => set({ cart: null, items: [], pendingMerge: false }),
      markPendingMerge: () => set({ pendingMerge: true }),
      clearPendingMerge: () => set({ pendingMerge: false }),
    }),
    {
      name: `${STORAGE_PREFIX}-cart`,
      version: 2,
      migrate: (persisted, version) => {
        if (version < 2) {
          return { cart: null, items: [], pendingMerge: false };
        }
        return persisted as CartState;
      },
    },
  ),
);
