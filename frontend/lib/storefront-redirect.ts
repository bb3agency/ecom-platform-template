/** Where customers land after sign-in when no (safe) `redirect` param is given. */
export const STOREFRONT_DEFAULT_REDIRECT = "/dashboard";

/** Placeholder base for parsing only — never navigated to. */
const RESOLUTION_ORIGIN = "https://storefront.invalid";

const STOREFRONT_AUTH_PATHS = ["/login", "/register", "/forgot-password"] as const;

/** Rejects control characters (tab, newline, NUL …) and any whitespace. */
function hasUnsafeChars(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return /\s/.test(value);
}

function isAuthPath(pathname: string): boolean {
  return STOREFRONT_AUTH_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
}

/**
 * Sanitise a post-login `redirect` query value into a same-origin path.
 *
 * `startsWith("/") && !startsWith("//")` is NOT enough: `/\evil.com` and
 * `/<TAB>/evil.com` pass that check, and the WHATWG URL parser turns them into
 * `https://evil.com/` (backslash is a path separator for http(s), tabs/newlines
 * are stripped). The App Router then performs a full cross-origin navigation —
 * an open redirect straight after the customer signs in.
 *
 * Resolution runs against a fixed placeholder origin (so it is identical on
 * the server and in the browser — no hydration mismatch); any value that
 * escapes that origin is rejected. Returns pathname + search + hash, or the
 * fallback.
 */
export function safeStorefrontRedirect(
  raw: string | null | undefined,
  fallback: string = STOREFRONT_DEFAULT_REDIRECT,
): string {
  if (!raw) return fallback;
  if (!raw.startsWith("/") || raw.startsWith("//")) return fallback;
  if (raw.includes("\\") || hasUnsafeChars(raw)) return fallback;

  let resolved: URL;
  let base: URL;
  try {
    base = new URL(RESOLUTION_ORIGIN);
    resolved = new URL(raw, base);
  } catch {
    return fallback;
  }
  if (resolved.origin !== base.origin) return fallback;
  // Dot-segment normalisation can produce a protocol-relative path:
  // `/.//evil.com` → pathname `//evil.com`, which the browser treats as a host.
  if (resolved.pathname.startsWith("//")) return fallback;
  if (isAuthPath(resolved.pathname)) return fallback;

  return `${resolved.pathname}${resolved.search}${resolved.hash}`;
}
