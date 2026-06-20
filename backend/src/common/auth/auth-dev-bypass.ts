/**
 * Development/test-only OTP shortcuts.
 *
 * Production guarantee: `isAuthDevBypassEnabled()` is ALWAYS false when
 * NODE_ENV is not `development` or `test`, regardless of AUTH_DEV_BYPASS.
 * Startup also fails if AUTH_DEV_BYPASS=true in a production-like profile.
 */

const DEVELOPMENT_LIKE_NODE_ENVS = new Set(['development', 'test']);

function getNormalizedNodeEnv(): string {
  return (process.env.NODE_ENV ?? 'development').trim().toLowerCase();
}

export function isDevelopmentLikeNodeEnv(): boolean {
  return DEVELOPMENT_LIKE_NODE_ENVS.has(getNormalizedNodeEnv());
}

export function isProductionLikeNodeEnv(): boolean {
  return !isDevelopmentLikeNodeEnv();
}

/**
 * True only when NODE_ENV is development/test AND AUTH_DEV_BYPASS=true.
 * In production/staging this is always false — production code paths must not depend on it.
 */
export function isAuthDevBypassEnabled(): boolean {
  if (!isDevelopmentLikeNodeEnv()) {
    return false;
  }
  return (process.env.AUTH_DEV_BYPASS ?? '').trim().toLowerCase() === 'true';
}

/** Fixed 6-digit OTP for local dev (default 000000). Throws outside dev bypass. */
export function getAuthDevOtp(): string {
  if (!isAuthDevBypassEnabled()) {
    throw new Error('getAuthDevOtp() is only available when AUTH_DEV_BYPASS is enabled in development/test');
  }
  const configured = (process.env.AUTH_DEV_OTP ?? '').trim();
  if (/^[0-9]{6}$/.test(configured)) {
    return configured;
  }
  return '000000';
}

/** Never attach devOtp to API payloads in production-like runtime. */
export function withDevOtpField<T extends Record<string, unknown>>(
  payload: T,
  devOtp?: string
): T & { devOtp?: string } {
  if (!isAuthDevBypassEnabled() || !devOtp) {
    return payload;
  }
  return { ...payload, devOtp };
}

/** Fail fast if production is misconfigured with dev bypass flags. */
export function validateAuthDevBypassEnv(): void {
  if (!isProductionLikeNodeEnv()) {
    return;
  }
  const bypass = (process.env.AUTH_DEV_BYPASS ?? '').trim().toLowerCase();
  if (bypass === 'true') {
    throw new Error(
      'AUTH_DEV_BYPASS cannot be enabled when NODE_ENV is production-like. Remove it from production .env.'
    );
  }
}
