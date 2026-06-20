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
