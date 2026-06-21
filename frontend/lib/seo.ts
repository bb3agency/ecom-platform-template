import type { Metadata } from "next";

/** Canonical storefront origin without trailing slash. */
export function getSiteUrl(): string {
  // Neutral shared dev fallback — each client's real port comes from NEXT_PUBLIC_STOREFRONT_URL
  // (env), so no client-specific port lives in core. (Matches api-base.ts's :3000 convention.)
  const url = process.env.NEXT_PUBLIC_STOREFRONT_URL ?? "http://localhost:3000";
  return url.replace(/\/$/, "");
}

export function absoluteUrl(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${getSiteUrl()}${normalized}`;
}

/** True when the storefront should not be indexed (local/staging hosts). */
export function isProductionIndexableSite(): boolean {
  if (process.env.NODE_ENV !== "production") {
    return false;
  }
  const host = new URL(getSiteUrl()).hostname;
  return host !== "localhost" && host !== "127.0.0.1";
}

/**
 * Paths disallowed in robots.txt — admin, ops, auth, account, checkout, and API proxy.
 * Prefix rules block all nested routes (e.g. `/admin` blocks `/admin/orders`).
 */
export const ROBOTS_DISALLOW_PATHS = [
  "/admin",
  "/ops",
  "/api",
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/dashboard",
  "/orders",
  "/settings",
  "/cart",
  "/checkout",
  "/search",
] as const;

/** Storefront pages safe for search indexing. */
export const PUBLIC_STATIC_PATHS = [
  "/",
  "/products",
  "/about",
  "/terms",
  "/privacy",
  "/returns",
  "/shipping",
] as const;

const NOINDEX_PREFIXES = [
  "/admin",
  "/ops",
  "/api",
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/dashboard",
  "/orders",
  "/settings",
  "/cart",
  "/checkout",
  "/search",
] as const;

export function isNoIndexPath(pathname: string): boolean {
  const path = pathname.split("?")[0] ?? pathname;
  return NOINDEX_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
}

export const NOINDEX_METADATA: Metadata = {
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
    },
  },
};
