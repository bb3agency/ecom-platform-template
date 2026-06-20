"use client";

import { useMemo } from "react";
import { createAuthenticatedApiClient } from "@/lib/authenticated-api";
import { redirectToAdminLogin } from "@/lib/admin-auth-navigation";
import { useAuthStore } from "@/stores/auth";

/** Stable authenticated client — store reads use getState to keep hook count fixed (HMR-safe). */
export function useAuthenticatedApi() {
  return useMemo(
    () =>
      createAuthenticatedApiClient({
        getAccessToken: () => useAuthStore.getState().accessToken,
        setAccessToken: (token) => useAuthStore.getState().setAccessToken(token),
        onAuthFailure: () => {
          const path = window.location.pathname;
          if (path.startsWith("/admin")) {
            useAuthStore.getState().logoutLocalSession();
            redirectToAdminLogin();
          } else {
            useAuthStore.getState().clearSession();
            window.location.assign("/login");
          }
        },
      }),
    [],
  );
}
