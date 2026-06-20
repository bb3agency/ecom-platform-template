import { FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '@common/errors/app-error';
import { ERROR_CODES } from '@common/errors/error-codes';
import {
  isMaintenanceActive,
  readMaintenanceStateFromRequest,
  type LoadShedModeWithMaintenance,
  type MaintenanceStateRecord
} from './maintenance-state';

export const LOAD_SHED_MODE_KEY = 'ops:load_shed:mode';

const NON_CRITICAL_ADMIN_PREFIXES = [
  '/api/v1/admin/analytics',
  '/api/v1/admin/dashboard',
  '/api/v1/admin/coupons',
  '/api/v1/admin/settings',
  '/api/v1/admin/inventory',
  '/api/v1/admin/reviews',
  '/api/v1/admin/users',
  '/api/v1/admin/products',
  '/api/v1/admin/categories',
  '/api/v1/admin/orders/export'
];
const REDUCED_MODE_MUTATION_PREFIXES = ['/api/v1/orders', '/api/v1/payments/initiate', '/api/v1/cart'];

/**
 * Routes that bypass every load-shed/maintenance check. These are the only
 * surfaces that must keep responding when `mode === 'maintenance'` with
 * `phase === 'active'` — ops control plane, health probes, and provider
 * webhooks (so payment/shipping callbacks can still settle during the
 * maintenance window). The maintenance status route is also listed here so
 * frontend banners and Nginx `auth_request` can poll the gate while the
 * platform is degraded.
 */
const ALWAYS_ALLOWED_PREFIXES = [
  '/api/v1/health',
  '/api/v1/auth',
  '/api/v1/media',
  '/api/v1/payments/webhook',
  '/api/v1/shipping/webhook',
  '/api/v1/notifications/webhook',
  '/api/v1/ops',
  '/api/v1/maintenance'
];

/**
 * Payment-flow routes that must keep working during `maintenance` phase
 * 'pending' so in-flight transactions can complete before the active
 * cutover. Verify/retry are scoped here; new initiation is still blocked by
 * the `REDUCED_MODE_MUTATION_PREFIXES` emergency-style gate during pending.
 */
const PAYMENT_DRAIN_ALLOWLIST = ['/api/v1/payments/verify', '/api/v1/payments/retry'];

let cachedMode: LoadShedModeWithMaintenance = 'normal';
let cachedAt = 0;

/**
 * Resolves the effective load-shed mode by consulting (in order):
 *   1. `LOAD_SHED_MODE` env var (operator escape hatch — only honored for
 *      legacy values, since `maintenance` is durable and must never be
 *      driven from env to avoid stuck states across pod restarts).
 *   2. The durable `MaintenanceState` row via cache+DB chain.
 *
 * A short in-process memo (5s) prevents per-request DB/Redis chatter on the
 * hot path. The memo here is independent from the one in
 * `maintenance-state.ts` because that module's cache returns the full
 * record (with phase) while this one returns just the mode string used by
 * the legacy guard call sites.
 */
async function resolveLoadShedMode(request: FastifyRequest): Promise<LoadShedModeWithMaintenance> {
  const now = Date.now();
  if (now - cachedAt < 5000) {
    return cachedMode;
  }

  const fromEnv = process.env.LOAD_SHED_MODE?.trim().toLowerCase();
  if (fromEnv === 'reduced' || fromEnv === 'emergency') {
    cachedMode = fromEnv;
    cachedAt = now;
    return cachedMode;
  }

  try {
    const state = await readMaintenanceStateFromRequest(request);
    cachedMode = state.mode;
  } catch {
    cachedMode = 'normal';
  }
  cachedAt = now;
  return cachedMode;
}

/**
 * Returns the current load-shed mode for a request context.
 */
export async function getLoadShedMode(request: FastifyRequest): Promise<LoadShedModeWithMaintenance> {
  return resolveLoadShedMode(request);
}

/**
 * Sets the load-shed mode via the request-scoped Redis client. Persists to
 * the `LOAD_SHED_MODE_KEY` (kept for backward compatibility with the older
 * Redis-only flow) and refreshes the in-process memo. Note: this does NOT
 * write to the durable Postgres state — callers should use
 * `writeMaintenanceState` (via `OpsService.setLoadShedModeDirect`) for any
 * change that must survive Redis loss.
 */
export async function setLoadShedMode(
  request: FastifyRequest,
  mode: LoadShedModeWithMaintenance
): Promise<void> {
  await request.server.redis.set(LOAD_SHED_MODE_KEY, mode);
  cachedMode = mode;
  cachedAt = Date.now();
}

/**
 * Sets the load-shed mode via a raw Redis client (for worker processes and
 * service-layer callers without a `FastifyRequest`). Refreshes the
 * in-process memo. As with `setLoadShedMode`, this does NOT persist to
 * Postgres — `OpsService.setLoadShedModeDirect` and the worker-side
 * `MaintenanceActivationJob` are the only writers of durable state.
 */
export async function setLoadShedModeViaRedis(
  redis: { set: (key: string, value: string) => Promise<unknown> },
  mode: LoadShedModeWithMaintenance
): Promise<void> {
  await redis.set(LOAD_SHED_MODE_KEY, mode);
  cachedMode = mode;
  cachedAt = Date.now();
}

/**
 * Forces the next `resolveLoadShedMode` call to bypass the in-process memo
 * and reread from Redis/Postgres. Called from `OpsService` immediately after
 * a successful `writeMaintenanceState` so the new mode is honoured by the
 * very next request in the same process.
 */
export function invalidateLoadShedProcessCache(): void {
  cachedAt = 0;
}

function isAlwaysAllowed(route: string): boolean {
  return ALWAYS_ALLOWED_PREFIXES.some((prefix) => route.startsWith(prefix));
}

function isPaymentDrainAllowed(route: string): boolean {
  return PAYMENT_DRAIN_ALLOWLIST.some((prefix) => route.startsWith(prefix));
}

/**
 * Returns `503` for non-allowed routes when the platform is in `maintenance`
 * with phase `active`. The Nginx `auth_request` gate also blocks the
 * matching storefront/admin paths at the edge — this server-side check
 * exists as a defense-in-depth fallback for clients that hit the backend
 * directly (curl, internal tools).
 */
function enforceMaintenance(state: MaintenanceStateRecord, route: string, method: string): void {
  if (state.mode !== 'maintenance') return;

  if (state.phase === 'active') {
    // Only the ALWAYS_ALLOWED_PREFIXES pass here — everything else is
    // turned away with a 503 that Nginx maps to the static maintenance
    // page (`error_page 502 503 /maintenance.html`).
    throw new AppError(
      ERROR_CODES.INTERNAL_ERROR,
      'Maintenance mode active. Most routes are temporarily unavailable while we finish a planned update.',
      503,
      {
        kind: 'transient',
        hintKey: 'maintenance_active',
        retryable: true,
        retryAfterSeconds: 15,
        remediation: 'Wait for maintenance to complete; ops will restore normal traffic from the control plane.'
      }
    );
  }

  // Pending phase — emergency-style gating, but payment-drain helpers
  // (verify/retry) keep working so in-flight transactions can settle.
  if (state.phase === 'pending') {
    const isCheckoutMutation =
      REDUCED_MODE_MUTATION_PREFIXES.some((prefix) => route.startsWith(prefix)) &&
      ['POST', 'PATCH', 'PUT', 'DELETE'].includes(method);
    const isNonCriticalAdmin = NON_CRITICAL_ADMIN_PREFIXES.some((prefix) => route.startsWith(prefix));
    const isPaymentDrain = isPaymentDrainAllowed(route);

    if ((isCheckoutMutation && !isPaymentDrain) || isNonCriticalAdmin) {
      throw new AppError(
        ERROR_CODES.INTERNAL_ERROR,
        'Maintenance starts shortly. New checkout and non-critical writes are paused while we drain in-flight work.',
        503,
        {
          kind: 'transient',
          hintKey: 'maintenance_pending',
          retryable: true,
          retryAfterSeconds: state.pendingUntil
            ? Math.max(5, Math.ceil((new Date(state.pendingUntil).getTime() - Date.now()) / 1000))
            : 30,
          remediation: 'Wait for the ops team to complete the planned maintenance window before retrying.'
        }
      );
    }
  }
}

export async function loadShedGuard(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const route = typeof request.routeOptions.url === 'string' ? request.routeOptions.url : request.url;

  if (isAlwaysAllowed(route)) {
    return;
  }

  // Maintenance mode short-circuits before the legacy reduced/emergency
  // checks — its rules are stricter and a stale Redis read for the legacy
  // key (Redis cache key `ops:load_shed:mode`) might miss the maintenance
  // state if the row was written via Postgres while the cache is cold.
  let maintenanceState: MaintenanceStateRecord | null = null;
  try {
    maintenanceState = await readMaintenanceStateFromRequest(request);
  } catch {
    maintenanceState = null;
  }

  if (maintenanceState) {
    enforceMaintenance(maintenanceState, route, request.method);
  }

  const mode = await resolveLoadShedMode(request);
  const isNonCriticalAdmin = NON_CRITICAL_ADMIN_PREFIXES.some((prefix) => route.startsWith(prefix));
  const isCheckoutMutation = REDUCED_MODE_MUTATION_PREFIXES.some((prefix) => route.startsWith(prefix))
    && ['POST', 'PATCH', 'PUT', 'DELETE'].includes(request.method);

  if (mode === 'emergency' && (isNonCriticalAdmin || isCheckoutMutation)) {
    throw new AppError(
      ERROR_CODES.INTERNAL_ERROR,
      'Emergency degraded mode enabled. Non-critical and mutation traffic is temporarily shed.',
      503
    );
  }
  if (mode === 'reduced' && isNonCriticalAdmin) {
    throw new AppError(
      ERROR_CODES.INTERNAL_ERROR,
      'Temporarily degraded mode for non-critical admin reports. Please retry shortly.',
      503
    );
  }
}

/**
 * Exposed for the maintenance gate route — checks whether a specific URL
 * would be blocked by the guard under the supplied state. Used by the
 * Nginx `auth_request` integration: the gate route receives the original
 * URI in `X-Original-URI`, evaluates this predicate, and returns 200 or 503
 * accordingly without invoking the full Fastify guard chain.
 */
export function shouldBlockForMaintenance(state: MaintenanceStateRecord, route: string): boolean {
  if (!isMaintenanceActive(state)) return false;
  return !isAlwaysAllowed(route);
}
