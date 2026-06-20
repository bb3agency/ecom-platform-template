import { afterEach, describe, expect, it, vi } from 'vitest';

describe('validateRuntimeEnv', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  const baseProductionEnv: Record<string, string> = {
    NODE_ENV: 'production',
    JWT_SECRET: 'jwt-secret-value-32chars-minimum-xx',
    JWT_REFRESH_SECRET: 'jwt-refresh-secret-value-32chars-min',
    OPS_DB_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef',
    DATABASE_URL: 'postgresql://u:p@127.0.0.1:5432/raghava_organics',
    REDIS_URL: 'redis://:password@127.0.0.1:6379',
    AUTH_DEV_BYPASS: 'false',
    TURNSTILE_SECRET_KEY: 'prod-turnstile-secret-key',
    STOREFRONT_URL: 'https://store.example.com',
    ADMIN_URL: 'https://admin.example.com',
  };

  it('allows boot when provider selectors are set without full dependency keys (incremental Ops save)', async () => {
    process.env = {
      ...originalEnv,
      ...baseProductionEnv,
      PAYMENT_PROVIDER: 'razorpay',
      SHIPPING_PROVIDER: 'shiprocket',
      NOTIFY_EMAIL_ENABLED: 'true',
    };

    const { validateRuntimeEnv } = await import('./app.config');
    expect(() => validateRuntimeEnv()).not.toThrow();
  });

  it('rejects AUTH_DEV_BYPASS in production-like profiles', async () => {
    process.env = {
      ...originalEnv,
      ...baseProductionEnv,
      AUTH_DEV_BYPASS: 'true',
    };

    const { validateRuntimeEnv } = await import('./app.config');
    expect(() => validateRuntimeEnv()).toThrow(/AUTH_DEV_BYPASS/);
  });

  it('still rejects unsupported PAYMENT_PROVIDER at boot', async () => {
    process.env = {
      ...originalEnv,
      ...baseProductionEnv,
      PAYMENT_PROVIDER: 'stripe',
    };

    const { validateRuntimeEnv } = await import('./app.config');
    expect(() => validateRuntimeEnv()).toThrow(/Unsupported PAYMENT_PROVIDER/);
  });

  it('rejects missing TURNSTILE_SECRET_KEY in production-like profiles', async () => {
    const envWithoutTurnstile = { ...baseProductionEnv };
    delete envWithoutTurnstile.TURNSTILE_SECRET_KEY;
    process.env = {
      ...originalEnv,
      ...envWithoutTurnstile,
      TURNSTILE_SKIP_PRODUCTION_CHECK: 'false',
    };
    delete process.env.TURNSTILE_SECRET_KEY;

    const { validateRuntimeEnv } = await import('./app.config');
    // dotenv.config() on module load may re-inject TURNSTILE_SECRET_KEY from backend/.env
    delete process.env.TURNSTILE_SECRET_KEY;
    process.env.TURNSTILE_SKIP_PRODUCTION_CHECK = 'false';
    process.env.NODE_ENV = 'production';

    expect(() => validateRuntimeEnv()).toThrow(/TURNSTILE_SECRET_KEY/);
  });

  it('allows boot without TURNSTILE_SECRET_KEY when TURNSTILE_SKIP_PRODUCTION_CHECK=true', async () => {
    const envWithoutTurnstile = { ...baseProductionEnv };
    delete envWithoutTurnstile.TURNSTILE_SECRET_KEY;
    process.env = { ...originalEnv, ...envWithoutTurnstile, TURNSTILE_SKIP_PRODUCTION_CHECK: 'true' };

    const { validateRuntimeEnv } = await import('./app.config');
    expect(() => validateRuntimeEnv()).not.toThrow();
  });

  it('rejects missing STOREFRONT_URL in production-like profiles', async () => {
    const env = { ...baseProductionEnv };
    delete env.STOREFRONT_URL;
    process.env = { ...originalEnv, ...env };
    delete process.env.STOREFRONT_URL;

    const { validateRuntimeEnv } = await import('./app.config');
    delete process.env.STOREFRONT_URL;
    expect(() => validateRuntimeEnv()).toThrow(/STOREFRONT_URL/);
  });

  it('rejects missing ADMIN_URL in production-like profiles', async () => {
    const env = { ...baseProductionEnv };
    delete env.ADMIN_URL;
    process.env = { ...originalEnv, ...env };
    delete process.env.ADMIN_URL;

    const { validateRuntimeEnv } = await import('./app.config');
    delete process.env.ADMIN_URL;
    expect(() => validateRuntimeEnv()).toThrow(/ADMIN_URL/);
  });
});
