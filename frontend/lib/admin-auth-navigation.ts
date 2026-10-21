const ADMIN_AUTH_GUEST_PATHS = ["/admin/login", "/admin/setup"] as const;

/** True on sign-in / bootstrap pages that must not hard-redirect to themselves. */
export function isAdminAuthGuestPath(pathname: string): boolean {
  return ADMIN_AUTH_GUEST_PATHS.some(
    (guest) => pathname === guest || pathname.startsWith(`${guest}/`),
  );
}

/**
 * Where to go after signing in, from a `next` query value — only a same-origin
 * admin path, never the auth pages themselves (no open redirect, no loops).
 */
function hasControlChars(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    if (value.charCodeAt(i) < 0x20) return true;
  }
  return false;
}

export function safeAdminNextPath(next: string | null | undefined): string {
  if (!next) return "/admin";
  // Must be a path on this origin: one leading slash, no scheme/host, no backslashes.
  if (!next.startsWith("/admin") || next.startsWith("//") || next.includes("\\") || hasControlChars(next)) {
    return "/admin";
  }
  const pathOnly = next.split(/[?#]/)[0];
  if (pathOnly !== "/admin" && !pathOnly.startsWith("/admin/")) return "/admin";
  if (isAdminAuthGuestPath(pathOnly)) return "/admin";
  return next;
}

/**
 * Hard navigation — reliable when leaving /admin (soft router.replace can stall).
 * Carries the current admin page as `?next=` so signing back in returns there
 * (e.g. an order opened from a notification link after the session expired).
 */
export function redirectToAdminLogin(): void {
  if (typeof window === "undefined") {
    return;
  }
  const here = `${window.location.pathname}${window.location.search}`;
  const next = safeAdminNextPath(here);
  window.location.assign(next === "/admin" ? "/admin/login" : `/admin/login?next=${encodeURIComponent(next)}`);
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
