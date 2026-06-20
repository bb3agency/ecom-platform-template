import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '@common/errors/app-error';
import {
  getLoadShedMode,
  invalidateLoadShedProcessCache,
  loadShedGuard,
  setLoadShedMode,
  shouldBlockForMaintenance
} from './load-shed.guard';
import {
  invalidateMaintenanceProcessCache,
  MAINTENANCE_STATE_REDIS_KEY,
  type MaintenanceStateRecord
} from './maintenance-state';

type MockRequest = {
  method: string;
  url: string;
  routeOptions: { url: string };
  server: {
    redis: {
      get: ReturnType<typeof vi.fn>;
      set: ReturnType<typeof vi.fn>;
    };
    prisma: {
      maintenanceState: {
        findUnique: ReturnType<typeof vi.fn>;
      };
    };
  };
};

function buildRequest(
  route: string,
  method = 'GET',
  modeFromRedis: string | null = 'normal',
  maintenanceStateRecord: MaintenanceStateRecord | null = null
): MockRequest {
  const redis = {
    get: vi.fn(async (key: string) => {
      if (key === MAINTENANCE_STATE_REDIS_KEY && maintenanceStateRecord) {
        return JSON.stringify(maintenanceStateRecord);
      }
      return modeFromRedis;
    }),
    set: vi.fn(async () => 'OK')
  };
  return {
    method,
    url: route,
    routeOptions: { url: route },
    server: {
      redis,
      prisma: {
        maintenanceState: {
          findUnique: vi.fn(async () => null)
        }
      }
    }
  };
}

const NORMAL_STATE: MaintenanceStateRecord = {
  mode: 'normal',
  phase: null,
  pendingUntil: null,
  activatedAt: null,
  reason: null,
  setByOpsUserId: null,
  setAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString()
};

describe('load shed guard', () => {
  beforeEach(async () => {
    vi.unstubAllEnvs();
    invalidateLoadShedProcessCache();
    invalidateMaintenanceProcessCache();
    const request = buildRequest('/api/v1/health');
    await setLoadShedMode(request as never, 'normal');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    invalidateLoadShedProcessCache();
    invalidateMaintenanceProcessCache();
  });

  it('allows always-allowed routes in emergency mode', async () => {
    vi.stubEnv('LOAD_SHED_MODE', 'emergency');
    invalidateLoadShedProcessCache();
    const request = buildRequest('/api/v1/health');

    await expect(loadShedGuard(request as never, {} as never)).resolves.toBeUndefined();
  });

  it('blocks non-critical admin routes in reduced mode', async () => {
    vi.stubEnv('LOAD_SHED_MODE', 'reduced');
    invalidateLoadShedProcessCache();
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 6000);
    const request = buildRequest('/api/v1/admin/dashboard/kpis');

    await expect(loadShedGuard(request as never, {} as never)).rejects.toBeInstanceOf(AppError);
  });

  it('blocks checkout mutations in emergency mode', async () => {
    vi.stubEnv('LOAD_SHED_MODE', 'emergency');
    invalidateLoadShedProcessCache();
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 6000);
    const request = buildRequest('/api/v1/orders', 'POST');

    await expect(loadShedGuard(request as never, {} as never)).rejects.toBeInstanceOf(AppError);
  });

  it('reads and updates load shed mode via helpers', async () => {
    const request = buildRequest('/api/v1/admin/orders', 'GET', 'reduced');

    await setLoadShedMode(request as never, 'reduced');
    const mode = await getLoadShedMode(request as never);

    expect(mode).toBe('reduced');
    expect(request.server.redis.set).toHaveBeenCalledWith('ops:load_shed:mode', 'reduced');
  });

  describe('maintenance mode', () => {
    const pendingState: MaintenanceStateRecord = {
      mode: 'maintenance',
      phase: 'pending',
      pendingUntil: new Date(Date.now() + 60_000).toISOString(),
      activatedAt: null,
      reason: 'planned',
      setByOpsUserId: 'ops-1',
      setAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const activeState: MaintenanceStateRecord = {
      ...pendingState,
      phase: 'active',
      activatedAt: new Date().toISOString()
    };

    it('blocks storefront catalogue when maintenance is active', async () => {
      const request = buildRequest('/api/v1/products/list', 'GET', null, activeState);
      invalidateLoadShedProcessCache();
      invalidateMaintenanceProcessCache();

      await expect(loadShedGuard(request as never, {} as never)).rejects.toBeInstanceOf(AppError);
    });

    it('allows ops routes when maintenance is active', async () => {
      const request = buildRequest('/api/v1/ops/load-shed', 'GET', null, activeState);
      invalidateLoadShedProcessCache();
      invalidateMaintenanceProcessCache();

      await expect(loadShedGuard(request as never, {} as never)).resolves.toBeUndefined();
    });

    it('allows /api/v1/maintenance/status when active so banner can poll', async () => {
      const request = buildRequest('/api/v1/maintenance/status', 'GET', null, activeState);
      invalidateLoadShedProcessCache();
      invalidateMaintenanceProcessCache();

      await expect(loadShedGuard(request as never, {} as never)).resolves.toBeUndefined();
    });

    it('allows webhooks during maintenance so providers can settle', async () => {
      const request = buildRequest('/api/v1/payments/webhook', 'POST', null, activeState);
      invalidateLoadShedProcessCache();
      invalidateMaintenanceProcessCache();

      await expect(loadShedGuard(request as never, {} as never)).resolves.toBeUndefined();
    });

    it('blocks new checkout mutations during pending phase', async () => {
      const request = buildRequest('/api/v1/orders', 'POST', null, pendingState);
      invalidateLoadShedProcessCache();
      invalidateMaintenanceProcessCache();

      await expect(loadShedGuard(request as never, {} as never)).rejects.toBeInstanceOf(AppError);
    });

    it('keeps payment verify reachable during pending so in-flight payments settle', async () => {
      const request = buildRequest('/api/v1/payments/verify', 'POST', null, pendingState);
      invalidateLoadShedProcessCache();
      invalidateMaintenanceProcessCache();

      await expect(loadShedGuard(request as never, {} as never)).resolves.toBeUndefined();
    });

    it('keeps payment retry reachable during pending so in-flight payments settle', async () => {
      const request = buildRequest('/api/v1/payments/retry', 'POST', null, pendingState);
      invalidateLoadShedProcessCache();
      invalidateMaintenanceProcessCache();

      await expect(loadShedGuard(request as never, {} as never)).resolves.toBeUndefined();
    });

    it('allows storefront reads during pending phase', async () => {
      // Pending = warning banner phase, the storefront still serves.
      const request = buildRequest('/api/v1/products/list', 'GET', null, pendingState);
      invalidateLoadShedProcessCache();
      invalidateMaintenanceProcessCache();

      await expect(loadShedGuard(request as never, {} as never)).resolves.toBeUndefined();
    });
  });

  describe('shouldBlockForMaintenance', () => {
    it('returns true for storefront paths under active maintenance', () => {
      const state: MaintenanceStateRecord = { ...NORMAL_STATE, mode: 'maintenance', phase: 'active' };
      expect(shouldBlockForMaintenance(state, '/products/list')).toBe(true);
      expect(shouldBlockForMaintenance(state, '/cart')).toBe(true);
      expect(shouldBlockForMaintenance(state, '/api/v1/orders')).toBe(true);
    });

    it('returns false for ops/health/webhooks/maintenance during active', () => {
      const state: MaintenanceStateRecord = { ...NORMAL_STATE, mode: 'maintenance', phase: 'active' };
      expect(shouldBlockForMaintenance(state, '/api/v1/ops/load-shed')).toBe(false);
      expect(shouldBlockForMaintenance(state, '/api/v1/health')).toBe(false);
      expect(shouldBlockForMaintenance(state, '/api/v1/payments/webhook')).toBe(false);
      expect(shouldBlockForMaintenance(state, '/api/v1/shipping/webhook')).toBe(false);
      expect(shouldBlockForMaintenance(state, '/api/v1/maintenance/status')).toBe(false);
    });

    it('returns false in pending phase (banner-only window)', () => {
      const state: MaintenanceStateRecord = {
        ...NORMAL_STATE,
        mode: 'maintenance',
        phase: 'pending',
        pendingUntil: new Date().toISOString()
      };
      expect(shouldBlockForMaintenance(state, '/products/list')).toBe(false);
    });

    it('returns false in normal mode', () => {
      expect(shouldBlockForMaintenance(NORMAL_STATE, '/products/list')).toBe(false);
    });
  });
});
