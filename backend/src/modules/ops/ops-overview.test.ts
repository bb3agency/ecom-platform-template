import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { listOpsConfigRuntimeOverlayKeys } from './ops-config-contract';
import { computeRestartPendingKeys, summarizeOpsQueues, type OpsOverviewQueueLike } from './ops-overview';
import { OpsService } from './ops.service';

function queue(name: string, counts: Record<string, number>, dlqJobs: Array<{ data?: unknown }> = []): OpsOverviewQueueLike {
  return {
    name,
    getJobCounts: vi.fn(async () => counts),
    getWaiting: vi.fn(async () => dlqJobs),
    getCompleted: vi.fn(async () => [])
  };
}

describe('computeRestartPendingKeys', () => {
  const overlayKey = listOpsConfigRuntimeOverlayKeys()[0] as string;

  it('flags a saved value the running process does not have yet', () => {
    expect(computeRestartPendingKeys([{ key: overlayKey, plaintextValue: 'new' }], { [overlayKey]: 'old' })).toEqual([overlayKey]);
    expect(computeRestartPendingKeys([{ key: overlayKey, plaintextValue: 'new' }], {})).toEqual([overlayKey]);
  });

  it('is empty once the process runs with the saved value', () => {
    expect(computeRestartPendingKeys([{ key: overlayKey, plaintextValue: 'same' }], { [overlayKey]: 'same' })).toEqual([]);
  });

  it('ignores bootstrap and unknown keys, which are never applied at runtime', () => {
    expect(
      computeRestartPendingKeys(
        [
          { key: 'DATABASE_URL', plaintextValue: 'x' },
          { key: 'NOT_A_REAL_KEY', plaintextValue: 'x' }
        ],
        {}
      )
    ).toEqual([]);
  });
});

describe('summarizeOpsQueues', () => {
  it('returns per-queue counts (excluding the DLQ) and a DLQ breakdown by source', async () => {
    const summary = await summarizeOpsQueues({
      orderProcessing: queue('order-processing', { waiting: 2, active: 1, delayed: 0, failed: 3 }),
      notifications: queue('notifications', { waiting: 0, active: 0, delayed: 4, failed: 0 }),
      deadLetter: queue('dead-letter', {}, [
        { data: { sourceQueue: 'notifications' } },
        { data: { sourceQueue: 'notifications' } },
        { data: {} }
      ])
    });

    expect(summary.items).toEqual([
      { name: 'notifications', waiting: 0, active: 0, delayed: 4, failed: 0 },
      { name: 'order-processing', waiting: 2, active: 1, delayed: 0, failed: 3 }
    ]);
    expect(summary.deadLetterTotal).toBe(3);
    expect(summary.deadLetterBySource).toEqual([
      { queue: 'notifications', count: 2 },
      { queue: 'unknown', count: 1 }
    ]);
  });

  it('reports zeros for a queue it cannot read instead of failing', async () => {
    const broken: OpsOverviewQueueLike = {
      name: 'shipping',
      getJobCounts: vi.fn(async () => {
        throw new Error('redis down');
      }),
      getWaiting: vi.fn(async () => []),
      getCompleted: vi.fn(async () => [])
    };
    const summary = await summarizeOpsQueues({ shipping: broken });
    expect(summary.items).toEqual([{ name: 'shipping', waiting: 0, active: 0, delayed: 0, failed: 0 }]);
    expect(summary.deadLetterTotal).toBe(0);
  });
});

describe('OpsService.getOpsOverview / listAuditLogs', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function harness() {
    const createdAt = new Date('2026-10-01T10:00:00.000Z');
    const auditRows = [
      {
        id: 'a1',
        requestId: 'r1',
        actionType: 'LOAD_SHED_CHANGE',
        actionStatus: 'EXECUTED',
        requestPath: '/api/v1/ops/load-shed',
        method: 'POST',
        summary: null,
        createdAt,
        opsUser: { id: 'ops_1', name: 'Asha', email: 'asha@example.com' }
      },
      {
        id: 'a2',
        requestId: 'r2',
        actionType: 'ENV_READ',
        actionStatus: 'FAILED',
        requestPath: '/api/v1/ops/config/overview',
        method: 'GET',
        summary: null,
        createdAt,
        opsUser: null
      }
    ];
    const opsUserCount = vi.fn(async (args?: { where?: { isActive?: boolean } }) => (args?.where?.isActive ? 2 : 3));
    const userCount = vi.fn(async (args: { where: { isBanned?: boolean } }) => (args.where.isBanned === false ? 1 : 2));
    const auditCount = vi.fn(async (args: { where?: { actionStatus?: string } }) => (args.where?.actionStatus === 'FAILED' ? 4 : 2));
    const auditFindMany = vi.fn(async () => auditRows);
    const otpCount = vi.fn(async () => 1);
    const fastify = {
      prisma: {
        opsUser: { count: opsUserCount },
        user: { count: userCount },
        opsUserInvite: { count: vi.fn(async () => 5) },
        adminUserInvite: { count: vi.fn(async () => 6) },
        opsOtpChallenge: { count: otpCount },
        opsAuditLog: { count: auditCount, findMany: auditFindMany },
        opsConfigSecret: { findMany: vi.fn(async () => []) }
      },
      queues: {
        shipping: queue('shipping', { waiting: 1, active: 0, delayed: 0, failed: 0 }),
        deadLetter: queue('dead-letter', {}, [{ data: { sourceQueue: 'shipping' } }])
      }
    } as unknown as FastifyInstance;
    const service = new OpsService(fastify);
    vi.spyOn(service, 'getLoadShedStatus').mockResolvedValue({
      mode: 'normal',
      phase: null,
      pendingUntil: null,
      activatedAt: null,
      reason: null
    });
    return { service, auditFindMany, otpCount, auditCount };
  }

  it('listAuditLogs returns the acting operator (or null) for each entry', async () => {
    const { service, auditFindMany } = harness();
    const result = await service.listAuditLogs({ limit: 2 });
    expect(auditFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({ opsUser: { select: { id: true, name: true, email: true } } })
      })
    );
    expect(result.items[0]?.actor).toEqual({ id: 'ops_1', name: 'Asha', email: 'asha@example.com' });
    expect(result.items[1]?.actor).toBeNull();
  });

  it('aggregates mode, config, queues, people, audit and OTP counts in one call', async () => {
    const { service, otpCount, auditCount } = harness();
    const overview = await service.getOpsOverview('ops_1');

    expect(overview.loadShed.mode).toBe('normal');
    expect(overview.config).toEqual({ runtimeProfile: 'development-like', missingRequiredKeys: [], restartPendingKeys: [] });
    expect(overview.queues.items).toEqual([{ name: 'shipping', waiting: 1, active: 0, delayed: 0, failed: 0 }]);
    expect(overview.queues.deadLetterTotal).toBe(1);
    expect(overview.people).toEqual({
      operatorsActive: 2,
      operatorsTotal: 3,
      merchantAdminsActive: 1,
      merchantAdminsTotal: 2,
      pendingOpsInvites: 5,
      pendingAdminInvites: 6
    });
    expect(overview.audit.failedLast24h).toBe(4);
    expect(overview.audit.recent).toHaveLength(2);
    expect(overview.audit.recent[0]).toEqual({
      id: 'a1',
      actionType: 'LOAD_SHED_CHANGE',
      actionStatus: 'EXECUTED',
      createdAt: '2026-10-01T10:00:00.000Z',
      actor: { id: 'ops_1', name: 'Asha', email: 'asha@example.com' }
    });
    expect(overview.pendingOtpChallenges).toBe(1);
    // OTP count is scoped to the caller; the failure count to the last 24 hours.
    expect(otpCount).toHaveBeenCalledWith({ where: expect.objectContaining({ opsUserId: 'ops_1', status: 'PENDING' }) });
    expect(auditCount).toHaveBeenCalledWith({
      where: { actionStatus: 'FAILED', createdAt: { gte: expect.any(Date) } }
    });
  });

  it('does not write an audit entry (read-only landing data)', async () => {
    const { service } = harness();
    const append = vi.spyOn(service as unknown as { appendAuditLog: () => Promise<void> }, 'appendAuditLog');
    await service.getOpsOverview('ops_1');
    expect(append).not.toHaveBeenCalled();
  });
});
