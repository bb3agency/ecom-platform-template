/**
 * End-to-end integration test for the maintenance mode lifecycle. Wires a
 * minimal Fastify app with the real `loadShedGuard`, the real maintenance
 * routes, and the real state helpers — but with an in-memory Prisma+Redis
 * pair so no DB or Redis container is required.
 *
 * The point of this file is to exercise the actual route matrix end-to-end:
 *   1. `normal` mode: every route is reachable.
 *   2. `maintenance/pending` (the state the writer creates before the
 *      activation job fires): emergency-style gate on checkout mutations
 *      and non-critical admin, payment-drain allowlist passes, ops + health
 *      + webhooks + maintenance status pass.
 *   3. `maintenance/active` (the post-cutover state): every route except
 *      the ALWAYS_ALLOWED prefixes returns 503 from the guard, and the
 *      Nginx gate returns 200 with `X-Maintenance-Active: 1` for blocked
 *      paths and `0` for allowed paths.
 *   4. Mode exit: clearing back to `normal` immediately makes every route
 *      reachable again (no stale process-cache).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { loadShedGuard, invalidateLoadShedProcessCache } from '@common/reliability/load-shed.guard';
import {
  invalidateMaintenanceProcessCache,
  writeMaintenanceState,
  MAINTENANCE_STATE_SINGLETON_KEY,
  type MaintenanceStatePrismaLike,
  type MaintenanceStateRedisLike,
  type MaintenanceStateRecord
} from '@common/reliability/maintenance-state';
import { registerMaintenanceRoutes } from './maintenance.routes';

interface InMemoryRow {
  singletonKey: string;
  mode: string;
  phase: string | null;
  pendingUntil: Date | null;
  activatedAt: Date | null;
  reason: string | null;
  setByOpsUserId: string | null;
  setAt: Date;
  updatedAt: Date;
}

function buildInMemoryStore() {
  let row: InMemoryRow | null = null;
  const redis = new Map<string, string>();

  const prisma: MaintenanceStatePrismaLike = {
    maintenanceState: {
      findUnique: async ({ where }) => {
        if (!row || row.singletonKey !== where.singletonKey) return null;
        return row;
      },
      upsert: async ({ where, create, update }) => {
        if (row && row.singletonKey === where.singletonKey) {
          row = { ...row, ...update, updatedAt: new Date() };
        } else {
          row = {
            singletonKey: create.singletonKey,
            mode: create.mode,
            phase: create.phase,
            pendingUntil: create.pendingUntil,
            activatedAt: create.activatedAt,
            reason: create.reason,
            setByOpsUserId: create.setByOpsUserId,
            setAt: create.setAt,
            updatedAt: new Date()
          };
        }
        return row;
      }
    }
  };

  const redisLike: MaintenanceStateRedisLike = {
    get: async (key: string) => redis.get(key) ?? null,
    set: async (key: string, value: string) => {
      redis.set(key, value);
      return 'OK';
    },
    del: async (key: string) => {
      const had = redis.delete(key);
      return had ? 1 : 0;
    }
  };

  return { prisma, redis: redisLike, getRow: () => row, redisStore: redis };
}

async function buildApp(store: ReturnType<typeof buildInMemoryStore>): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  // The Fastify type stubs declare `prisma`/`redis` decorators with the
  // concrete PrismaClient + ioredis types from the project's type
  // augmentation; our in-memory test doubles intentionally implement only
  // the surface the maintenance helpers use, so we cast through `unknown`.
  // 
  // @ts-expect-error test double
  app.decorate('prisma', store.prisma);
  // 
  // @ts-expect-error test double
  app.decorate('redis', store.redis);

  // Register the real maintenance routes (status + gate) so they share the
  // same in-memory store with the guard.
  await registerMaintenanceRoutes(app);

  // Mount a guarded probe route that mirrors a storefront mutation. The
  // guard's behaviour at the request level is what the test asserts.
  app.addHook('preHandler', async (request, reply) => {
    // Skip the guard for the maintenance routes themselves — they live in
    // ALWAYS_ALLOWED_PREFIXES, but the guard does that check internally
    // via the route URL, so we just register every probe and let the
    // guard decide.
    await loadShedGuard(request, reply);
  });

  // Storefront checkout (blocked in pending mutation + active).
  app.post('/api/v1/orders/checkout', async () => ({ ok: true }));
  // Admin write (blocked in active; blocked in pending if non-critical).
  app.post('/api/v1/admin/products', async () => ({ ok: true }));
  // Payment drain helper (allowed in pending so in-flight payments
  // settle; blocked in active).
  app.post('/api/v1/payments/verify', async () => ({ ok: true }));
  // Health (always allowed).
  app.get('/api/v1/health', async () => ({ status: 'ok' }));
  // Webhook (always allowed).
  app.post('/api/v1/payments/webhook', async () => ({ ok: true }));
  // Ops control plane (always allowed).
  app.get('/api/v1/ops/load-shed', async () => ({ mode: 'normal' }));
  // Auth (always allowed during maintenance/active so customers can sign
  // out cleanly).
  app.post('/api/v1/auth/login', async () => ({ ok: true }));

  await app.ready();
  return app;
}

async function setState(
  store: ReturnType<typeof buildInMemoryStore>,
  record: Omit<MaintenanceStateRecord, 'updatedAt'>
): Promise<void> {
  invalidateLoadShedProcessCache();
  invalidateMaintenanceProcessCache();
  await writeMaintenanceState({ prisma: store.prisma, redis: store.redis, record });
}

describe('Maintenance mode end-to-end route matrix', () => {
  let store: ReturnType<typeof buildInMemoryStore>;
  let app: FastifyInstance;

  beforeEach(async () => {
    store = buildInMemoryStore();
    invalidateLoadShedProcessCache();
    invalidateMaintenanceProcessCache();
    app = await buildApp(store);
  });

  it('mode=normal: every route reachable', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/v1/orders/checkout' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/v1/admin/products' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/v1/payments/verify' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/v1/health' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/v1/payments/webhook' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/v1/ops/load-shed' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/v1/auth/login' })).statusCode).toBe(200);
    await app.close();
  });

  it('mode=maintenance/pending: emergency-style gate + payment drain allowed', async () => {
    const inTwoMinutes = new Date(Date.now() + 2 * 60 * 1000).toISOString();
    await setState(store, {
      mode: 'maintenance',
      phase: 'pending',
      pendingUntil: inTwoMinutes,
      activatedAt: null,
      reason: 'planned migration',
      setByOpsUserId: 'ops_1',
      setAt: new Date().toISOString()
    });

    // Checkout blocked (pending phase blocks new mutations).
    expect((await app.inject({ method: 'POST', url: '/api/v1/orders/checkout' })).statusCode).toBe(503);
    // Admin non-critical writes blocked.
    expect((await app.inject({ method: 'POST', url: '/api/v1/admin/products' })).statusCode).toBe(503);
    // Payment-drain helper still allowed (in-flight payments settle).
    expect((await app.inject({ method: 'POST', url: '/api/v1/payments/verify' })).statusCode).toBe(200);
    // Always-allowed prefixes.
    expect((await app.inject({ method: 'GET', url: '/api/v1/health' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/v1/payments/webhook' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/v1/ops/load-shed' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/v1/auth/login' })).statusCode).toBe(200);

    // Status endpoint must include serverTime + the actual pending state.
    const status = await app.inject({ method: 'GET', url: '/api/v1/maintenance/status' });
    expect(status.statusCode).toBe(200);
    const body = status.json();
    expect(body.mode).toBe('maintenance');
    expect(body.phase).toBe('pending');
    expect(body.pendingUntil).toBe(inTwoMinutes);
    expect(typeof body.serverTime).toBe('string');
    expect(body.serverTime).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);

    await app.close();
  });

  it('mode=maintenance/active: nginx gate header + guard 503 for non-allowed routes', async () => {
    await setState(store, {
      mode: 'maintenance',
      phase: 'active',
      pendingUntil: null,
      activatedAt: new Date().toISOString(),
      reason: 'planned migration',
      setByOpsUserId: 'ops_1',
      setAt: new Date().toISOString()
    });

    // Guard blocks everything outside ALWAYS_ALLOWED.
    expect((await app.inject({ method: 'POST', url: '/api/v1/orders/checkout' })).statusCode).toBe(503);
    expect((await app.inject({ method: 'POST', url: '/api/v1/admin/products' })).statusCode).toBe(503);
    expect((await app.inject({ method: 'POST', url: '/api/v1/payments/verify' })).statusCode).toBe(503);
    // ALWAYS_ALLOWED prefixes still pass.
    expect((await app.inject({ method: 'GET', url: '/api/v1/health' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/v1/payments/webhook' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/v1/ops/load-shed' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/v1/auth/login' })).statusCode).toBe(200);

    // Nginx auth_request gate: blocked path returns header=1.
    const blockedGate = await app.inject({
      method: 'GET',
      url: '/api/v1/maintenance/gate',
      headers: { 'x-original-uri': '/api/v1/orders/checkout' }
    });
    // 401 (not 200) so Nginx auth_request rejects and triggers
    // `error_page 401 = @maintenance_block` on the gated location.
    // See HARDENING_HISTORY.md "May 2026 — Maintenance gate bypass".
    expect(blockedGate.statusCode).toBe(401);
    expect(blockedGate.headers['x-maintenance-active']).toBe('1');

    // Nginx auth_request gate: allowed path (ops) returns header=0.
    const allowedGate = await app.inject({
      method: 'GET',
      url: '/api/v1/maintenance/gate',
      headers: { 'x-original-uri': '/api/v1/ops/load-shed' }
    });
    expect(allowedGate.statusCode).toBe(200);
    expect(allowedGate.headers['x-maintenance-active']).toBe('0');

    // Gate strips query strings before matching.
    const allowedWithQuery = await app.inject({
      method: 'GET',
      url: '/api/v1/maintenance/gate',
      headers: { 'x-original-uri': '/api/v1/ops/audit/logs?page=2&limit=20' }
    });
    expect(allowedWithQuery.headers['x-maintenance-active']).toBe('0');

    await app.close();
  });

  it('mode exit: clearing phase makes everything reachable again on the next request', async () => {
    // Start in active.
    await setState(store, {
      mode: 'maintenance',
      phase: 'active',
      pendingUntil: null,
      activatedAt: new Date().toISOString(),
      reason: 'planned migration',
      setByOpsUserId: 'ops_1',
      setAt: new Date().toISOString()
    });
    expect((await app.inject({ method: 'POST', url: '/api/v1/orders/checkout' })).statusCode).toBe(503);

    // Operator flips to normal. The writer in real code also clears these
    // fields; we mirror that here to validate the guard reads them correctly.
    await setState(store, {
      mode: 'normal',
      phase: null,
      pendingUntil: null,
      activatedAt: null,
      reason: 'window complete',
      setByOpsUserId: 'ops_1',
      setAt: new Date().toISOString()
    });

    // Immediately reachable again (no stale process cache).
    expect((await app.inject({ method: 'POST', url: '/api/v1/orders/checkout' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/v1/admin/products' })).statusCode).toBe(200);

    // Gate now returns header=0 even for previously-blocked paths.
    const reopenedGate = await app.inject({
      method: 'GET',
      url: '/api/v1/maintenance/gate',
      headers: { 'x-original-uri': '/api/v1/orders/checkout' }
    });
    expect(reopenedGate.headers['x-maintenance-active']).toBe('0');

    await app.close();
  });

  it('persistence: state survives a wipe of the Redis cache (DB read repopulates cache)', async () => {
    await setState(store, {
      mode: 'maintenance',
      phase: 'active',
      pendingUntil: null,
      activatedAt: new Date().toISOString(),
      reason: 'simulated infra reset',
      setByOpsUserId: 'ops_1',
      setAt: new Date().toISOString()
    });

    // Wipe Redis (simulates a flush / fresh container) and invalidate the
    // process cache so the next read has to go to Postgres.
    store.redisStore.clear();
    invalidateMaintenanceProcessCache();
    invalidateLoadShedProcessCache();

    // The DB row should still trigger maintenance/active behaviour.
    expect((await app.inject({ method: 'POST', url: '/api/v1/orders/checkout' })).statusCode).toBe(503);

    // Cache should be repopulated by the read path — singleton key written.
    expect(store.redisStore.has('ops:maintenance:state')).toBe(true);

    // DB row key matches the constant used by writeMaintenanceState.
    expect(store.getRow()?.singletonKey).toBe(MAINTENANCE_STATE_SINGLETON_KEY);

    await app.close();
  });

  it('self-heal: stuck `pending` past grace auto-promotes to `active` on the next request', async () => {
    // Simulates the failure mode the operator hit on 2026-05-26: maintenance
    // was set, the worker container ran an old build without the
    // `maintenance-activation` handler, so the BullMQ job silently completed
    // without flipping the state. Without self-heal the storefront stays
    // accessible indefinitely; with self-heal it converges to `active`
    // automatically after `MAINTENANCE_ACTIVATION_GRACE_MS` past
    // `pendingUntil`.
    const longAgo = new Date(Date.now() - 60 * 60 * 1000); // pendingUntil was an hour ago
    await setState(store, {
      mode: 'maintenance',
      phase: 'pending',
      pendingUntil: longAgo.toISOString(),
      activatedAt: null,
      reason: 'simulated worker failure',
      setByOpsUserId: 'ops_1',
      setAt: new Date(longAgo.getTime() - 2 * 60 * 1000).toISOString()
    });

    // The very first request after the read-side detects the overdue
    // pending must return 503 (active behaviour), and the row must have
    // been promoted in Postgres so other replicas observe `active` too.
    const blocked = await app.inject({ method: 'POST', url: '/api/v1/orders/checkout' });
    expect(blocked.statusCode).toBe(503);

    const row = store.getRow();
    expect(row?.mode).toBe('maintenance');
    expect(row?.phase).toBe('active');
    expect(row?.activatedAt).not.toBeNull();

    // The Nginx gate must agree with the promoted state — the storefront
    // is now blocked at the edge too. Status is 401 (not 200) so the
    // Nginx auth_request directive natively rejects the outer request and
    // triggers `error_page 401 = @maintenance_block`. The header stays for
    // backward-compat with any direct API caller.
    const gateAfter = await app.inject({
      method: 'GET',
      url: '/api/v1/maintenance/gate',
      headers: { 'x-original-uri': '/' }
    });
    expect(gateAfter.statusCode).toBe(401);
    expect(gateAfter.headers['x-maintenance-active']).toBe('1');

    // And the public status endpoint reflects the promotion so the
    // storefront banner switches from countdown to "we'll be back".
    const status = await app.inject({ method: 'GET', url: '/api/v1/maintenance/status' });
    expect(status.json().phase).toBe('active');

    await app.close();
  });

  it('self-heal: respects grace window — fresh `pending` is NOT auto-promoted prematurely', async () => {
    // Operator just set maintenance and the worker is healthy and draining.
    // The read path must NOT race the worker by promoting too early — that
    // would cut off the payment drain window we promised customers.
    const justNow = new Date();
    await setState(store, {
      mode: 'maintenance',
      phase: 'pending',
      pendingUntil: new Date(justNow.getTime() + 2 * 60 * 1000).toISOString(),
      activatedAt: null,
      reason: 'fresh maintenance, worker draining',
      setByOpsUserId: 'ops_1',
      setAt: justNow.toISOString()
    });

    // Storefront mutation blocked (pending blocks new checkouts) but
    // payment-drain helper still works.
    expect((await app.inject({ method: 'POST', url: '/api/v1/orders/checkout' })).statusCode).toBe(503);
    expect((await app.inject({ method: 'POST', url: '/api/v1/payments/verify' })).statusCode).toBe(200);

    // State row is still pending — no premature promotion.
    expect(store.getRow()?.phase).toBe('pending');

    // The Nginx gate also reflects pending → 200 + header=0 → site still
    // accessible (the banner is the only UX signal during pending).
    const gate = await app.inject({
      method: 'GET',
      url: '/api/v1/maintenance/gate',
      headers: { 'x-original-uri': '/' }
    });
    expect(gate.statusCode).toBe(200);
    expect(gate.headers['x-maintenance-active']).toBe('0');

    await app.close();
  });
});
