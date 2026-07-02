const REFRESH_COOKIE_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

/** Limits cookie to API routes only (same pattern as `ops_session` → `/api/v1/ops`). */
export const REFRESH_COOKIE_PATH = '/api/v1';

function isProductionLikeCookieProfile(): boolean {
  const env = (process.env.NODE_ENV ?? 'development').trim().toLowerCase();
  return env !== 'development' && env !== 'test';
}

/**
 * Builds Set-Cookie for the customer/admin refresh token.
 * Production-like: Secure + SameSite=Lax.
 * Development/test: omits Secure so http:// localhost dev works when proxied same-origin.
 *
 * SameSite=Lax (not Strict): the refresh cookie must survive a top-level navigation that ARRIVES
 * from another site — the dominant way mobile users open the store (a link tapped in Google, an
 * in-app WhatsApp/Instagram browser, an email). With `Strict` the browser withholds the cookie on
 * that first cross-site entry, so the session-restore call fails and the user looks logged out on
 * every fresh arrival — "works on desktop (typed/bookmarked, same-site), broken on mobile". `Lax`
 * still blocks the cookie on cross-site sub-requests (fetch/XHR/POST), so it retains CSRF protection
 * for the POST-only /auth/refresh endpoint (already HttpOnly + rotated). The browser calls the API
 * same-origin via the Next.js proxy, so Lax sends it on all in-app requests too.
 */
export function buildRefreshTokenSetCookieHeader(token: string): string {
  const parts = [
    `refresh_token=${encodeURIComponent(token)}`,
    'HttpOnly',
    'SameSite=Lax',
    `Path=${REFRESH_COOKIE_PATH}`,
    `Max-Age=${REFRESH_COOKIE_MAX_AGE_SECONDS}`
  ];

  if (isProductionLikeCookieProfile()) {
    parts.push('Secure');
  }

  return parts.join('; ');
}

export function buildRefreshTokenClearCookieHeader(): string {
  const parts = [
    'refresh_token=',
    'HttpOnly',
    // Must mirror the set-cookie attributes (SameSite=Lax) or the browser won't match & clear it.
    'SameSite=Lax',
    `Path=${REFRESH_COOKIE_PATH}`,
    'Max-Age=0'
  ];

  if (isProductionLikeCookieProfile()) {
    parts.push('Secure');
  }

  return parts.join('; ');
}
