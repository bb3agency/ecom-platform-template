"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { STORAGE_PREFIX } from "@/lib/constants";

interface WishlistState {
  items: Set<string>;
  toggleItem: (productId: string, inWishlist: boolean) => void;
  setItems: (productIds: string[]) => void;
  clear: () => void;
}

export const useWishlistStore = create<WishlistState>()(
  persist(
    (set) => ({
      items: new Set<string>(),
      toggleItem: (productId, inWishlist) =>
        set((state) => {
          const next = new Set(state.items);
          if (inWishlist) {
            next.add(productId);
          } else {
            next.delete(productId);
          }
          return { items: next };
        }),
      setItems: (productIds) => set({ items: new Set(productIds) }),
      clear: () => set({ items: new Set<string>() }),
    }),
    {
      name: `${STORAGE_PREFIX}-wishlist`,
      storage: {
        getItem: (name) => {
          const str = localStorage.getItem(name);
          if (!str) return null;
          const { state } = JSON.parse(str);
          return { state: { ...state, items: new Set(state.items) } };
        },
        setItem: (name, value) => {
          const state = { ...value.state, items: Array.from(value.state.items) };
          localStorage.setItem(name, JSON.stringify({ state }));
        },
        removeItem: (name) => localStorage.removeItem(name),
      },
    },
  ),
);
