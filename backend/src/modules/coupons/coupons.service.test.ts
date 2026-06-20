import type { FastifyInstance } from 'fastify';
import { CouponType, Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CouponsService } from './coupons.service';

const mockLogger = {
  warn: vi.fn(),
  info: vi.fn(),
  error: vi.fn()
};

function createMockFastify(overrides: {
  couponFindMany?: unknown[];
  couponCount?: number;
  couponCreate?: unknown;
  couponFindUnique?: unknown;
  couponFindFirst?: unknown;
  couponUpdate?: unknown;
  auditLogCreate?: unknown;
  userFindMany?: unknown[];
} = {}) {
  return {
    prisma: {
      coupon: {
        findMany: vi.fn().mockResolvedValue(overrides.couponFindMany ?? []),
        count: vi.fn().mockResolvedValue(overrides.couponCount ?? 0),
        create: vi.fn().mockResolvedValue(overrides.couponCreate ?? {}),
        findUnique: vi.fn().mockResolvedValue(overrides.couponFindUnique ?? null),
        findFirst: vi.fn().mockResolvedValue(overrides.couponFindFirst ?? null),
        update: vi.fn().mockResolvedValue(overrides.couponUpdate ?? {})
      },
      couponAuditLog: {
        create: vi.fn().mockResolvedValue(overrides.auditLogCreate ?? {}),
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0)
      },
      user: {
        findMany: vi.fn().mockResolvedValue(overrides.userFindMany ?? [])
      },
      $transaction: vi.fn((promises) => Promise.all(promises))
    },
    redis: {
      set: vi.fn().mockResolvedValue('OK'),
      eval: vi.fn().mockResolvedValue(1)
    },
    log: mockLogger
  } as unknown as FastifyInstance;
}

describe('CouponsService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    CouponsService.cleanup();
  });

  describe('Singleton Pattern & Memory Management', () => {
    it('returns same instance for multiple getInstance calls', () => {
      const fastify = createMockFastify();
      const instance1 = CouponsService.getInstance(fastify);
      const instance2 = CouponsService.getInstance(fastify);
      expect(instance1).toBe(instance2);
    });

    it('clears cache on cleanup', () => {
      const fastify = createMockFastify();
      const service = CouponsService.getInstance(fastify);
      CouponsService.cleanup();
      const newService = CouponsService.getInstance(fastify);
      expect(service).not.toBe(newService);
    });

    it('prevents memory leaks by using singleton instead of per-request instantiation', () => {
      const fastify = createMockFastify();
      const instances: CouponsService[] = [];

      for (let i = 0; i < 100; i++) {
        instances.push(CouponsService.getInstance(fastify));
      }

      const uniqueInstances = new Set(instances);
      expect(uniqueInstances.size).toBe(1);
    });
  });

  describe('Soft Delete Functionality', () => {
    it('soft deletes coupon instead of hard delete', async () => {
      const mockCoupon = {
        id: 'coupon-1',
        code: 'TEST10',
        type: CouponType.PERCENTAGE_OFF,
        value: 10,
        minOrderPaise: 0,
        maxUsesTotal: null,
        maxUsesPerUser: null,
        usesCount: 0,
        isActive: true,
        validFrom: new Date(),
        validUntil: null,
        applicableTo: Prisma.JsonNull,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        deletedBy: null,
        createdBy: 'admin-1',
        updatedBy: null
      };

      const fastify = createMockFastify({
        couponFindUnique: mockCoupon,
        couponUpdate: { ...mockCoupon, deletedAt: new Date(), deletedBy: 'admin-1', isActive: false }
      });

      const service = CouponsService.getInstance(fastify);
      await service.adminDeleteCoupon('coupon-1', 'admin-1', { ipAddress: '127.0.0.1' });

      expect(fastify.prisma.coupon.update).toHaveBeenCalledWith({
        where: { id: 'coupon-1' },
        data: expect.objectContaining({
          deletedAt: expect.any(Date),
          deletedBy: 'admin-1',
          updatedBy: 'admin-1',
          isActive: false
        })
      });
    });

    it('prevents updates to soft-deleted coupons', async () => {
      const mockCoupon = {
        id: 'coupon-1',
        code: 'TEST10',
        type: CouponType.PERCENTAGE_OFF,
        value: 10,
        minOrderPaise: 0,
        maxUsesTotal: null,
        maxUsesPerUser: null,
        usesCount: 0,
        isActive: false,
        validFrom: new Date(),
        validUntil: null,
        applicableTo: Prisma.JsonNull,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: new Date(), // Soft deleted
        deletedBy: 'admin-1',
        createdBy: 'admin-1',
        updatedBy: 'admin-1'
      };

      const fastify = createMockFastify({ couponFindUnique: mockCoupon });
      const service = CouponsService.getInstance(fastify);

      await expect(
        service.adminUpdateCoupon('coupon-1', { value: 20 }, 'admin-2')
      ).rejects.toMatchObject({
        statusCode: 400,
        message: expect.stringContaining('deleted')
      });
    });

    it('allows restoring soft-deleted coupon', async () => {
      const deletedCoupon = {
        id: 'coupon-1',
        code: 'TEST10',
        type: CouponType.PERCENTAGE_OFF,
        value: 10,
        minOrderPaise: 0,
        maxUsesTotal: null,
        maxUsesPerUser: null,
        usesCount: 0,
        isActive: false,
        validFrom: new Date(),
        validUntil: null,
        applicableTo: Prisma.JsonNull,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: new Date(),
        deletedBy: 'admin-1',
        createdBy: 'admin-1',
        updatedBy: 'admin-1'
      };

      const restoredCoupon = { ...deletedCoupon, deletedAt: null, deletedBy: null, isActive: true };

      const fastify = createMockFastify({
        couponFindUnique: deletedCoupon,
        couponUpdate: restoredCoupon
      });

      const service = CouponsService.getInstance(fastify);
      const result = await service.adminRestoreCoupon('coupon-1', 'admin-2', { ipAddress: '127.0.0.1' });

      expect(fastify.prisma.coupon.update).toHaveBeenCalledWith({
        where: { id: 'coupon-1' },
        data: expect.objectContaining({
          deletedAt: null,
          deletedBy: null,
          updatedBy: 'admin-2',
          isActive: true
        })
      });

      expect(result.status).toBe('active');
    });

    it('prevents restoring non-deleted coupon', async () => {
      const mockCoupon = {
        id: 'coupon-1',
        code: 'TEST10',
        type: CouponType.PERCENTAGE_OFF,
        value: 10,
        minOrderPaise: 0,
        maxUsesTotal: null,
        maxUsesPerUser: null,
        usesCount: 0,
        isActive: true,
        validFrom: new Date(),
        validUntil: null,
        applicableTo: Prisma.JsonNull,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        deletedBy: null,
        createdBy: 'admin-1',
        updatedBy: null
      };

      const fastify = createMockFastify({ couponFindUnique: mockCoupon });
      const service = CouponsService.getInstance(fastify);

      await expect(
        service.adminRestoreCoupon('coupon-1', 'admin-2')
      ).rejects.toMatchObject({
        statusCode: 400,
        message: expect.stringContaining('not deleted')
      });
    });

    it('filters soft-deleted coupons from list by default', async () => {
      const fastify = createMockFastify({
        couponFindMany: [],
        couponCount: 0
      });

      const service = CouponsService.getInstance(fastify);
      await service.adminListCoupons({}, false);

      expect(fastify.prisma.coupon.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ deletedAt: null })
        })
      );
    });

    it('includes soft-deleted coupons when includeDeleted is true', async () => {
      const fastify = createMockFastify({
        couponFindMany: [],
        couponCount: 0
      });

      const service = CouponsService.getInstance(fastify);
      await service.adminListCoupons({}, true);

      expect(fastify.prisma.coupon.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.not.objectContaining({ deletedAt: null })
        })
      );
    });

    it('filters coupons by createdAt when from and to are provided', async () => {
      const fastify = createMockFastify({
        couponFindMany: [],
        couponCount: 0
      });

      const service = CouponsService.getInstance(fastify);
      await service.adminListCoupons(
        {
          from: '2026-05-01T00:00:00.000Z',
          to: '2026-05-31T23:59:59.999Z'
        },
        false
      );

      expect(fastify.prisma.coupon.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            createdAt: {
              gte: new Date('2026-05-01T00:00:00.000Z'),
              lte: new Date('2026-05-31T23:59:59.999Z')
            }
          })
        })
      );
    });

    it('filters coupons by type when type is provided', async () => {
      const fastify = createMockFastify({
        couponFindMany: [],
        couponCount: 0
      });

      const service = CouponsService.getInstance(fastify);
      await service.adminListCoupons({ type: 'PERCENTAGE_OFF' }, false);

      expect(fastify.prisma.coupon.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ type: CouponType.PERCENTAGE_OFF })
        })
      );
    });
  });

  describe('Audit Logging', () => {
    it('creates audit log on coupon creation', async () => {
      const createdCoupon = {
        id: 'coupon-1',
        code: 'NEW10',
        type: CouponType.PERCENTAGE_OFF,
        value: 10,
        minOrderPaise: 0,
        maxUsesTotal: null,
        maxUsesPerUser: null,
        usesCount: 0,
        isActive: true,
        validFrom: new Date(),
        validUntil: null,
        applicableTo: Prisma.JsonNull,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        deletedBy: null,
        createdBy: 'admin-1',
        updatedBy: null
      };

      const fastify = createMockFastify({
        couponCreate: createdCoupon
      });

      const service = CouponsService.getInstance(fastify);
      await service.adminCreateCoupon(
        { code: 'NEW10', type: CouponType.PERCENTAGE_OFF, value: 10, validFrom: new Date().toISOString() },
        'admin-1',
        { ipAddress: '127.0.0.1', userAgent: 'test-agent' }
      );

      expect(fastify.prisma.couponAuditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          couponId: 'coupon-1',
          action: 'CREATE',
          actorId: 'admin-1',
          actorType: 'ADMIN',
          ipAddress: '127.0.0.1',
          userAgent: 'test-agent'
        })
      });
    });

    it('creates audit log with change diff on update', async () => {
      const existingCoupon = {
        id: 'coupon-1',
        code: 'TEST10',
        type: CouponType.PERCENTAGE_OFF,
        value: 10,
        minOrderPaise: 0,
        maxUsesTotal: null,
        maxUsesPerUser: null,
        usesCount: 0,
        isActive: true,
        validFrom: new Date(),
        validUntil: null,
        applicableTo: Prisma.JsonNull,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        deletedBy: null,
        createdBy: 'admin-1',
        updatedBy: null
      };

      const updatedCoupon = { ...existingCoupon, value: 20, updatedBy: 'admin-2' };

      const fastify = createMockFastify({
        couponFindUnique: existingCoupon,
        couponUpdate: updatedCoupon
      });

      const service = CouponsService.getInstance(fastify);
      await service.adminUpdateCoupon('coupon-1', { value: 20 }, 'admin-2');

      expect(fastify.prisma.couponAuditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          couponId: 'coupon-1',
          action: 'UPDATE',
          actorId: 'admin-2',
          changes: expect.any(Object),
          previousState: expect.any(Object),
          newState: expect.any(Object)
        })
      });
    });

    it('creates audit log on soft delete', async () => {
      const mockCoupon = {
        id: 'coupon-1',
        code: 'TEST10',
        type: CouponType.PERCENTAGE_OFF,
        value: 10,
        minOrderPaise: 0,
        maxUsesTotal: null,
        maxUsesPerUser: null,
        usesCount: 0,
        isActive: true,
        validFrom: new Date(),
        validUntil: null,
        applicableTo: Prisma.JsonNull,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        deletedBy: null,
        createdBy: 'admin-1',
        updatedBy: null
      };

      const deletedCoupon = { ...mockCoupon, deletedAt: new Date(), deletedBy: 'admin-2', isActive: false };

      const fastify = createMockFastify({
        couponFindUnique: mockCoupon,
        couponUpdate: deletedCoupon
      });

      const service = CouponsService.getInstance(fastify);
      await service.adminDeleteCoupon('coupon-1', 'admin-2');

      expect(fastify.prisma.couponAuditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          couponId: 'coupon-1',
          action: 'DELETE',
          actorId: 'admin-2',
          actorType: 'ADMIN'
        })
      });
    });

    it('creates audit log on restore', async () => {
      const deletedCoupon = {
        id: 'coupon-1',
        code: 'TEST10',
        type: CouponType.PERCENTAGE_OFF,
        value: 10,
        minOrderPaise: 0,
        maxUsesTotal: null,
        maxUsesPerUser: null,
        usesCount: 0,
        isActive: false,
        validFrom: new Date(),
        validUntil: null,
        applicableTo: Prisma.JsonNull,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: new Date(),
        deletedBy: 'admin-1',
        createdBy: 'admin-1',
        updatedBy: null
      };

      const restoredCoupon = { ...deletedCoupon, deletedAt: null, deletedBy: null, isActive: true };

      const fastify = createMockFastify({
        couponFindUnique: deletedCoupon,
        couponUpdate: restoredCoupon
      });

      const service = CouponsService.getInstance(fastify);
      await service.adminRestoreCoupon('coupon-1', 'admin-2');

      expect(fastify.prisma.couponAuditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          couponId: 'coupon-1',
          action: 'RESTORE',
          actorId: 'admin-2',
          actorType: 'ADMIN'
        })
      });
    });

    it('logs warning but does not fail operation when audit log creation fails', async () => {
      const createdCoupon = {
        id: 'coupon-1',
        code: 'NEW10',
        type: CouponType.PERCENTAGE_OFF,
        value: 10,
        minOrderPaise: 0,
        maxUsesTotal: null,
        maxUsesPerUser: null,
        usesCount: 0,
        isActive: true,
        validFrom: new Date(),
        validUntil: null,
        applicableTo: Prisma.JsonNull,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        deletedBy: null,
        createdBy: 'admin-1',
        updatedBy: null
      };

      const fastify = createMockFastify({
        couponCreate: createdCoupon
      });

      // Make audit log creation fail
      fastify.prisma.couponAuditLog.create = vi.fn().mockRejectedValue(new Error('DB Error'));

      const service = CouponsService.getInstance(fastify);

      // Should not throw
      await expect(
        service.adminCreateCoupon(
          { code: 'NEW10', type: CouponType.PERCENTAGE_OFF, value: 10, validFrom: new Date().toISOString() },
          'admin-1'
        )
      ).resolves.not.toThrow();

      expect(mockLogger.warn).toHaveBeenCalled();
    });

    it('creates audit log on status change (pause/activate)', async () => {
      const mockCoupon = {
        id: 'coupon-1',
        code: 'TEST10',
        type: CouponType.PERCENTAGE_OFF,
        value: 10,
        minOrderPaise: 0,
        maxUsesTotal: null,
        maxUsesPerUser: null,
        usesCount: 0,
        isActive: true,
        validFrom: new Date(),
        validUntil: null,
        applicableTo: Prisma.JsonNull,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        deletedBy: null,
        createdBy: 'admin-1',
        updatedBy: null
      };

      const pausedCoupon = { ...mockCoupon, isActive: false, updatedBy: 'admin-2' };

      const fastify = createMockFastify({
        couponFindUnique: mockCoupon,
        couponUpdate: pausedCoupon
      });

      const service = CouponsService.getInstance(fastify);
      await service.adminUpdateCouponStatus('coupon-1', { isActive: false }, 'admin-2');

      expect(fastify.prisma.couponAuditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          couponId: 'coupon-1',
          action: 'PAUSE',
          actorId: 'admin-2',
          changes: { isActive: { from: true, to: false } }
        })
      });
    });
  });

  describe('Admin Attribution Tracking', () => {
    it('tracks createdBy on coupon creation', async () => {
      const fastify = createMockFastify({
        couponCreate: {
          id: 'coupon-1',
          code: 'TEST',
          type: CouponType.PERCENTAGE_OFF,
          value: 10,
          minOrderPaise: 0,
          maxUsesTotal: null,
          maxUsesPerUser: null,
          usesCount: 0,
          isActive: true,
          validFrom: new Date(),
          validUntil: null,
          applicableTo: Prisma.JsonNull,
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
          deletedBy: null,
          createdBy: 'admin-123',
          updatedBy: null
        }
      });
      const service = CouponsService.getInstance(fastify);

      await service.adminCreateCoupon(
        { code: 'TEST', type: CouponType.PERCENTAGE_OFF, value: 10, validFrom: new Date().toISOString() },
        'admin-123'
      );

      expect(fastify.prisma.coupon.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          createdBy: 'admin-123'
        })
      });
    });

    it('tracks updatedBy on coupon update', async () => {
      const existingCoupon = {
        id: 'coupon-1',
        code: 'TEST',
        type: CouponType.PERCENTAGE_OFF,
        value: 10,
        minOrderPaise: 0,
        maxUsesTotal: null,
        maxUsesPerUser: null,
        usesCount: 0,
        isActive: true,
        validFrom: new Date(),
        validUntil: null,
        applicableTo: Prisma.JsonNull,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        deletedBy: null,
        createdBy: 'admin-1',
        updatedBy: null
      };

      const fastify = createMockFastify({
        couponFindUnique: existingCoupon,
        couponUpdate: { ...existingCoupon, value: 20 }
      });

      const service = CouponsService.getInstance(fastify);
      await service.adminUpdateCoupon('coupon-1', { value: 20 }, 'admin-456');

      expect(fastify.prisma.coupon.update).toHaveBeenCalledWith({
        where: { id: 'coupon-1' },
        data: expect.objectContaining({
          updatedBy: 'admin-456'
        })
      });
    });

    it('tracks deletedBy on soft delete', async () => {
      const mockCoupon = {
        id: 'coupon-1',
        code: 'TEST',
        type: CouponType.PERCENTAGE_OFF,
        value: 10,
        minOrderPaise: 0,
        maxUsesTotal: null,
        maxUsesPerUser: null,
        usesCount: 0,
        isActive: true,
        validFrom: new Date(),
        validUntil: null,
        applicableTo: Prisma.JsonNull,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        deletedBy: null,
        createdBy: 'admin-1',
        updatedBy: null
      };

      const fastify = createMockFastify({
        couponFindUnique: mockCoupon,
        couponUpdate: { ...mockCoupon, deletedAt: new Date() }
      });

      const service = CouponsService.getInstance(fastify);
      await service.adminDeleteCoupon('coupon-1', 'admin-789');

      expect(fastify.prisma.coupon.update).toHaveBeenCalledWith({
        where: { id: 'coupon-1' },
        data: expect.objectContaining({
          deletedBy: 'admin-789',
          updatedBy: 'admin-789'
        })
      });
    });
  });

  describe('Duplicate Code Prevention', () => {
    it('prevents creating coupon with existing code', async () => {
      const fastify = createMockFastify({
        couponFindFirst: {
          id: 'existing-1',
          code: 'DUPLICATE',
          deletedAt: null
        }
      });

      const service = CouponsService.getInstance(fastify);

      await expect(
        service.adminCreateCoupon(
          { code: 'DUPLICATE', type: CouponType.PERCENTAGE_OFF, value: 10, validFrom: new Date().toISOString() },
          'admin-1'
        )
      ).rejects.toMatchObject({
        statusCode: 409,
        message: expect.stringContaining('already exists')
      });
    });

    it('prevents updating to duplicate code', async () => {
      const existingCoupon = {
        id: 'coupon-1',
        code: 'ORIGINAL',
        type: CouponType.PERCENTAGE_OFF,
        value: 10,
        minOrderPaise: 0,
        maxUsesTotal: null,
        maxUsesPerUser: null,
        usesCount: 0,
        isActive: true,
        validFrom: new Date(),
        validUntil: null,
        applicableTo: Prisma.JsonNull,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        deletedBy: null,
        createdBy: 'admin-1',
        updatedBy: null
      };

      const fastify = createMockFastify({
        couponFindUnique: existingCoupon,
        couponFindFirst: { id: 'other-1', code: 'TAKEN', deletedAt: null }
      });

      const service = CouponsService.getInstance(fastify);

      await expect(
        service.adminUpdateCoupon('coupon-1', { code: 'TAKEN' }, 'admin-1')
      ).rejects.toMatchObject({
        statusCode: 409,
        message: expect.stringContaining('already exists')
      });
    });
  });

  describe('Audit Log Querying', () => {
    it('returns audit logs with actor names', async () => {
      const mockLogs = [
        {
          id: 'log-1',
          couponId: 'coupon-1',
          action: 'CREATE',
          actorId: 'admin-1',
          actorType: 'ADMIN',
          changes: null,
          ipAddress: '127.0.0.1',
          userAgent: 'test',
          createdAt: new Date()
        }
      ];

      const fastify = createMockFastify({
        auditLogCreate: {},
        userFindMany: [{ id: 'admin-1', firstName: 'John', lastName: 'Doe', email: 'john@example.com' }]
      });

      fastify.prisma.couponAuditLog.findMany = vi.fn().mockResolvedValue(mockLogs);
      fastify.prisma.couponAuditLog.count = vi.fn().mockResolvedValue(1);

      const service = CouponsService.getInstance(fastify);
      const result = await service.getCouponAuditLogs('coupon-1', {});

      expect(result.items[0]?.actorName).toBe('John Doe');
      expect(result.items[0]?.action).toBe('CREATE');
    });
  });

  describe('Deferred Coupon Type', () => {
    it('rejects deferred BUY_X_GET_Y coupon type', async () => {
      const fastify = createMockFastify();
      const service = CouponsService.getInstance(fastify);

      await expect(
        service.adminCreateCoupon(
          { code: 'B2G1', type: CouponType.BUY_X_GET_Y, value: 1, validFrom: new Date().toISOString() },
          'admin-1'
        )
      ).rejects.toMatchObject({ statusCode: 400 });
    });
  });
});
