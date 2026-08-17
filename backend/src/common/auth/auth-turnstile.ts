import { isDevelopmentLikeNodeEnv } from './auth-dev-bypass';

/**
 * Turnstile is enforced only when a secret is configured and the runtime is
 * production-like. Development/test skip verification unless explicitly opted in.
 */
export function isTurnstileVerificationEnabled(): boolean {
  const secret = process.env.TURNSTILE_SECRET_KEY?.trim();
  if (!secret) {
    return false;
  }
  if (isDevelopmentLikeNodeEnv()) {
    return (process.env.TURNSTILE_ENFORCE_IN_DEV ?? '').trim().toLowerCase() === 'true';
  }
  return true;
}

/**
 * The PUBLIC Turnstile site key, published to the storefront via `GET /store/config`.
 *
 * Why the server serves this at all: the site key is public by design (it ships in
 * the widget markup), and letting the browser read it from the SAME source that
 * decides whether a challenge is required makes the two halves impossible to
 * disagree about. When the storefront decided independently from a build-time
 * `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, a deploy missing that variable rendered no
 * widget, sent no token, and every login/register/OTP/forgot-password request was
 * rejected with "Challenge token is required" — a total auth outage that neither
 * side could detect (raghava-organics, found 2026-08-15).
 *
 * Returns null when unset; the storefront then falls back to its own env var, so
 * deployments configured the old way keep working.
 */
export function getTurnstileSiteKey(): string | null {
  const siteKey = process.env.TURNSTILE_SITE_KEY?.trim();
  return siteKey ? siteKey : null;
}
