/** Public Turnstile site key (pairs with backend `TURNSTILE_SECRET_KEY`). */
export function getTurnstileSiteKey(): string | null {
  const key = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim();
  return key || null;
}

function isDevTurnstileEnforced(): boolean {
  return (
    process.env.NEXT_PUBLIC_TURNSTILE_ENFORCE_IN_DEV === "true" ||
    process.env.NEXT_PUBLIC_TURNSTILE_ENFORCE_IN_DEV === "1"
  );
}

/**
 * Whether the storefront should render Turnstile and require a token before submit.
 * - Production build: on when site key is set.
 * - `next dev`: off unless `NEXT_PUBLIC_TURNSTILE_ENFORCE_IN_DEV=true` (mirrors backend).
 */
export function isTurnstileConfigured(): boolean {
  const key = getTurnstileSiteKey();
  if (!key) {
    return false;
  }
  if (process.env.NODE_ENV === "development" && !isDevTurnstileEnforced()) {
    return false;
  }
  return true;
}
