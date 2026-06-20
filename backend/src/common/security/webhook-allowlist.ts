import * as ipaddr from 'ipaddr.js';

function isProductionLikeRuntime(): boolean {
  const env = (process.env.NODE_ENV ?? 'development').trim().toLowerCase();
  return env !== 'development' && env !== 'test';
}

type ParsedAllowRule =
  | { kind: 'cidr'; cidr: [ipaddr.IPv4 | ipaddr.IPv6, number] }
  | { kind: 'exact'; addr: ipaddr.IPv4 | ipaddr.IPv6 };

export function parseWebhookIpAllowlist(envValue: string | undefined): ParsedAllowRule[] {
  const raw = envValue?.trim();
  if (!raw) {
    return [];
  }
  const rules: ParsedAllowRule[] = [];
  for (const token of raw.split(/[\s,]+/).map((t) => t.trim()).filter(Boolean)) {
    try {
      if (token.includes('/')) {
        const cidr = ipaddr.parseCIDR(token);
        rules.push({
          kind: 'cidr',
          cidr
        });
      } else {
        rules.push({ kind: 'exact', addr: ipaddr.parse(token) });
      }
    } catch {
      throw new Error(`Invalid webhook allowlist entry: ${token}`);
    }
  }
  return rules;
}

/**
 * Returns true when running in production-like runtime
 * and no webhook IP allowlist rules are configured.
 */
export function isProductionWithoutAllowlist(rules: ParsedAllowRule[]): boolean {
  return isProductionLikeRuntime() && rules.length === 0;
}

/**
 * Optional strict check (tests / explicit tooling). Production API boot must NOT call with
 * enforce:true — allowlists are Ops-managed and validated via /health/ready instead.
 */
export function assertWebhookAllowlistConfigured(
  providerName: string,
  rules: ParsedAllowRule[],
  options?: { enforce?: boolean }
): void {
  if (options?.enforce !== true) {
    return;
  }
  if (isProductionWithoutAllowlist(rules)) {
    const envKey = `${providerName.toUpperCase().replace(/\s+/g, '_')}_WEBHOOK_ALLOWLIST_CIDR`;
    throw new Error(
      `${providerName} webhook IP allowlist is EMPTY in production-like profile. ` +
        `Configure ${envKey} before go-live.`
    );
  }
}

export function webhookAllowlistEnvKeyForProvider(providerName: string): string {
  if (providerName.toLowerCase() === 'shipping') {
    return 'SHIPPING_WEBHOOK_ALLOWLIST_CIDR';
  }
  return `${providerName.toUpperCase().replace(/\s+/g, '_')}_WEBHOOK_ALLOWLIST_CIDR`;
}

export function isIpAllowlisted(clientIp: string, rules: ParsedAllowRule[]): boolean {
  if (rules.length === 0) {
    return true;
  }
  if (!ipaddr.isValid(clientIp)) {
    return false;
  }
  const parsedIp = ipaddr.parse(clientIp);

  for (const rule of rules) {
    if (rule.kind === 'exact' && parsedIp.kind() === rule.addr.kind() && parsedIp.toNormalizedString() === rule.addr.toNormalizedString()) {
      return true;
    }
    if (rule.kind === 'cidr' && parsedIp.kind() === rule.cidr[0].kind() && parsedIp.match(rule.cidr)) {
      return true;
    }
  }
  return false;
}

function normalizeIp(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.startsWith('::ffff:')) {
    return trimmed.slice('::ffff:'.length);
  }
  return trimmed;
}

export function resolveSecurityClientIp(args: {
  directRemoteIp?: string | null;
  derivedRequestIp?: string | null;
  trustedProxyRules: ParsedAllowRule[];
}): string | null {
  const direct = normalizeIp(args.directRemoteIp);
  const derived = normalizeIp(args.derivedRequestIp);
  if (!direct && !derived) {
    return null;
  }
  if (!direct) {
    return derived;
  }
  if (!derived) {
    return direct;
  }
  if (args.trustedProxyRules.length === 0) {
    return direct;
  }
  if (isIpAllowlisted(direct, args.trustedProxyRules)) {
    return derived;
  }
  return direct;
}
