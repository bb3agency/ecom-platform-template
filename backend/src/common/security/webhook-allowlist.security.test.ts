import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assertWebhookAllowlistConfigured,
  isIpAllowlisted,
  isProductionWithoutAllowlist,
  parseWebhookIpAllowlist,
  resolveSecurityClientIp
} from './webhook-allowlist';

describe('webhook-allowlist', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('treats empty env as allow-all', () => {
    expect(parseWebhookIpAllowlist(undefined)).toEqual([]);
    expect(isIpAllowlisted('192.168.1.1', [])).toBe(true);
  });

  it('treats missing allowlist as invalid only when enforce is requested', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(isProductionWithoutAllowlist([])).toBe(true);
    expect(() => assertWebhookAllowlistConfigured('Razorpay', [])).not.toThrow();
    expect(() => assertWebhookAllowlistConfigured('Razorpay', [], { enforce: true })).toThrow(
      /allowlist is EMPTY/i
    );
  });

  it('does not require allowlist in development and test runtime', () => {
    vi.stubEnv('NODE_ENV', 'development');
    expect(isProductionWithoutAllowlist([])).toBe(false);

    vi.stubEnv('NODE_ENV', 'test');
    expect(isProductionWithoutAllowlist([])).toBe(false);
  });

  it('matches exact IPv4', () => {
    const rules = parseWebhookIpAllowlist('203.0.113.10');
    expect(isIpAllowlisted('203.0.113.10', rules)).toBe(true);
    expect(isIpAllowlisted('203.0.113.11', rules)).toBe(false);
  });

  it('matches IPv4 CIDR', () => {
    const rules = parseWebhookIpAllowlist('10.0.0.0/8');
    expect(isIpAllowlisted('10.1.2.3', rules)).toBe(true);
    expect(isIpAllowlisted('11.0.0.1', rules)).toBe(false);
  });

  it('parses comma-separated rules', () => {
    const rules = parseWebhookIpAllowlist('127.0.0.1,192.168.0.0/16');
    expect(isIpAllowlisted('127.0.0.1', rules)).toBe(true);
    expect(isIpAllowlisted('192.168.255.255', rules)).toBe(true);
  });

  it('matches exact IPv6 and CIDR IPv6', () => {
    const rules = parseWebhookIpAllowlist('2001:db8::1,2001:db8:abcd::/48');
    expect(isIpAllowlisted('2001:db8::1', rules)).toBe(true);
    expect(isIpAllowlisted('2001:db8:abcd:1::9', rules)).toBe(true);
    expect(isIpAllowlisted('2001:db9::1', rules)).toBe(false);
  });

  it('rejects invalid CIDR entries with clear error', () => {
    expect(() => parseWebhookIpAllowlist('10.0.0.0/99')).toThrow(/Invalid webhook allowlist entry/);
    expect(() => parseWebhookIpAllowlist('not-an-ip')).toThrow(/Invalid webhook allowlist entry/);
  });

  it('uses derived ip only when direct remote is trusted proxy', () => {
    const trustedProxyRules = parseWebhookIpAllowlist('10.0.0.0/8');
    expect(resolveSecurityClientIp({
      directRemoteIp: '10.1.1.1',
      derivedRequestIp: '203.0.113.10',
      trustedProxyRules
    })).toBe('203.0.113.10');

    expect(resolveSecurityClientIp({
      directRemoteIp: '198.51.100.10',
      derivedRequestIp: '203.0.113.10',
      trustedProxyRules
    })).toBe('198.51.100.10');
  });
});
