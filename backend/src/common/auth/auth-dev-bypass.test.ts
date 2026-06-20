import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getAuthDevOtp,
  isAuthDevBypassEnabled,
  validateAuthDevBypassEnv,
  withDevOtpField
} from './auth-dev-bypass';

describe('auth-dev-bypass', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('is disabled in production even when AUTH_DEV_BYPASS=true', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('AUTH_DEV_BYPASS', 'true');
    expect(isAuthDevBypassEnabled()).toBe(false);
    expect(() => validateAuthDevBypassEnv()).toThrow(/AUTH_DEV_BYPASS/);
    expect(() => getAuthDevOtp()).toThrow(/only available when AUTH_DEV_BYPASS/);
  });

  it('is enabled only in development with AUTH_DEV_BYPASS=true', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('AUTH_DEV_BYPASS', 'true');
    expect(isAuthDevBypassEnabled()).toBe(true);
    expect(getAuthDevOtp()).toBe('000000');
  });

  it('uses AUTH_DEV_OTP when configured', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('AUTH_DEV_BYPASS', 'true');
    vi.stubEnv('AUTH_DEV_OTP', '424242');
    expect(getAuthDevOtp()).toBe('424242');
  });

  it('withDevOtpField omits devOtp in production-like runtime', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('AUTH_DEV_BYPASS', 'true');
    const payload = withDevOtpField({ message: 'ok' }, '000000');
    expect(payload).toEqual({ message: 'ok' });
    expect('devOtp' in payload).toBe(false);
  });

  it('withDevOtpField attaches devOtp only when bypass is active', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('AUTH_DEV_BYPASS', 'true');
    const payload = withDevOtpField({ message: 'ok' }, '000000');
    expect(payload).toEqual({ message: 'ok', devOtp: '000000' });
  });
});
