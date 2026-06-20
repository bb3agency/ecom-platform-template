import crypto from 'crypto';
import { FastifyRequest } from 'fastify';
import { RateLimitOptions } from '@fastify/rate-limit';
import { recordReliabilityMode } from '@common/observability/metrics';
import { getEdgeRule } from '@common/security/edge-policy';

const ONE_MINUTE = '1 minute';
const LOAD_SHED_MODE_KEY = 'ops:load_shed:mode';
const LOAD_SHED_CACHE_TTL_MS = 5000;

let cachedLoadShedMode = 'normal';
let cachedLoadShedFetchedAt = 0;

type RateLimitTier =
  | 'auth'
  | 'catalog'
  | 'cart'
  | 'checkout'
  | 'webhook'
  | 'admin'
  | 'health'
  | 'default';

function normalizeRoutePath(url: string): string {
  const withoutQuery = url.split('?')[0] ?? '';
  if (withoutQuery.length > 1 && withoutQuery.endsWith('/')) {
    return withoutQuery.slice(0, -1);
  }
  return withoutQuery;
}

function getRoutePath(request: FastifyRequest): string {
  const routeUrl = request.routeOptions.url;
  if (typeof routeUrl === 'string') {
    return normalizeRoutePath(routeUrl);
  }
  return normalizeRoutePath(request.url);
}

function hashValue(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 24);
}

function readAuthToken(request: FastifyRequest): string | undefined {
  const authorization = request.headers.authorization;
  if (!authorization || !authorization.startsWith('Bearer ')) {
    return undefined;
  }
  const token = authorization.replace('Bearer ', '').trim();
  return token.length > 0 ? token : undefined;
}

function readOpsSession(request: FastifyRequest): string | undefined {
  const cookieHeader = request.headers.cookie;
  if (!cookieHeader) {
    return undefined;
  }

  const tokenPart = cookieHeader
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('ops_session='));

  if (!tokenPart) {
    return undefined;
  }

  const rawSession = tokenPart.replace('ops_session=', '').trim();
  return rawSession.length > 0 ? rawSession : undefined;
}

function readCartSession(request: FastifyRequest): string | undefined {
  const cookieHeader = request.headers.cookie;
  if (!cookieHeader) {
    return undefined;
  }

  const tokenPart = cookieHeader
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('cart_session='));

  if (!tokenPart) {
    return undefined;
  }

  const rawSession = tokenPart.replace('cart_session=', '').trim();
  return rawSession.length > 0 ? decodeURIComponent(rawSession) : undefined;
}

function readAuthIdentifier(request: FastifyRequest): string | undefined {
  const body = request.body;
  if (!body || typeof body !== 'object') {
    return undefined;
  }

  const record = body as Record<string, unknown>;
  const rawEmail = typeof record.email === 'string' ? record.email.trim().toLowerCase() : undefined;
  if (rawEmail && rawEmail.length > 0) {
    return `email:${rawEmail}`;
  }

  const rawPhone = typeof record.phone === 'string' ? record.phone.trim() : undefined;
  if (rawPhone && rawPhone.length > 0) {
    return `phone:${rawPhone}`;
  }

  return undefined;
}

export function resolveRateLimitTier(request: FastifyRequest): RateLimitTier {
  const path = getRoutePath(request);

  if (path === '/api/v1/health') {
    return 'health';
  }

  if (
    path === '/api/v1/payments/webhook' ||
    path === '/api/v1/shipping/webhook' ||
    path === '/api/v1/notifications/webhook/meta-whatsapp'
  ) {
    return 'webhook';
  }

  if (path.startsWith('/api/v1/auth/')) {
    return 'auth';
  }

  if (path.startsWith('/api/v1/admin/')) {
    return 'admin';
  }

  if (path.startsWith('/api/v1/ops/')) {
    return 'admin';
  }

  if (
    path === '/api/v1/orders' ||
    path === '/api/v1/payments/initiate' ||
    path === '/api/v1/payments/verify' ||
    path.startsWith('/api/v1/orders/') ||
    (path.startsWith('/api/v1/admin/orders/') && path.endsWith('/cancel')) ||
    (path.startsWith('/api/v1/admin/orders/') && path.endsWith('/status'))
  ) {
    return 'checkout';
  }

  if (
    path.startsWith('/api/v1/cart') ||
    path.startsWith('/api/v1/wishlist') ||
    path.startsWith('/api/v1/users/me')
  ) {
    return 'cart';
  }

  if (
    path.startsWith('/api/v1/products') ||
    path.startsWith('/api/v1/reviews/product') ||
    path.startsWith('/api/v1/shipping/track')
  ) {
    return 'catalog';
  }

  return 'default';
}

export function rateLimitKeyGenerator(request: FastifyRequest): string {
  const tier = resolveRateLimitTier(request);
  const path = getRoutePath(request);
  const ip = request.ip;

  if (tier === 'webhook') {
    const eventIdHeader = request.headers['x-razorpay-event-id'];
    const eventId = Array.isArray(eventIdHeader) ? eventIdHeader[0] : eventIdHeader;
    const authHeader = request.headers.authorization;
    const signatureHeader = request.headers['x-razorpay-signature'];
    const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
    const providerKey = eventId ?? signature ?? authHeader ?? ip;
    return `tier:${tier}:path:${path}:provider:${hashValue(providerKey)}`;
  }

  if (tier === 'auth') {
    const identifier = readAuthIdentifier(request) ?? 'anonymous';
    return `tier:${tier}:path:${path}:id:${hashValue(identifier)}:ip:${ip}`;
  }

  const token = readAuthToken(request);
  if (tier === 'admin' && token) {
    return `tier:${tier}:path:${path}:token:${hashValue(token)}:ip:${ip}`;
  }
  if (tier === 'admin') {
    const opsSession = readOpsSession(request);
    if (opsSession) {
      return `tier:${tier}:path:${path}:ops:${hashValue(opsSession)}:ip:${ip}`;
    }
  }

  if (tier === 'cart') {
    const session = readCartSession(request);
    const subject = token ?? session ?? ip;
    return `tier:${tier}:path:${path}:subject:${hashValue(subject)}:ip:${ip}`;
  }

  if (token) {
    return `tier:${tier}:path:${path}:token:${hashValue(token)}:ip:${ip}`;
  }

  return `tier:${tier}:path:${path}:ip:${ip}`;
}

async function resolveLoadShedMode(request: FastifyRequest): Promise<'normal' | 'reduced' | 'emergency'> {
  const now = Date.now();
  if (now - cachedLoadShedFetchedAt <= LOAD_SHED_CACHE_TTL_MS) {
    return cachedLoadShedMode as 'normal' | 'reduced' | 'emergency';
  }

  const fromEnv = process.env.LOAD_SHED_MODE?.trim().toLowerCase();
  if (fromEnv === 'reduced' || fromEnv === 'emergency') {
    cachedLoadShedMode = fromEnv;
    cachedLoadShedFetchedAt = now;
    recordReliabilityMode(cachedLoadShedMode);
    return fromEnv;
  }

  try {
    const fromRedis = (await request.server.redis.get(LOAD_SHED_MODE_KEY))?.trim().toLowerCase();
    if (fromRedis === 'reduced' || fromRedis === 'emergency') {
      cachedLoadShedMode = fromRedis;
    } else if (fromRedis === 'maintenance') {
      // Maintenance mode (both `pending` and `active` phases) collapses to
      // `emergency` for rate-limit purposes. During `pending` we want
      // emergency-style limits so the warning window protects the backend
      // from a last-minute traffic spike; during `active` Nginx is already
      // serving the static page for non-allowed routes but the allowed
      // routes (ops, health, webhooks, payments-drain) still benefit from
      // tighter limits to give the backend headroom during the cutover.
      cachedLoadShedMode = 'emergency';
    } else {
      cachedLoadShedMode = 'normal';
    }
  } catch {
    cachedLoadShedMode = 'normal';
  }
  cachedLoadShedFetchedAt = now;
  recordReliabilityMode(cachedLoadShedMode);
  return cachedLoadShedMode as 'normal' | 'reduced' | 'emergency';
}

export async function resolveRateLimitMax(request: FastifyRequest): Promise<number> {
  const tier = resolveRateLimitTier(request);
  const mode = await resolveLoadShedMode(request);

  const baseMax = (() => {
    switch (tier) {
      case 'auth':
        return getEdgeRule('auth').appLimitPerMinute;
      case 'catalog':
        return getEdgeRule('catalog').appLimitPerMinute;
      case 'cart':
        return getEdgeRule('cart').appLimitPerMinute;
      case 'checkout':
        return getEdgeRule('checkout').appLimitPerMinute;
      case 'webhook':
        return getEdgeRule('webhook').appLimitPerMinute;
      case 'admin':
        return getEdgeRule('admin').appLimitPerMinute;
      case 'health':
        return getEdgeRule('health').appLimitPerMinute;
      default:
        return getEdgeRule('default').appLimitPerMinute;
    }
  })();

  if (mode === 'normal') {
    return baseMax;
  }

  if (mode === 'emergency') {
    switch (tier) {
      case 'checkout':
      case 'webhook':
      case 'health':
        return baseMax;
      case 'auth':
        return Math.max(4, Math.floor(baseMax * 0.75));
      case 'admin':
        return Math.max(10, Math.floor(baseMax * 0.3));
      case 'catalog':
        return Math.max(30, Math.floor(baseMax * 0.2));
      case 'cart':
        return Math.max(20, Math.floor(baseMax * 0.35));
      default:
        return Math.max(15, Math.floor(baseMax * 0.3));
    }
  }

  switch (tier) {
    case 'auth':
      return Math.max(8, Math.floor(baseMax * 0.9));
    case 'catalog':
      return Math.max(60, Math.floor(baseMax * 0.5));
    case 'cart':
      return Math.max(40, Math.floor(baseMax * 0.7));
    case 'checkout':
      return baseMax;
    case 'webhook':
      return baseMax;
    case 'admin':
      return Math.max(20, Math.floor(baseMax * 0.5));
    case 'health':
      return baseMax;
    default:
      return Math.max(40, Math.floor(baseMax * 0.5));
  }
}

export const baseRateLimitWindow = ONE_MINUTE;

export const routeRateLimitProfiles = {
  authLogin: {
    max: getEdgeRule('auth').appLimitPerMinute,
    timeWindow: '1 minute',
    keyGenerator: rateLimitKeyGenerator
  },
  authSensitive: {
    max: Math.max(4, Math.floor(getEdgeRule('auth').appLimitPerMinute / 2)),
    timeWindow: '1 minute',
    keyGenerator: rateLimitKeyGenerator
  },
  checkoutMutation: {
    max: getEdgeRule('checkout').appLimitPerMinute,
    timeWindow: '1 minute',
    keyGenerator: rateLimitKeyGenerator
  },
  webhookIngress: {
    max: getEdgeRule('webhook').appLimitPerMinute,
    timeWindow: '1 minute',
    keyGenerator: rateLimitKeyGenerator
  },
  adminWrite: {
    max: Math.max(10, Math.floor(getEdgeRule('admin').appLimitPerMinute * 0.67)),
    timeWindow: '1 minute',
    keyGenerator: rateLimitKeyGenerator
  },
  adminRead: {
    max: getEdgeRule('admin').appLimitPerMinute,
    timeWindow: '1 minute',
    keyGenerator: rateLimitKeyGenerator
  },
  opsRead: {
    max: Math.max(10, Math.floor(getEdgeRule('admin').appLimitPerMinute * 0.5)),
    timeWindow: '1 minute',
    keyGenerator: rateLimitKeyGenerator
  },
  opsCritical: {
    max: Math.max(2, Math.floor(getEdgeRule('admin').appLimitPerMinute * 0.1)),
    timeWindow: '1 minute',
    keyGenerator: rateLimitKeyGenerator
  },
  catalogRead: {
    max: getEdgeRule('catalog').appLimitPerMinute,
    timeWindow: '1 minute',
    keyGenerator: rateLimitKeyGenerator
  },
  cartOps: {
    max: getEdgeRule('cart').appLimitPerMinute,
    timeWindow: '1 minute',
    keyGenerator: rateLimitKeyGenerator
  }
} satisfies Record<string, RateLimitOptions>;
