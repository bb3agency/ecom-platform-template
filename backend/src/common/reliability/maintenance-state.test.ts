import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildBullMQActivationVerifier,
  DEFAULT_MAINTENANCE_ACTIVATION_GRACE_MS,
  DEFAULT_MAINTENANCE_FAST_PROMOTE_GRACE_MS,
  invalidateMaintenanceProcessCache,
  isMaintenanceActive,
  isMaintenancePendingOrActive,
  MAINTENANCE_STATE_REDIS_KEY,
  MAINTENANCE_STATE_SINGLETON_KEY,
  maybeFastPromotePending,
  maybePromoteOverduePending,
  parseMaintenanceStateRecord,
  readMaintenanceState,
  resolveMaintenanceActivationGraceMs,
  resolveMaintenanceFastPromoteGraceMs,
  wrapVerifierWithTimeout,
  writeMaintenanceState,
  type ActivationJobStatus,
  type MaintenanceStatePrismaLike,
  type MaintenanceStateRecord,
  type MaintenanceStateRedisLike,
  type VerifyActivationJobExists
} from './maintenance-state';

type Row = {
  mode: string;
  phase: string | null;
  pendingUntil: Date | null;
  activatedAt: Date | null;
  reason: string | null;
  setByOpsUserId: string | null;
  setAt: Date;
  updatedAt: Date;
} | null;

interface PrismaHarness {
  prisma: MaintenanceStatePrismaLike;
  findUnique: ReturnType<typeof vi.fn>;
  upsert: ReturnType<typeof vi.fn>;
  getRow: () => Row;
}

function buildPrisma(initialRow: Row): PrismaHarness {
  let row: Row = initialRow;
  const findUnique = vi.fn(async () => row);
  const upsert = vi.fn(async (args: { create: Record<string, unknown>; update: Record<string, unknown> }) => {
    const data = row ? args.update : args.create;
    row = {
      mode: (data.mode as string) ?? row?.mode ?? 'normal',
      phase: (data.phase as string | null) ?? null,
      pendingUntil: (data.pendingUntil as Date | null) ?? null,
      activatedAt: (data.activatedAt as Date | null) ?? null,
      reason: (data.reason as string | null) ?? null,
      setByOpsUserId: (data.setByOpsUserId as string | null) ?? null,
      setAt: (data.setAt as Date) ?? new Date(),
      updatedAt: new Date()
    };
    return row;
  });
  return {
    prisma: { maintenanceState: { findUnique, upsert } } as unknown as MaintenanceStatePrismaLike,
    findUnique,
    upsert,
    getRow: () => row
  };
}

interface RedisHarness {
  redis: MaintenanceStateRedisLike;
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  getValue: () => string | null;
}

function buildRedis(initialValue: string | null = null): RedisHarness {
  let value = initialValue;
  const get = vi.fn(async (key: string) => (key === MAINTENANCE_STATE_REDIS_KEY ? value : null));
  const set = vi.fn(async (_key: string, v: string) => {
    value = v;
    return 'OK';
  });
  return {
    redis: { get, set } as unknown as MaintenanceStateRedisLike,
    get,
    set,
    getValue: () => value
  };
}

describe('maintenance-state helpers', () => {
  beforeEach(() => {
    invalidateMaintenanceProcessCache();
  });

  afterEach(() => {
    invalidateMaintenanceProcessCache();
    vi.restoreAllMocks();
  });

  it('returns default normal state when DB row is missing', async () => {
    const p = buildPrisma(null);
    const r = buildRedis(null);
    const state = await readMaintenanceState({ prisma: p.prisma, redis: r.redis });
    expect(state.mode).toBe('normal');
    expect(state.phase).toBeNull();
  });

  it('reads from DB when Redis cache is empty', async () => {
    const p = buildPrisma({
      mode: 'maintenance',
      phase: 'pending',
      pendingUntil: new Date('2030-01-01T00:00:00Z'),
      activatedAt: null,
      reason: 'planned',
      setByOpsUserId: 'ops-1',
      setAt: new Date('2030-01-01T00:00:00Z'),
      updatedAt: new Date('2030-01-01T00:00:00Z')
    });
    const r = buildRedis(null);
    const state = await readMaintenanceState({ prisma: p.prisma, redis: r.redis });
    expect(state.mode).toBe('maintenance');
    expect(state.phase).toBe('pending');
  });

  it('warms Redis cache on first read', async () => {
    const p = buildPrisma({
      mode: 'maintenance',
      phase: 'active',
      pendingUntil: null,
      activatedAt: new Date(),
      reason: null,
      setByOpsUserId: null,
      setAt: new Date(),
      updatedAt: new Date()
    });
    const r = buildRedis(null);
    await readMaintenanceState({ prisma: p.prisma, redis: r.redis });
    expect(r.set).toHaveBeenCalled();
    expect(r.getValue()).toContain('"mode":"maintenance"');
  });

  it('serves from Redis cache when present (DB never consulted)', async () => {
    const p = buildPrisma({
      mode: 'normal',
      phase: null,
      pendingUntil: null,
      activatedAt: null,
      reason: null,
      setByOpsUserId: null,
      setAt: new Date(),
      updatedAt: new Date()
    });
    const cachedRecord: MaintenanceStateRecord = {
      mode: 'maintenance',
      phase: 'active',
      pendingUntil: null,
      activatedAt: new Date().toISOString(),
      reason: null,
      setByOpsUserId: null,
      setAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const r = buildRedis(JSON.stringify(cachedRecord));
    const state = await readMaintenanceState({ prisma: p.prisma, redis: r.redis });
    expect(state.mode).toBe('maintenance');
    expect(state.phase).toBe('active');
    expect(p.findUnique).not.toHaveBeenCalled();
  });

  it('survives Redis loss by re-reading from DB (no exception)', async () => {
    const p = buildPrisma({
      mode: 'maintenance',
      phase: 'active',
      pendingUntil: null,
      activatedAt: new Date(),
      reason: 'persistent',
      setByOpsUserId: 'ops-2',
      setAt: new Date(),
      updatedAt: new Date()
    });
    const redis: MaintenanceStateRedisLike = {
      get: vi.fn(async () => { throw new Error('redis offline'); }),
      set: vi.fn(async () => { throw new Error('redis offline'); })
    };
    const state = await readMaintenanceState({ prisma: p.prisma, redis });
    expect(state.mode).toBe('maintenance');
    expect(state.phase).toBe('active');
  });

  it('writes Postgres + Redis on writeMaintenanceState', async () => {
    const p = buildPrisma(null);
    const r = buildRedis(null);
    await writeMaintenanceState({
      prisma: p.prisma,
      redis: r.redis,
      record: {
        mode: 'maintenance',
        phase: 'pending',
        pendingUntil: '2030-01-01T00:02:00Z',
        activatedAt: null,
        reason: 'planned downtime',
        setByOpsUserId: 'ops-3',
        setAt: '2030-01-01T00:00:00Z'
      }
    });
    expect(p.upsert).toHaveBeenCalledTimes(1);
    expect(r.getValue()).toContain('"mode":"maintenance"');
    expect(r.getValue()).toContain('"phase":"pending"');
  });

  it('clears phase/pendingUntil when exiting maintenance', async () => {
    const p = buildPrisma({
      mode: 'maintenance',
      phase: 'active',
      pendingUntil: new Date(),
      activatedAt: new Date(),
      reason: 'previous',
      setByOpsUserId: 'ops-1',
      setAt: new Date(),
      updatedAt: new Date()
    });
    const r = buildRedis(null);
    const record = await writeMaintenanceState({
      prisma: p.prisma,
      redis: r.redis,
      record: {
        mode: 'normal',
        phase: null,
        pendingUntil: null,
        activatedAt: null,
        reason: 'exit',
        setByOpsUserId: 'ops-1',
        setAt: new Date().toISOString()
      }
    });
    expect(record.mode).toBe('normal');
    expect(record.phase).toBeNull();
    expect(record.pendingUntil).toBeNull();
    expect(record.activatedAt).toBeNull();
  });

  describe('parseMaintenanceStateRecord', () => {
    it('returns null for non-object input', () => {
      expect(parseMaintenanceStateRecord(null)).toBeNull();
      expect(parseMaintenanceStateRecord('string')).toBeNull();
      expect(parseMaintenanceStateRecord(42)).toBeNull();
    });

    it('returns null for invalid mode', () => {
      expect(parseMaintenanceStateRecord({
        mode: 'bogus',
        phase: null,
        setAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      })).toBeNull();
    });

    it('returns parsed record for valid input', () => {
      const result = parseMaintenanceStateRecord({
        mode: 'maintenance',
        phase: 'pending',
        pendingUntil: '2030-01-01T00:02:00Z',
        activatedAt: null,
        reason: 'planned',
        setByOpsUserId: 'ops-1',
        setAt: '2030-01-01T00:00:00Z',
        updatedAt: '2030-01-01T00:00:00Z'
      });
      expect(result).not.toBeNull();
      expect(result?.mode).toBe('maintenance');
      expect(result?.phase).toBe('pending');
    });

    it('normalizes unknown phase to null', () => {
      const result = parseMaintenanceStateRecord({
        mode: 'maintenance',
        phase: 'someothervalue',
        setAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      expect(result?.phase).toBeNull();
    });
  });

  describe('predicates', () => {
    const baseState: MaintenanceStateRecord = {
      mode: 'normal',
      phase: null,
      pendingUntil: null,
      activatedAt: null,
      reason: null,
      setByOpsUserId: null,
      setAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    it('isMaintenanceActive returns true only for maintenance + active', () => {
      expect(isMaintenanceActive(baseState)).toBe(false);
      expect(isMaintenanceActive({ ...baseState, mode: 'maintenance', phase: 'pending' })).toBe(false);
      expect(isMaintenanceActive({ ...baseState, mode: 'maintenance', phase: 'active' })).toBe(true);
    });

    it('isMaintenancePendingOrActive covers both phases', () => {
      expect(isMaintenancePendingOrActive(baseState)).toBe(false);
      expect(isMaintenancePendingOrActive({ ...baseState, mode: 'maintenance', phase: 'pending' })).toBe(true);
      expect(isMaintenancePendingOrActive({ ...baseState, mode: 'maintenance', phase: 'active' })).toBe(true);
    });
  });

  it('uses singleton key on every DB call', async () => {
    const p = buildPrisma(null);
    const r = buildRedis(null);
    await readMaintenanceState({ prisma: p.prisma, redis: r.redis });
    expect(p.findUnique).toHaveBeenCalledWith({
      where: { singletonKey: MAINTENANCE_STATE_SINGLETON_KEY }
    });
  });

  // ── Self-heal / read-side promotion ─────────────────────────────────────
  // These tests cover the silent-failure recovery path: if the
  // `maintenance-activation` worker job fails to flip `pending` → `active`
  // (because the worker container ran an old build, the job was lost on a
  // Redis flush, or the cutover threw), the next read of the state must
  // self-heal so the storefront isn't left accessible indefinitely.
  describe('read-side self-heal for stuck pending state', () => {
    const baseRecord: MaintenanceStateRecord = {
      mode: 'maintenance',
      phase: 'pending',
      pendingUntil: '2030-01-01T00:02:00Z',
      activatedAt: null,
      reason: 'planned',
      setByOpsUserId: 'ops-1',
      setAt: '2030-01-01T00:00:00Z',
      updatedAt: '2030-01-01T00:00:00Z'
    };

    it('maybePromoteOverduePending leaves record alone when still inside grace window', () => {
      const pendingUntilMs = Date.parse(baseRecord.pendingUntil!);
      const insideGrace = pendingUntilMs + DEFAULT_MAINTENANCE_ACTIVATION_GRACE_MS - 1;
      const result = maybePromoteOverduePending(baseRecord, insideGrace);
      expect(result).toBe(baseRecord);
      expect(result.phase).toBe('pending');
    });

    it('maybePromoteOverduePending promotes to active when past grace boundary', () => {
      const pendingUntilMs = Date.parse(baseRecord.pendingUntil!);
      const pastGrace = pendingUntilMs + DEFAULT_MAINTENANCE_ACTIVATION_GRACE_MS + 1;
      const result = maybePromoteOverduePending(baseRecord, pastGrace);
      expect(result).not.toBe(baseRecord);
      expect(result.phase).toBe('active');
      expect(result.activatedAt).toBe(new Date(pastGrace).toISOString());
    });

    it('maybePromoteOverduePending preserves existing activatedAt if already set', () => {
      const pendingUntilMs = Date.parse(baseRecord.pendingUntil!);
      const recordWithActivatedAt = { ...baseRecord, activatedAt: '2030-01-01T00:05:00Z' };
      const pastGrace = pendingUntilMs + DEFAULT_MAINTENANCE_ACTIVATION_GRACE_MS + 1;
      const result = maybePromoteOverduePending(recordWithActivatedAt, pastGrace);
      expect(result.phase).toBe('active');
      expect(result.activatedAt).toBe('2030-01-01T00:05:00Z');
    });

    it('maybePromoteOverduePending is a no-op when mode is not maintenance', () => {
      const normalRecord: MaintenanceStateRecord = { ...baseRecord, mode: 'normal', phase: null };
      const future = Date.now() + 24 * 60 * 60 * 1000;
      expect(maybePromoteOverduePending(normalRecord, future)).toBe(normalRecord);
    });

    it('maybePromoteOverduePending is a no-op when phase is already active', () => {
      const activeRecord: MaintenanceStateRecord = { ...baseRecord, phase: 'active', activatedAt: '2030-01-01T00:01:00Z' };
      const future = Date.now() + 24 * 60 * 60 * 1000;
      expect(maybePromoteOverduePending(activeRecord, future)).toBe(activeRecord);
    });

    it('maybePromoteOverduePending is a no-op when pendingUntil is missing or malformed', () => {
      const malformed: MaintenanceStateRecord = { ...baseRecord, pendingUntil: 'not-a-date' };
      const future = Date.now() + 24 * 60 * 60 * 1000;
      expect(maybePromoteOverduePending(malformed, future)).toBe(malformed);

      const nullPending: MaintenanceStateRecord = { ...baseRecord, pendingUntil: null };
      expect(maybePromoteOverduePending(nullPending, future)).toBe(nullPending);
    });

    it('readMaintenanceState auto-promotes stuck pending row from DB and persists the change', async () => {
      const pendingUntilDate = new Date('2030-01-01T00:02:00Z');
      const p = buildPrisma({
        mode: 'maintenance',
        phase: 'pending',
        pendingUntil: pendingUntilDate,
        activatedAt: null,
        reason: 'planned',
        setByOpsUserId: 'ops-1',
        setAt: new Date('2030-01-01T00:00:00Z'),
        updatedAt: new Date('2030-01-01T00:00:00Z')
      });
      const r = buildRedis(null);
      const farPast = pendingUntilDate.getTime() + DEFAULT_MAINTENANCE_ACTIVATION_GRACE_MS + 60_000;
      const state = await readMaintenanceState({
        prisma: p.prisma,
        redis: r.redis,
        now: () => farPast
      });
      expect(state.mode).toBe('maintenance');
      expect(state.phase).toBe('active');
      // Source-of-truth write happened so other replicas see active too.
      expect(p.upsert).toHaveBeenCalledTimes(1);
      const upsertedRow = p.getRow();
      expect(upsertedRow?.phase).toBe('active');
      // Redis cache reflects the promotion.
      expect(r.getValue()).toContain('"phase":"active"');
    });

    it('readMaintenanceState auto-promotes stuck pending row from Redis cache', async () => {
      const pendingUntilIso = '2030-01-01T00:02:00Z';
      const cached: MaintenanceStateRecord = {
        ...baseRecord,
        pendingUntil: pendingUntilIso
      };
      const p = buildPrisma(null);
      const r = buildRedis(JSON.stringify(cached));
      const farPast = Date.parse(pendingUntilIso) + DEFAULT_MAINTENANCE_ACTIVATION_GRACE_MS + 60_000;
      const state = await readMaintenanceState({
        prisma: p.prisma,
        redis: r.redis,
        now: () => farPast
      });
      expect(state.phase).toBe('active');
      expect(state.activatedAt).toBe(new Date(farPast).toISOString());
    });

    it('readMaintenanceState does NOT promote when within grace window', async () => {
      const pendingUntilDate = new Date('2030-01-01T00:02:00Z');
      const p = buildPrisma({
        mode: 'maintenance',
        phase: 'pending',
        pendingUntil: pendingUntilDate,
        activatedAt: null,
        reason: null,
        setByOpsUserId: 'ops-1',
        setAt: new Date('2030-01-01T00:00:00Z'),
        updatedAt: new Date('2030-01-01T00:00:00Z')
      });
      const r = buildRedis(null);
      // 30 seconds past pendingUntil — well inside the grace.
      const insideGrace = pendingUntilDate.getTime() + 30_000;
      const state = await readMaintenanceState({
        prisma: p.prisma,
        redis: r.redis,
        now: () => insideGrace
      });
      expect(state.phase).toBe('pending');
      expect(p.upsert).not.toHaveBeenCalled();
    });

    it('readMaintenanceState falls back to cache write when DB upsert during self-heal fails', async () => {
      const pendingUntilIso = '2030-01-01T00:02:00Z';
      const cached: MaintenanceStateRecord = {
        ...baseRecord,
        pendingUntil: pendingUntilIso
      };
      const failingUpsert = vi.fn(async () => {
        throw new Error('DB temporarily unavailable');
      });
      const findUnique = vi.fn(async () => null);
      const prisma = {
        maintenanceState: { findUnique, upsert: failingUpsert }
      } as unknown as MaintenanceStatePrismaLike;
      const r = buildRedis(JSON.stringify(cached));
      const farPast = Date.parse(pendingUntilIso) + DEFAULT_MAINTENANCE_ACTIVATION_GRACE_MS + 60_000;
      const state = await readMaintenanceState({
        prisma,
        redis: r.redis,
        now: () => farPast
      });
      // Even with DB write failure the returned record is promoted, so the
      // local guard immediately blocks traffic instead of waiting for DB.
      expect(state.phase).toBe('active');
      // Cache still gets the new value as a fallback so subsequent reads
      // converge on active too.
      expect(r.getValue()).toContain('"phase":"active"');
    });
  });

  describe('resolveMaintenanceActivationGraceMs', () => {
    const savedEnv = process.env['MAINTENANCE_ACTIVATION_GRACE_MS'];

    afterEach(() => {
      if (savedEnv === undefined) {
        delete process.env['MAINTENANCE_ACTIVATION_GRACE_MS'];
      } else {
        process.env['MAINTENANCE_ACTIVATION_GRACE_MS'] = savedEnv;
      }
    });

    it('returns default when env var is unset', () => {
      delete process.env['MAINTENANCE_ACTIVATION_GRACE_MS'];
      expect(resolveMaintenanceActivationGraceMs()).toBe(DEFAULT_MAINTENANCE_ACTIVATION_GRACE_MS);
    });

    it('honours a positive numeric override', () => {
      process.env['MAINTENANCE_ACTIVATION_GRACE_MS'] = '60000';
      expect(resolveMaintenanceActivationGraceMs()).toBe(60_000);
    });

    it('falls back to default for non-numeric or negative values', () => {
      process.env['MAINTENANCE_ACTIVATION_GRACE_MS'] = 'abc';
      expect(resolveMaintenanceActivationGraceMs()).toBe(DEFAULT_MAINTENANCE_ACTIVATION_GRACE_MS);
      process.env['MAINTENANCE_ACTIVATION_GRACE_MS'] = '-100';
      expect(resolveMaintenanceActivationGraceMs()).toBe(DEFAULT_MAINTENANCE_ACTIVATION_GRACE_MS);
    });

    it('accepts 0 as a valid override (immediate promotion)', () => {
      process.env['MAINTENANCE_ACTIVATION_GRACE_MS'] = '0';
      expect(resolveMaintenanceActivationGraceMs()).toBe(0);
    });
  });

  describe('BullMQ-aware fast-promote (post-2026-05-26 fix)', () => {
    const baseRecord: MaintenanceStateRecord = {
      mode: 'maintenance',
      phase: 'pending',
      pendingUntil: '2030-01-01T00:02:00Z',
      activatedAt: null,
      reason: 'planned',
      setByOpsUserId: 'ops-1',
      setAt: '2030-01-01T00:00:00Z',
      updatedAt: '2030-01-01T00:00:00Z'
    };

    describe('maybeFastPromotePending', () => {
      it('promotes when status=missing and past short grace', () => {
        const pendingUntilMs = Date.parse(baseRecord.pendingUntil!);
        const past = pendingUntilMs + DEFAULT_MAINTENANCE_FAST_PROMOTE_GRACE_MS + 1;
        const result = maybeFastPromotePending(baseRecord, past, 'missing');
        expect(result).not.toBe(baseRecord);
        expect(result.phase).toBe('active');
      });

      it('does NOT promote when status=present (worker healthy and on it)', () => {
        const pendingUntilMs = Date.parse(baseRecord.pendingUntil!);
        const past = pendingUntilMs + DEFAULT_MAINTENANCE_FAST_PROMOTE_GRACE_MS + 60_000;
        const result = maybeFastPromotePending(baseRecord, past, 'present');
        expect(result).toBe(baseRecord);
        expect(result.phase).toBe('pending');
      });

      it('does NOT promote when status=unknown (probe failed)', () => {
        const pendingUntilMs = Date.parse(baseRecord.pendingUntil!);
        const past = pendingUntilMs + DEFAULT_MAINTENANCE_FAST_PROMOTE_GRACE_MS + 60_000;
        const result = maybeFastPromotePending(baseRecord, past, 'unknown');
        expect(result).toBe(baseRecord);
      });

      it('does NOT promote when still inside the fast-promote grace', () => {
        const pendingUntilMs = Date.parse(baseRecord.pendingUntil!);
        const insideGrace = pendingUntilMs + DEFAULT_MAINTENANCE_FAST_PROMOTE_GRACE_MS - 1;
        const result = maybeFastPromotePending(baseRecord, insideGrace, 'missing');
        expect(result).toBe(baseRecord);
      });

      it('is a no-op when mode is not maintenance even if status=missing', () => {
        const normalRecord: MaintenanceStateRecord = { ...baseRecord, mode: 'normal', phase: null };
        const future = Date.now() + 24 * 60 * 60 * 1000;
        expect(maybeFastPromotePending(normalRecord, future, 'missing')).toBe(normalRecord);
      });

      it('is a no-op when phase is already active', () => {
        const activeRecord: MaintenanceStateRecord = {
          ...baseRecord,
          phase: 'active',
          activatedAt: '2030-01-01T00:01:00Z'
        };
        const future = Date.now() + 24 * 60 * 60 * 1000;
        expect(maybeFastPromotePending(activeRecord, future, 'missing')).toBe(activeRecord);
      });
    });

    describe('readMaintenanceState integration with verifier', () => {
      const justPastFastGrace = (pendingUntil: string) =>
        Date.parse(pendingUntil) + DEFAULT_MAINTENANCE_FAST_PROMOTE_GRACE_MS + 1_000;

      it('promotes immediately when verifier reports missing and past fast grace', async () => {
        const pendingUntilDate = new Date('2030-01-01T00:02:00Z');
        const p = buildPrisma({
          mode: 'maintenance',
          phase: 'pending',
          pendingUntil: pendingUntilDate,
          activatedAt: null,
          reason: 'planned',
          setByOpsUserId: 'ops-1',
          setAt: new Date('2030-01-01T00:00:00Z'),
          updatedAt: new Date('2030-01-01T00:00:00Z')
        });
        const r = buildRedis(null);
        const now = justPastFastGrace(pendingUntilDate.toISOString());
        const verifier: VerifyActivationJobExists = vi.fn(
          async (): Promise<ActivationJobStatus> => 'missing'
        );
        const state = await readMaintenanceState({
          prisma: p.prisma,
          redis: r.redis,
          now: () => now,
          verifyActivationJob: verifier
        });
        expect(verifier).toHaveBeenCalledTimes(1);
        expect(state.phase).toBe('active');
        // Promotion is persisted to DB so other replicas converge.
        expect(p.upsert).toHaveBeenCalledTimes(1);
      });

      it('does NOT promote when verifier reports present (worker mid-drain)', async () => {
        const pendingUntilDate = new Date('2030-01-01T00:02:00Z');
        const p = buildPrisma({
          mode: 'maintenance',
          phase: 'pending',
          pendingUntil: pendingUntilDate,
          activatedAt: null,
          reason: null,
          setByOpsUserId: 'ops-1',
          setAt: new Date('2030-01-01T00:00:00Z'),
          updatedAt: new Date('2030-01-01T00:00:00Z')
        });
        const r = buildRedis(null);
        // Past the fast-promote grace but well inside the long grace.
        const now = justPastFastGrace(pendingUntilDate.toISOString());
        const verifier: VerifyActivationJobExists = vi.fn(
          async (): Promise<ActivationJobStatus> => 'present'
        );
        const state = await readMaintenanceState({
          prisma: p.prisma,
          redis: r.redis,
          now: () => now,
          verifyActivationJob: verifier
        });
        expect(verifier).toHaveBeenCalledTimes(1);
        expect(state.phase).toBe('pending');
        // No promotion persisted — verifier correctly held off.
        expect(p.upsert).not.toHaveBeenCalled();
      });

      it('falls back to long grace when verifier reports unknown (probe failure)', async () => {
        const pendingUntilDate = new Date('2030-01-01T00:02:00Z');
        const p = buildPrisma({
          mode: 'maintenance',
          phase: 'pending',
          pendingUntil: pendingUntilDate,
          activatedAt: null,
          reason: null,
          setByOpsUserId: 'ops-1',
          setAt: new Date('2030-01-01T00:00:00Z'),
          updatedAt: new Date('2030-01-01T00:00:00Z')
        });
        const r = buildRedis(null);
        const now = justPastFastGrace(pendingUntilDate.toISOString());
        const verifier: VerifyActivationJobExists = vi.fn(
          async (): Promise<ActivationJobStatus> => 'unknown'
        );
        const state = await readMaintenanceState({
          prisma: p.prisma,
          redis: r.redis,
          now: () => now,
          verifyActivationJob: verifier
        });
        // Verifier was unhelpful; we are inside the long grace so phase stays pending.
        expect(state.phase).toBe('pending');
        expect(p.upsert).not.toHaveBeenCalled();
      });

      it('falls back to long grace when verifier throws', async () => {
        const pendingUntilDate = new Date('2030-01-01T00:02:00Z');
        const p = buildPrisma({
          mode: 'maintenance',
          phase: 'pending',
          pendingUntil: pendingUntilDate,
          activatedAt: null,
          reason: null,
          setByOpsUserId: 'ops-1',
          setAt: new Date('2030-01-01T00:00:00Z'),
          updatedAt: new Date('2030-01-01T00:00:00Z')
        });
        const r = buildRedis(null);
        const now = justPastFastGrace(pendingUntilDate.toISOString());
        const verifier: VerifyActivationJobExists = vi.fn(async () => {
          throw new Error('Redis unreachable');
        });
        const state = await readMaintenanceState({
          prisma: p.prisma,
          redis: r.redis,
          now: () => now,
          verifyActivationJob: verifier
        });
        expect(state.phase).toBe('pending');
      });

      it('does not call the verifier when state is still pending but inside fast-promote grace', async () => {
        const pendingUntilDate = new Date('2030-01-01T00:02:00Z');
        const p = buildPrisma({
          mode: 'maintenance',
          phase: 'pending',
          pendingUntil: pendingUntilDate,
          activatedAt: null,
          reason: null,
          setByOpsUserId: 'ops-1',
          setAt: new Date('2030-01-01T00:00:00Z'),
          updatedAt: new Date('2030-01-01T00:00:00Z')
        });
        const r = buildRedis(null);
        // 5s past pendingUntil — well inside the 15s fast grace.
        const now = pendingUntilDate.getTime() + 5_000;
        const verifier: VerifyActivationJobExists = vi.fn(
          async (): Promise<ActivationJobStatus> => 'missing'
        );
        const state = await readMaintenanceState({
          prisma: p.prisma,
          redis: r.redis,
          now: () => now,
          verifyActivationJob: verifier
        });
        expect(verifier).not.toHaveBeenCalled();
        expect(state.phase).toBe('pending');
      });
    });

    describe('buildBullMQActivationVerifier', () => {
      it('reports present when the queue has a maintenance-activation job for this window', async () => {
        const setAtMs = Date.parse(baseRecord.setAt);
        const fakeQueue = {
          getJobs: vi.fn(async () => [
            { name: 'maintenance-activation', timestamp: setAtMs + 100 }
          ])
        };
        const verifier = buildBullMQActivationVerifier(fakeQueue);
        const status = await verifier(baseRecord);
        expect(status).toBe('present');
      });

      it('reports missing when the queue has no matching job', async () => {
        const fakeQueue = {
          getJobs: vi.fn(async () => [
            { name: 'other-job', timestamp: Date.now() }
          ])
        };
        const verifier = buildBullMQActivationVerifier(fakeQueue);
        const status = await verifier(baseRecord);
        expect(status).toBe('missing');
      });

      it('reports missing when the only matching job is too old (stale from prior cycle)', async () => {
        const setAtMs = Date.parse(baseRecord.setAt);
        const fakeQueue = {
          getJobs: vi.fn(async () => [
            // 10 minutes BEFORE this cycle's setAt — clearly from a prior maintenance.
            { name: 'maintenance-activation', timestamp: setAtMs - 10 * 60 * 1000 }
          ])
        };
        const verifier = buildBullMQActivationVerifier(fakeQueue);
        const status = await verifier(baseRecord);
        expect(status).toBe('missing');
      });

      it('uses processedOn fallback when timestamp is absent', async () => {
        const setAtMs = Date.parse(baseRecord.setAt);
        const fakeQueue = {
          getJobs: vi.fn(async () => [
            { name: 'maintenance-activation', processedOn: setAtMs + 1_000 }
          ])
        };
        const verifier = buildBullMQActivationVerifier(fakeQueue);
        const status = await verifier(baseRecord);
        expect(status).toBe('present');
      });

      it('reports unknown when setAt is malformed', async () => {
        const fakeQueue = { getJobs: vi.fn(async () => []) };
        const verifier = buildBullMQActivationVerifier(fakeQueue);
        const status = await verifier({ ...baseRecord, setAt: 'not-a-date' });
        expect(status).toBe('unknown');
        // Avoid expensive Redis call when we can't even compare timestamps.
        expect(fakeQueue.getJobs).not.toHaveBeenCalled();
      });
    });

    describe('wrapVerifierWithTimeout', () => {
      it('returns the inner verifier result when within timeout', async () => {
        const inner: VerifyActivationJobExists = vi.fn(
          async (): Promise<ActivationJobStatus> => 'present'
        );
        const wrapped = wrapVerifierWithTimeout(inner, 1_000);
        const status = await wrapped(baseRecord);
        expect(status).toBe('present');
      });

      it('returns unknown when the inner verifier exceeds the timeout', async () => {
        const inner: VerifyActivationJobExists = vi.fn(
          () =>
            new Promise<ActivationJobStatus>((resolve) => {
              // Will never resolve within the test's tight timeout.
              setTimeout(() => resolve('present'), 5_000);
            })
        );
        const wrapped = wrapVerifierWithTimeout(inner, 20);
        const status = await wrapped(baseRecord);
        expect(status).toBe('unknown');
      });

      it('returns unknown when the inner verifier throws', async () => {
        const inner: VerifyActivationJobExists = vi.fn(
          async (): Promise<ActivationJobStatus> => {
            throw new Error('boom');
          }
        );
        const wrapped = wrapVerifierWithTimeout(inner, 1_000);
        const status = await wrapped(baseRecord);
        expect(status).toBe('unknown');
      });
    });

    describe('resolveMaintenanceFastPromoteGraceMs', () => {
      const savedEnv = process.env['MAINTENANCE_FAST_PROMOTE_GRACE_MS'];

      afterEach(() => {
        if (savedEnv === undefined) {
          delete process.env['MAINTENANCE_FAST_PROMOTE_GRACE_MS'];
        } else {
          process.env['MAINTENANCE_FAST_PROMOTE_GRACE_MS'] = savedEnv;
        }
      });

      it('returns default when env var is unset', () => {
        delete process.env['MAINTENANCE_FAST_PROMOTE_GRACE_MS'];
        expect(resolveMaintenanceFastPromoteGraceMs()).toBe(DEFAULT_MAINTENANCE_FAST_PROMOTE_GRACE_MS);
      });

      it('honours a positive numeric override', () => {
        process.env['MAINTENANCE_FAST_PROMOTE_GRACE_MS'] = '5000';
        expect(resolveMaintenanceFastPromoteGraceMs()).toBe(5_000);
      });

      it('falls back to default for non-numeric or negative values', () => {
        process.env['MAINTENANCE_FAST_PROMOTE_GRACE_MS'] = 'abc';
        expect(resolveMaintenanceFastPromoteGraceMs()).toBe(DEFAULT_MAINTENANCE_FAST_PROMOTE_GRACE_MS);
        process.env['MAINTENANCE_FAST_PROMOTE_GRACE_MS'] = '-100';
        expect(resolveMaintenanceFastPromoteGraceMs()).toBe(DEFAULT_MAINTENANCE_FAST_PROMOTE_GRACE_MS);
      });
    });
  });
});
