import type { FastifyInstance } from 'fastify';
import { CouponType, Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CouponsService } from './coupons.service';

const logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn() };

function buildCoupon(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'coupon-1',
    code: 'AUDIT10',
    type: CouponType.PERCENTAGE_OFF,
    value: 10,
    minOrderPaise: 0,
    maxUsesTotal: null,
    maxUsesPerUser: null,
    usesCount: 0,
    isActive: true,
    validFrom: new Date('2026-01-01T00:00:00.000Z'),
    validUntil: null,
    applicableTo: Prisma.JsonNull,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    deletedAt: null,
    deletedBy: null,
    createdBy: 'admin-1',
    updatedBy: null,
    ...overrides
  };
}

function buildFastify(previousChainHash: string | null = null) {
  const created = buildCoupon();
  return {
    prisma: {
      coupon: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue(created),
        findUnique: vi.fn().mockResolvedValue(created),
        update: vi.fn().mockResolvedValue(buildCoupon({ value: 20, updatedBy: 'admin-2' }))
      },
      couponAuditLog: {
        findFirst: vi.fn().mockResolvedValue(previousChainHash ? { chainHash: previousChainHash } : null),
        create: vi.fn().mockResolvedValue({})
      }
    },
    redis: {
      set: vi.fn().mockResolvedValue('OK'),
      eval: vi.fn().mockResolvedValue(1)
    },
    log: logger
  } as unknown as FastifyInstance;
}

describe('CouponsService audit trail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    CouponsService.cleanup();
  });

  it('creates a tamper-evident genesis audit record on coupon creation', async () => {
    const fastify = buildFastify();
    const service = CouponsService.getInstance(fastify);

    await service.adminCreateCoupon(
      { code: 'AUDIT10', type: CouponType.PERCENTAGE_OFF, value: 10, validFrom: '2026-01-01T00:00:00.000Z' },
      'admin-1'
    );

    expect(fastify.prisma.couponAuditLog.findFirst).toHaveBeenCalledWith({
      where: { couponId: 'coupon-1' },
      orderBy: { createdAt: 'desc' },
      select: { chainHash: true }
    });
    expect(fastify.prisma.couponAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        previousChainHash: 'GENESIS',
        chainHash: expect.stringMatching(/^[a-f0-9]{64}$/)
      })
    });
  });

  it('links subsequent audit records to the previous chain hash', async () => {
    const fastify = buildFastify('previous-hash');
    const service = CouponsService.getInstance(fastify);

    await service.adminUpdateCoupon('coupon-1', { value: 20 }, 'admin-2');

    expect(fastify.prisma.couponAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        previousChainHash: 'previous-hash',
        chainHash: expect.stringMatching(/^[a-f0-9]{64}$/)
      })
    });
  });
});
