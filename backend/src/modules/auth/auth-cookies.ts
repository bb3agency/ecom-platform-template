const REFRESH_COOKIE_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

/** Limits cookie to API routes only (same pattern as `ops_session` → `/api/v1/ops`). */
export const REFRESH_COOKIE_PATH = '/api/v1';

function isProductionLikeCookieProfile(): boolean {
  const env = (process.env.NODE_ENV ?? 'development').trim().toLowerCase();
  return env !== 'development' && env !== 'test';
}

/**
 * Builds Set-Cookie for the customer/admin refresh token.
 * Production-like: Secure + SameSite=Strict (TRD C-20).
 * Development/test: omits Secure so http:// localhost dev works when proxied same-origin.
 */
export function buildRefreshTokenSetCookieHeader(token: string): string {
  const parts = [
    `refresh_token=${encodeURIComponent(token)}`,
    'HttpOnly',
    'SameSite=Strict',
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
    'SameSite=Strict',
    `Path=${REFRESH_COOKIE_PATH}`,
    'Max-Age=0'
  ];

  if (isProductionLikeCookieProfile()) {
    parts.push('Secure');
  }

  return parts.join('; ');
}
