"use client";

import { useEffect } from "react";
import { restoreAuthSessionFromCookie } from "@/lib/restore-auth-session";
import { mergeGuestCartAfterAuth } from "@/lib/post-auth-cart-merge";
import { useAuthStore } from "@/stores/auth";
import { isAccessTokenUsable } from "@/lib/jwt-utils";

/** Single storefront bootstrap — shared across Header, MainNav, MobileNav. */
let storefrontBootstrapInFlight: Promise<void> | null = null;

async function runStorefrontSessionBootstrap(): Promise<void> {
  const { accessToken, setSession, clearSession, setStorefrontSessionStatus } =
    useAuthStore.getState();

  if (accessToken && isAccessTokenUsable(accessToken)) {
    setStorefrontSessionStatus("authenticated");
    return;
  }
  // Token is absent or expired — fall through to refresh

  setStorefrontSessionStatus("checking");
  const result = await restoreAuthSessionFromCookie();
  if (!result.ok) {
    clearSession();
    return;
  }

  setSession(result.accessToken, result.user);
  await mergeGuestCartAfterAuth(result.accessToken);
}

function bootstrapStorefrontSessionOnce(): Promise<void> {
  if (!storefrontBootstrapInFlight) {
    storefrontBootstrapInFlight = runStorefrontSessionBootstrap().finally(() => {
      storefrontBootstrapInFlight = null;
    });
  }
  return storefrontBootstrapInFlight;
}

/** Reset singleton after logout so a fresh restore can run on next mount. */
export function resetStorefrontSessionBootstrap(): void {
  storefrontBootstrapInFlight = null;
}

/**
 * Storefront session bootstrap: restore access token from refresh cookie,
 * hydrate full profile, and merge any guest cart into the authenticated cart.
 * Safe to call from multiple components — only one restore runs per page load.
 */
export function useSessionBootstrap() {
  const accessToken = useAuthStore((s) => s.accessToken);
  const sessionRestoreNonce = useAuthStore((s) => s.sessionRestoreNonce);

  useEffect(() => {
    if (accessToken && isAccessTokenUsable(accessToken)) {
      useAuthStore.getState().setStorefrontSessionStatus("authenticated");
      return;
    }
    void bootstrapStorefrontSessionOnce();
  }, [accessToken, sessionRestoreNonce]);
}
