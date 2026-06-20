const ADMIN_AUTH_GUEST_PATHS = ["/admin/login", "/admin/setup"] as const;

/** True on sign-in / bootstrap pages that must not hard-redirect to themselves. */
export function isAdminAuthGuestPath(pathname: string): boolean {
  return ADMIN_AUTH_GUEST_PATHS.some(
    (guest) => pathname === guest || pathname.startsWith(`${guest}/`),
  );
}

/** Hard navigation — reliable when leaving /admin (soft router.replace can stall). */
export function redirectToAdminLogin(): void {
  if (typeof window === "undefined") {
    return;
  }
  window.location.assign("/admin/login");
}

/** Redirect to sign-in unless already on an admin guest auth route (avoids reload loops). */
export function redirectToAdminLoginIfNeeded(): void {
  if (typeof window === "undefined") {
    return;
  }
  if (isAdminAuthGuestPath(window.location.pathname)) {
    return;
  }
  redirectToAdminLogin();
}

export function redirectToAdminHome(): void {
  if (typeof window === "undefined") {
    return;
  }
  window.location.assign("/admin");
}
