import { afterEach, describe, expect, it, vi } from 'vitest';
import { isTurnstileVerificationEnabled } from './auth-turnstile';

describe('auth-turnstile', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('is disabled in development even when TURNSTILE_SECRET_KEY is set', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('TURNSTILE_SECRET_KEY', 'turnstile-secret');
    expect(isTurnstileVerificationEnabled()).toBe(false);
  });

  it('can be enabled in development with TURNSTILE_ENFORCE_IN_DEV=true', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('TURNSTILE_SECRET_KEY', 'turnstile-secret');
    vi.stubEnv('TURNSTILE_ENFORCE_IN_DEV', 'true');
    expect(isTurnstileVerificationEnabled()).toBe(true);
  });

  it('is enabled in production when secret is configured', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('TURNSTILE_SECRET_KEY', 'turnstile-secret');
    expect(isTurnstileVerificationEnabled()).toBe(true);
  });

  it('is disabled when secret is empty', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('TURNSTILE_SECRET_KEY', '');
    expect(isTurnstileVerificationEnabled()).toBe(false);
  });
});
