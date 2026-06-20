import { afterEach, describe, expect, it } from 'vitest';
import {
  buildRefreshTokenClearCookieHeader,
  buildRefreshTokenSetCookieHeader,
  REFRESH_COOKIE_PATH
} from './auth-cookies';

describe('auth refresh cookies', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  it('omits Secure in development for local http dev', () => {
    process.env.NODE_ENV = 'development';
    const header = buildRefreshTokenSetCookieHeader('token-value');
    expect(header).toContain('HttpOnly');
    expect(header).toContain('SameSite=Strict');
    expect(header).toContain(`Path=${REFRESH_COOKIE_PATH}`);
    expect(header).not.toContain('Secure');
  });

  it('includes Secure in production-like profiles', () => {
    process.env.NODE_ENV = 'production';
    const header = buildRefreshTokenSetCookieHeader('token-value');
    expect(header).toContain('Secure');
  });

  it('clears cookie with Max-Age=0', () => {
    process.env.NODE_ENV = 'test';
    const header = buildRefreshTokenClearCookieHeader();
    expect(header).toContain('refresh_token=');
    expect(header).toContain('Max-Age=0');
  });
});
