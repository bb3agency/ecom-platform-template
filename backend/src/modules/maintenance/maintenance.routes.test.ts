import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerMaintenanceRoutes } from './maintenance.routes';
import {
  invalidateMaintenanceProcessCache,
  MAINTENANCE_STATE_REDIS_KEY,
  type MaintenanceStateRecord
} from '@common/reliability/maintenance-state';

function buildFastify(record: MaintenanceStateRecord | null): FastifyInstance {
  const fastify = Fastify();
  // Provide bare-bones decorators that maintenance-state.readMaintenanceStateFromRequest expects.
  fastify.decorate('prisma', {
    maintenanceState: {
      findUnique: vi.fn(async () => {
        if (!record) return null;
        return {
          mode: record.mode,
          phase: record.phase,
          pendingUntil: record.pendingUntil ? new Date(record.pendingUntil) : null,
          activatedAt: record.activatedAt ? new Date(record.activatedAt) : null,
          reason: record.reason,
          setByOpsUserId: record.setByOpsUserId,
          setAt: new Date(record.setAt),
          updatedAt: new Date(record.updatedAt)
        };
      })
    }
  } as never);
  fastify.decorate('redis', {
    get: vi.fn(async (key: string) => {
      if (key === MAINTENANCE_STATE_REDIS_KEY && record) {
        return JSON.stringify(record);
      }
      return null;
    }),
    set: vi.fn(async () => 'OK')
  } as never);
  return fastify;
}

const ACTIVE_STATE: MaintenanceStateRecord = {
  mode: 'maintenance',
  phase: 'active',
  pendingUntil: null,
  activatedAt: new Date('2030-01-01T00:02:00Z').toISOString(),
  reason: 'planned',
  setByOpsUserId: 'ops-1',
  setAt: new Date('2030-01-01T00:00:00Z').toISOString(),
  updatedAt: new Date('2030-01-01T00:02:00Z').toISOString()
};

const PENDING_STATE: MaintenanceStateRecord = {
  ...ACTIVE_STATE,
  phase: 'pending',
  pendingUntil: new Date('2030-01-01T00:02:00Z').toISOString(),
  activatedAt: null
};

describe('maintenance routes', () => {
  let app: FastifyInstance;

  beforeEach(() => {
    invalidateMaintenanceProcessCache();
  });

  afterEach(async () => {
    if (app) await app.close();
    invalidateMaintenanceProcessCache();
  });

  describe('GET /api/v1/maintenance/status', () => {
    it('returns normal mode when no state row exists', async () => {
      app = buildFastify(null);
      await registerMaintenanceRoutes(app);
      await app.ready();

      const res = await app.inject({ method: 'GET', url: '/api/v1/maintenance/status' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.mode).toBe('normal');
      expect(body.phase).toBeNull();
      expect(typeof body.serverTime).toBe('string');
    });

    it('returns pending maintenance state with pendingUntil for banner countdown', async () => {
      app = buildFastify(PENDING_STATE);
      await registerMaintenanceRoutes(app);
      await app.ready();

      const res = await app.inject({ method: 'GET', url: '/api/v1/maintenance/status' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.mode).toBe('maintenance');
      expect(body.phase).toBe('pending');
      expect(body.pendingUntil).toBe(PENDING_STATE.pendingUntil);
    });

    it('returns active maintenance state with activatedAt timestamp', async () => {
      app = buildFastify(ACTIVE_STATE);
      await registerMaintenanceRoutes(app);
      await app.ready();

      const res = await app.inject({ method: 'GET', url: '/api/v1/maintenance/status' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.mode).toBe('maintenance');
      expect(body.phase).toBe('active');
      expect(body.activatedAt).toBe(ACTIVE_STATE.activatedAt);
    });
  });

  describe('GET /api/v1/maintenance/gate', () => {
    it('returns 200 + X-Maintenance-Active=0 when no maintenance', async () => {
      app = buildFastify(null);
      await registerMaintenanceRoutes(app);
      await app.ready();

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/maintenance/gate',
        headers: { 'x-original-uri': '/products/list' }
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers['x-maintenance-active']).toBe('0');
    });

    it('returns 200 + X-Maintenance-Active=0 during pending (banner-only window)', async () => {
      app = buildFastify(PENDING_STATE);
      await registerMaintenanceRoutes(app);
      await app.ready();

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/maintenance/gate',
        headers: { 'x-original-uri': '/products/list' }
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers['x-maintenance-active']).toBe('0');
    });

    it('returns 401 + X-Maintenance-Active=1 for storefront paths during active', async () => {
      app = buildFastify(ACTIVE_STATE);
      await registerMaintenanceRoutes(app);
      await app.ready();

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/maintenance/gate',
        headers: { 'x-original-uri': '/products/list' }
      });
      expect(res.statusCode).toBe(401);
      expect(res.headers['x-maintenance-active']).toBe('1');
      const body = res.json();
      expect(body.allowed).toBe(false);
    });

    it('returns 200 + X-Maintenance-Active=0 for /api/v1/ops/* during active', async () => {
      app = buildFastify(ACTIVE_STATE);
      await registerMaintenanceRoutes(app);
      await app.ready();

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/maintenance/gate',
        headers: { 'x-original-uri': '/api/v1/ops/load-shed' }
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers['x-maintenance-active']).toBe('0');
    });

    it('returns 200 + X-Maintenance-Active=0 for /api/v1/health during active', async () => {
      app = buildFastify(ACTIVE_STATE);
      await registerMaintenanceRoutes(app);
      await app.ready();

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/maintenance/gate',
        headers: { 'x-original-uri': '/api/v1/health' }
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers['x-maintenance-active']).toBe('0');
    });

    it('returns 200 + X-Maintenance-Active=0 for payments webhook during active', async () => {
      app = buildFastify(ACTIVE_STATE);
      await registerMaintenanceRoutes(app);
      await app.ready();

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/maintenance/gate',
        headers: { 'x-original-uri': '/api/v1/payments/webhook' }
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers['x-maintenance-active']).toBe('0');
    });

    it('strips query string before matching ALWAYS_ALLOWED prefixes', async () => {
      app = buildFastify(ACTIVE_STATE);
      await registerMaintenanceRoutes(app);
      await app.ready();

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/maintenance/gate',
        headers: { 'x-original-uri': '/api/v1/ops/load-shed?page=2&size=20' }
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers['x-maintenance-active']).toBe('0');
    });
  });
});
