import { afterEach, describe, expect, it, vi } from 'vitest';

type MockRequest = {
  url: string;
  routeOptions: { url?: string };
  ip: string;
  method: string;
  headers: Record<string, string | undefined>;
  body?: unknown;
  server: {
    redis: {
      get: ReturnType<typeof vi.fn>;
    };
  };
};

function buildRequest(args: {
  url: string;
  method?: string;
  ip?: string;
  headers?: Record<string, string | undefined>;
  body?: unknown;
  redisMode?: string | null;
}): MockRequest {
  return {
    url: args.url,
    routeOptions: { url: args.url },
    ip: args.ip ?? '127.0.0.1',
    method: args.method ?? 'GET',
    headers: args.headers ?? {},
    body: args.body,
    server: {
      redis: {
        get: vi.fn(async () => args.redisMode ?? 'normal')
      }
    }
  };
}

describe('rate-limit policies', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('resolves route tiers consistently', async () => {
    const { resolveRateLimitTier } = await import('./rate-limit-policies');

    expect(resolveRateLimitTier(buildRequest({ url: '/api/v1/health' }) as never)).toBe('health');
    expect(resolveRateLimitTier(buildRequest({ url: '/api/v1/auth/login' }) as never)).toBe('auth');
    expect(resolveRateLimitTier(buildRequest({ url: '/api/v1/products' }) as never)).toBe('catalog');
    expect(resolveRateLimitTier(buildRequest({ url: '/api/v1/cart' }) as never)).toBe('cart');
    expect(resolveRateLimitTier(buildRequest({ url: '/api/v1/orders' }) as never)).toBe('checkout');
    expect(resolveRateLimitTier(buildRequest({ url: '/api/v1/notifications/webhook/meta-whatsapp' }) as never)).toBe('webhook');
    expect(resolveRateLimitTier(buildRequest({ url: '/api/v1/admin/users' }) as never)).toBe('admin');
    expect(resolveRateLimitTier(buildRequest({ url: '/random-path' }) as never)).toBe('default');
  });

  it('builds webhook key from provider signature/event id and hashes sensitive values', async () => {
    const { rateLimitKeyGenerator } = await import('./rate-limit-policies');
    const request = buildRequest({
      url: '/api/v1/payments/webhook',
      headers: {
        'x-razorpay-event-id': 'evt_123'
      }
    });

    const key = rateLimitKeyGenerator(request as never);

    expect(key).toContain('tier:webhook');
    expect(key).toContain('path:/api/v1/payments/webhook');
    expect(key).toContain('provider:');
    expect(key).not.toContain('evt_123');
  });

  it('builds webhook key for Meta webhook endpoint with hashed source', async () => {
    const { rateLimitKeyGenerator } = await import('./rate-limit-policies');
    const request = buildRequest({
      url: '/api/v1/notifications/webhook/meta-whatsapp',
      headers: {
        authorization: 'Token meta-webhook'
      }
    });

    const key = rateLimitKeyGenerator(request as never);

    expect(key).toContain('tier:webhook');
    expect(key).toContain('path:/api/v1/notifications/webhook/meta-whatsapp');
    expect(key).toContain('provider:');
    expect(key).not.toContain('meta-webhook');
  });

  it('uses auth identifier in auth key generation', async () => {
    const { rateLimitKeyGenerator } = await import('./rate-limit-policies');
    const request = buildRequest({
      url: '/api/v1/auth/login',
      body: { email: 'Customer@Example.com' }
    });

    const key = rateLimitKeyGenerator(request as never);

    expect(key).toContain('tier:auth');
    expect(key).toContain('path:/api/v1/auth/login');
    expect(key).toContain(':id:');
    expect(key).toContain(':ip:127.0.0.1');
    expect(key).not.toContain('Customer@Example.com');
  });

  it('uses ops_session cookie as per-user key for admin-tier ops routes with no Bearer token', async () => {
    const { rateLimitKeyGenerator } = await import('./rate-limit-policies');
    const request = buildRequest({
      url: '/api/v1/ops/config/overview',
      headers: {
        cookie: 'ops_session=super-secret-session-token'
      }
    });

    const key = rateLimitKeyGenerator(request as never);

    expect(key).toContain('tier:admin');
    expect(key).toContain('path:/api/v1/ops/config/overview');
    expect(key).toContain(':ops:');
    expect(key).not.toContain('super-secret-session-token');
  });

  it('ops_session key differs per distinct session (per-user granularity)', async () => {
    const { rateLimitKeyGenerator } = await import('./rate-limit-policies');

    const req1 = buildRequest({
      url: '/api/v1/ops/config/overview',
      headers: { cookie: 'ops_session=session-user-a' }
    });
    const req2 = buildRequest({
      url: '/api/v1/ops/config/overview',
      headers: { cookie: 'ops_session=session-user-b' }
    });

    const key1 = rateLimitKeyGenerator(req1 as never);
    const key2 = rateLimitKeyGenerator(req2 as never);

    expect(key1).not.toBe(key2);
    expect(key1).toContain(':ops:');
    expect(key2).toContain(':ops:');
  });

  it('reduces admin max in emergency mode but keeps checkout max unchanged', async () => {
    vi.stubEnv('LOAD_SHED_MODE', 'emergency');
    const { resolveRateLimitMax } = await import('./rate-limit-policies');

    const adminRequest = buildRequest({ url: '/api/v1/admin/users' });
    const checkoutRequest = buildRequest({ url: '/api/v1/orders', method: 'POST' });

    const adminMax = await resolveRateLimitMax(adminRequest as never);
    const checkoutMax = await resolveRateLimitMax(checkoutRequest as never);

    // 30% of the admin class limit (180/min since the console-starvation fix).
    expect(adminMax).toBe(54);
    expect(checkoutMax).toBe(30);
  });
});
