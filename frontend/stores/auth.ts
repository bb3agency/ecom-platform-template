"use client";

import { create } from "zustand";
import { resetAuthSessionRestoreState } from "@/hooks/use-auth-session-restore";
import type { User } from "@/types/user";

export type StorefrontSessionStatus = "checking" | "authenticated" | "guest";

interface AuthState {
  accessToken: string | null;
  user: User | null;
  permissions: string[];
  /** Storefront cookie-restore lifecycle — drives mobile nav account section. */
  storefrontSessionStatus: StorefrontSessionStatus;
  /** Bumped on logoutLocalSession so restore hooks re-run even when tokens were already null. */
  sessionRestoreNonce: number;
  setSession: (accessToken: string, user: User) => void;
  setAccessToken: (accessToken: string) => void;
  setStorefrontSessionStatus: (status: StorefrontSessionStatus) => void;
  clearSession: () => void;
  logoutLocalSession: () => void;
  hasPermission: (permission: string) => boolean;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  accessToken: null,
  user: null,
  permissions: [],
  storefrontSessionStatus: "checking",
  sessionRestoreNonce: 0,
  setSession: (accessToken, user) =>
    set({
      accessToken,
      user,
      permissions: user.permissions ?? [],
      storefrontSessionStatus: "authenticated",
    }),
  setAccessToken: (accessToken) => set({ accessToken }),
  setStorefrontSessionStatus: (status) => set({ storefrontSessionStatus: status }),
  /** Clears in-memory session only. Does not reset cookie-restore guards (see `logoutLocalSession`). */
  clearSession: () =>
    set({
      accessToken: null,
      user: null,
      permissions: [],
      storefrontSessionStatus: "guest",
    }),
  /** Logout / sign-in-again: allow a fresh cookie restore attempt. */
  logoutLocalSession: () => {
    resetAuthSessionRestoreState();
    set((state) => ({
      accessToken: null,
      user: null,
      permissions: [],
      storefrontSessionStatus: "guest",
      sessionRestoreNonce: state.sessionRestoreNonce + 1,
    }));
  },
  hasPermission: (permission) => {
    const perms = get().permissions;
    return perms.includes(permission) || perms.includes("*");
  },
}));
