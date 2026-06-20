import { afterEach, describe, expect, it } from 'vitest';
import {
  buildCartSessionSetCookieHeader,
  parseCartSessionToken
} from './cart-cookies';

describe('cart session cookie', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  it('uses SameSite=Lax so the guest cart survives navigations', () => {
    process.env.NODE_ENV = 'production';
    const header = buildCartSessionSetCookieHeader('session-token');
    expect(header).toContain('cart_session=session-token');
    expect(header).toContain('HttpOnly');
    expect(header).toContain('SameSite=Lax');
    expect(header).not.toContain('SameSite=Strict');
    expect(header).toContain('Path=/');
  });

  it('includes Secure in production-like profiles', () => {
    process.env.NODE_ENV = 'production';
    expect(buildCartSessionSetCookieHeader('t')).toContain('Secure');
  });

  it('omits Secure in development for local http dev', () => {
    process.env.NODE_ENV = 'development';
    expect(buildCartSessionSetCookieHeader('t')).not.toContain('Secure');
  });

  it('round-trips the token through a Cookie header', () => {
    expect(parseCartSessionToken('cart_session=abc-123; other=1')).toBe('abc-123');
    expect(parseCartSessionToken('other=1')).toBeUndefined();
    expect(parseCartSessionToken(undefined)).toBeUndefined();
  });

  it('url-decodes the token value', () => {
    const header = buildCartSessionSetCookieHeader('a b/c');
    const value = header.split(';')[0]!.replace('cart_session=', '');
    expect(parseCartSessionToken(`cart_session=${value}`)).toBe('a b/c');
  });
});
