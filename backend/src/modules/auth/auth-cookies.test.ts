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
    // SameSite=Lax (not Strict) so the refresh cookie survives a top-level navigation that arrives
    // from another site (mobile users opening the store from Google / an in-app browser / email).
    expect(header).toContain('SameSite=Lax');
    expect(header).not.toContain('SameSite=Strict');
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
    // Clear header must mirror the set attributes so the browser matches and removes the cookie.
    expect(header).toContain('SameSite=Lax');
  });
});
