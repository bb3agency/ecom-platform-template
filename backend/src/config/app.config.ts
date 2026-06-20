import dotenv from 'dotenv';
import { validateAuthDevBypassEnv } from '@common/auth/auth-dev-bypass';

dotenv.config();

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

const requiredEnvVars = [
  'DATABASE_URL',
  'REDIS_URL',
  'OPS_DB_ENCRYPTION_KEY'
] as const;

export function validateBootstrapEnv(): void {
  requiredEnvVars.forEach((envVar) => {
    requireEnv(envVar);
  });
}

function isEnabled(value: string | undefined): boolean {
  return (value ?? '').trim().toLowerCase() === 'true';
}

const DEVELOPMENT_LIKE_NODE_ENVS = new Set(['development', 'test']);

type RuntimeProfile = 'development-like' | 'production-like';

function getNormalizedNodeEnv(): string {
  return (process.env.NODE_ENV ?? 'development').trim().toLowerCase();
}

function resolveRuntimeProfile(nodeEnv: string = getNormalizedNodeEnv()): RuntimeProfile {
  return DEVELOPMENT_LIKE_NODE_ENVS.has(nodeEnv) ? 'development-like' : 'production-like';
}

function isProductionLikeProfile(nodeEnv: string = getNormalizedNodeEnv()): boolean {
  return resolveRuntimeProfile(nodeEnv) === 'production-like';
}

function isPlaceholderValue(value: string | undefined): boolean {
  const normalized = (value ?? '').trim().toLowerCase();
  return (
    normalized.startsWith('replace_with_') ||
    normalized.startsWith('change_me') ||
    normalized.startsWith('<')
  );
}

function envVarPresent(name: string): boolean {
  return Boolean((process.env[name] ?? '').trim());
}

function assertEnvNotPlaceholder(name: string): void {
  const value = requireEnv(name);
  if (isPlaceholderValue(value)) {
    throw new Error(`Invalid ${name}: placeholder values are not allowed in production-like profiles`);
  }
}

/** Production safety for a key that is already set — never requires missing overlay keys at boot. */
function assertEnvNotPlaceholderIfPresent(name: string): void {
  if (!envVarPresent(name)) {
    return;
  }
  const value = process.env[name] ?? '';
  if (isPlaceholderValue(value)) {
    throw new Error(`Invalid ${name}: placeholder values are not allowed in production-like profiles`);
  }
}

function validateSecureFlowEnv(): void {
  const nodeEnv = getNormalizedNodeEnv();
  const isStrictProfile = isProductionLikeProfile(nodeEnv);
  const redisUrl = process.env.REDIS_URL?.trim();
  if (!redisUrl) {
    return;
  }
  let parsed: URL;
  try {
    parsed = new URL(redisUrl);
  } catch {
    throw new Error('Invalid REDIS_URL format');
  }
  if (!['redis:', 'rediss:'].includes(parsed.protocol)) {
    throw new Error('REDIS_URL must use redis:// or rediss:// protocol');
  }
  if (isStrictProfile && !parsed.password) {
    throw new Error('REDIS_URL must include password in production-like profiles');
  }
}

function validateConditionalEnv(): void {
  const isStrictProfile = isProductionLikeProfile();
  const paymentProviderRaw = (process.env.PAYMENT_PROVIDER ?? '').trim().toLowerCase();
  // SHIPPING_PROVIDER is not validated here — it is not used for routing.
  // Shipping provider is auto-detected from credentials by resolveDualShippingRuntime().

  // Provider dependency sets are enforced by GET /health/ready (findMissingStrictOpsConfigKeys).
  // Boot must tolerate incremental Ops DB saves — do not require full provider chains here.
  if (paymentProviderRaw && !['razorpay', 'cod', 'noop'].includes(paymentProviderRaw)) {
    throw new Error(`Unsupported PAYMENT_PROVIDER: ${paymentProviderRaw}. Allowed: razorpay, cod, noop`);
  }

  const smsProviderRaw = (process.env.SMS_PROVIDER ?? '').trim().toLowerCase();
  if (smsProviderRaw && !['msg91', 'fast2sms', 'noop'].includes(smsProviderRaw)) {
    throw new Error(`Unsupported SMS_PROVIDER: ${smsProviderRaw}. Allowed: msg91, fast2sms, noop`);
  }

  if (isEnabled(process.env.OTEL_TRACING_ENABLED)) {
    requireEnv('OTEL_EXPORTER_OTLP_ENDPOINT');
  }

  if (isStrictProfile) {
    requireEnv('OPS_DB_ENCRYPTION_KEY');
  }

  const mediaProvider = (process.env.MEDIA_STORAGE_PROVIDER ?? '').trim().toLowerCase();
  if (
    mediaProvider &&
    mediaProvider !== 'local' &&
    mediaProvider !== 'r2' &&
    mediaProvider !== 'cloudflare-r2'
  ) {
    throw new Error(
      `Unsupported MEDIA_STORAGE_PROVIDER: ${mediaProvider}. Allowed: local, r2, cloudflare-r2`
    );
  }
}

function validateProductionProviderSafetyEnv(): void {
  const nodeEnv = getNormalizedNodeEnv();
  const isStrictProfile = isProductionLikeProfile(nodeEnv);
  if (!isStrictProfile) {
    return;
  }

  const paymentProviderRaw = (process.env.PAYMENT_PROVIDER ?? '').trim().toLowerCase();
  // SHIPPING_PROVIDER not validated — routing is credential-based (resolveDualShippingRuntime)

  if (paymentProviderRaw === 'noop') {
    throw new Error(
      `Invalid PAYMENT_PROVIDER=noop when NODE_ENV=${nodeEnv}. 'noop' is allowed only in development-like profiles (development/test).`
    );
  }

  if ((process.env.AUTH_DEV_BYPASS ?? '').trim().toLowerCase() === 'true') {
    throw new Error(
      `AUTH_DEV_BYPASS cannot be enabled when NODE_ENV=${nodeEnv}. Remove it from production environment configuration.`
    );
  }

  if (paymentProviderRaw && !['razorpay', 'cod'].includes(paymentProviderRaw)) {
    throw new Error(`Unsupported PAYMENT_PROVIDER in production-like profile: ${paymentProviderRaw}`);
  }

  const mediaProvider = (process.env.MEDIA_STORAGE_PROVIDER ?? '').trim().toLowerCase();
  if (mediaProvider === 'local') {
    throw new Error(
      `MEDIA_STORAGE_PROVIDER=local is not allowed when NODE_ENV=${nodeEnv}. Configure r2 via Ops UI before go-live.`
    );
  }

  assertEnvNotPlaceholder('JWT_SECRET');
  assertEnvNotPlaceholder('JWT_REFRESH_SECRET');
  assertEnvNotPlaceholder('OPS_DB_ENCRYPTION_KEY');

  if (paymentProviderRaw === 'razorpay') {
    assertEnvNotPlaceholderIfPresent('RAZORPAY_KEY_ID');
    assertEnvNotPlaceholderIfPresent('RAZORPAY_KEY_SECRET');
    assertEnvNotPlaceholderIfPresent('RAZORPAY_WEBHOOK_SECRET');
    assertEnvNotPlaceholderIfPresent('RAZORPAY_WEBHOOK_SECRET_OLD');
  }

  // Placeholder safety: check against whichever shipping credentials are present
  if ((process.env.DELHIVERY_API_KEY ?? '').trim()) {
    assertEnvNotPlaceholderIfPresent('DELHIVERY_API_KEY');
    assertEnvNotPlaceholderIfPresent('DELHIVERY_WEBHOOK_TOKEN');
  }
  if ((process.env.SHIPROCKET_EMAIL ?? '').trim() || (process.env.SHIPROCKET_PASSWORD ?? '').trim()) {
    assertEnvNotPlaceholderIfPresent('SHIPROCKET_EMAIL');
    assertEnvNotPlaceholderIfPresent('SHIPROCKET_PASSWORD');
    assertEnvNotPlaceholderIfPresent('SHIPROCKET_WEBHOOK_TOKEN');
  }

  if (isStrictProfile) {
    // STOREFRONT_URL is used in password-reset emails — a missing value would send
    // localhost links to users. Fail fast at boot rather than silently sending bad emails.
    if (!process.env.STOREFRONT_URL?.trim()) {
      throw new Error(
        'STOREFRONT_URL is required in production-like profiles. ' +
        'It is embedded in password-reset emails — missing value results in localhost links being sent to customers.'
      );
    }
    assertEnvNotPlaceholder('STOREFRONT_URL');
    if (!process.env.ADMIN_URL?.trim()) {
      throw new Error(
        'ADMIN_URL is required in production-like profiles. ' +
        'It is used for CORS allowed origins alongside STOREFRONT_URL.'
      );
    }
    assertEnvNotPlaceholder('ADMIN_URL');
  }

  if (isEnabled(process.env.NOTIFY_EMAIL_ENABLED)) {
    assertEnvNotPlaceholderIfPresent('RESEND_API_KEY');
    assertEnvNotPlaceholderIfPresent('RESEND_FROM');
  }

  if (isEnabled(process.env.NOTIFY_SMS_ENABLED)) {
    assertEnvNotPlaceholderIfPresent('MSG91_AUTH_KEY');
    assertEnvNotPlaceholderIfPresent('MSG91_SENDER_ID');
    assertEnvNotPlaceholderIfPresent('FAST2SMS_API_KEY');
  }

  if (isEnabled(process.env.NOTIFY_WHATSAPP_ENABLED)) {
    assertEnvNotPlaceholderIfPresent('META_WHATSAPP_ACCESS_TOKEN');
    assertEnvNotPlaceholderIfPresent('META_WHATSAPP_PHONE_NUMBER_ID');
    assertEnvNotPlaceholderIfPresent('META_WHATSAPP_WEBHOOK_VERIFY_TOKEN');
    assertEnvNotPlaceholderIfPresent('META_WHATSAPP_APP_SECRET');
  }

  // Turnstile must be configured in production — if it is absent, all auth endpoints
  // skip bot-challenge verification, which is a security gap.
  // Set TURNSTILE_SECRET_KEY to a real Cloudflare secret. To explicitly opt out
  // (not recommended), set TURNSTILE_SKIP_PRODUCTION_CHECK=true.
  if (!envVarPresent('TURNSTILE_SECRET_KEY') && !isEnabled(process.env.TURNSTILE_SKIP_PRODUCTION_CHECK)) {
    throw new Error(
      'TURNSTILE_SECRET_KEY is required in production-like profiles. ' +
      'Bot challenge verification will be skipped without it. ' +
      'Set TURNSTILE_SKIP_PRODUCTION_CHECK=true only if you are intentionally running without Turnstile.'
    );
  }
  assertEnvNotPlaceholderIfPresent('TURNSTILE_SECRET_KEY');
  // Product media (R2) credentials are DB-overlay via Ops config — enforced by /health/ready.
}

export function validateRuntimeEnv(): void {
  requireEnv('JWT_SECRET');
  requireEnv('JWT_REFRESH_SECRET');
  validateAuthDevBypassEnv();
  validateSecureFlowEnv();
  validateConditionalEnv();
  validateProductionProviderSafetyEnv();
}

export function getAppConfig() {
  return {
    env: getNormalizedNodeEnv(),
    runtimeProfile: resolveRuntimeProfile(),
    port: Number(process.env.PORT ?? 3000),
    host: process.env.HOST ?? '0.0.0.0',
    apiPrefix: '/api/v1'
  };
}

export const appConfig = getAppConfig();

