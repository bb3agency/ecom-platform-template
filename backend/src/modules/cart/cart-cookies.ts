const CART_COOKIE_NAME = 'cart_session';
const CART_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

function isProductionLikeCookieProfile(): boolean {
  const env = (process.env.NODE_ENV ?? 'development').trim().toLowerCase();
  return env !== 'development' && env !== 'test';
}

/**
 * Reads the guest `cart_session` token from a raw Cookie header.
 * Returns undefined when the cookie is absent.
 */
export function parseCartSessionToken(cookieHeader?: string): string | undefined {
  if (!cookieHeader) {
    return undefined;
  }

  const tokenPart = cookieHeader
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${CART_COOKIE_NAME}=`));

  if (!tokenPart) {
    return undefined;
  }

  return decodeURIComponent(tokenPart.replace(`${CART_COOKIE_NAME}=`, ''));
}

/**
 * Builds Set-Cookie for the guest cart session.
 *
 * `SameSite=Lax` (not Strict): a guest cart must survive top-level navigations —
 * arriving via an external link, returning from a payment/redirect, and the
 * login→checkout round-trip. Strict drops the cookie on those cross-site
 * navigations, which silently orphans the guest cart and makes the post-login
 * merge find nothing. Lax still sends the cookie on same-origin XHR.
 *
 * Production-like: adds Secure. Development/test: omits Secure so http://
 * localhost dev works when proxied same-origin (mirrors auth-cookies.ts).
 */
export function buildCartSessionSetCookieHeader(token: string): string {
  const parts = [
    `${CART_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${CART_COOKIE_MAX_AGE_SECONDS}`
  ];

  if (isProductionLikeCookieProfile()) {
    parts.push('Secure');
  }

  return parts.join('; ');
}
