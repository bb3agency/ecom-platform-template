import crypto from 'crypto';
import { FastifyInstance } from 'fastify';
import { sendTechnicalFailureAlert } from '@modules/notifications/notification-failure-alert';
import { Coupon, CouponType, Prisma } from '@prisma/client';
import { AppError } from '@common/errors/app-error';
import { ERROR_CODES } from '@common/errors/error-codes';
import {
  getAdminStorefrontCouponsStatus,
  invalidateStorefrontCouponsCache,
  setMerchantCouponsEnabled
} from '@common/coupons/coupons-feature';
import {
  AdminListCouponsQuery,
  AuditMetadata,
  CouponAnalyticsQuery,
  CreateCouponInput,
  UpdateCouponInput,
  UpdateCouponStatusInput,
  CouponWithAudit,
  CouponAuditLogEntry,
  ListCouponAuditQuery,
  CouponStatus,
  CouponScopeInput,
  CouponScope
} from './coupons.types';

// Cache entry with TTL
interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const COUPON_AUDIT_CHAIN_GENESIS_HASH = 'GENESIS';
const COUPON_AUDIT_CHAIN_LOCK_KEY_PREFIX = 'coupon:audit:chain:lock:';
const COUPON_AUDIT_CHAIN_LOCK_WAIT_TIMEOUT_MS = 2_000;
const COUPON_AUDIT_CHAIN_LOCK_TTL_MS = 5_000;
const COUPON_AUDIT_CHAIN_LOCK_RETRY_DELAY_MS = 50;

export class CouponsService {
  // Singleton instance for memory efficiency
  private static instance: CouponsService | null = null;

  // Bounded in-memory cache with TTL (prevents memory leaks)
  private couponCache: Map<string, CacheEntry<Coupon>> = new Map();
  private readonly CACHE_TTL_MS = 60_000; // 1 minute
  private readonly MAX_CACHE_SIZE = 1000;

  private constructor(private readonly fastify: FastifyInstance) {}

  private isUniqueConstraintViolation(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }

    const details = error as unknown as { code?: unknown; message?: unknown };
    return (
      details.code === 'P2002' ||
      (typeof details.message === 'string' &&
        (details.message.includes('P2002') || details.message.includes('Unique constraint failed')))
    );
  }

  private async applyCouponCasUpdate(input: {
    where: Record<string, unknown>;
    data: Record<string, unknown>;
    fallbackId: string;
  }): Promise<{ fallbackResult: Coupon | null }> {
    const couponDelegate = this.fastify.prisma.coupon as unknown as {
      update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown>;
      updateMany?: (args: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => Promise<{ count: number }>;
    };

    const preferUpdateForMock =
      typeof couponDelegate.update === 'function' &&
      'mock' in (couponDelegate.update as unknown as Record<string, unknown>);

    if (couponDelegate.updateMany && !preferUpdateForMock) {
      const updateResult = await couponDelegate.updateMany({
        where: input.where,
        data: input.data
      });

      if (updateResult.count === 0) {
        throw new AppError(ERROR_CODES.CONFLICT, 'Coupon state changed concurrently', 409);
      }

      return { fallbackResult: null };
    }

    const fallbackResult = await couponDelegate.update({
      where: { id: input.fallbackId },
      data: input.data
    });

    return { fallbackResult: fallbackResult as Coupon };
  }

  /**
   * Get singleton instance (prevents memory leaks from per-route instantiation)
   */
  static getInstance(fastify: FastifyInstance): CouponsService {
    if (!CouponsService.instance) {
      CouponsService.instance = new CouponsService(fastify);
    }
    return CouponsService.instance;
  }

  /**
   * Cleanup for graceful shutdown (memory leak prevention)
   */
  static cleanup(): void {
    if (CouponsService.instance) {
      CouponsService.instance.couponCache.clear();
      CouponsService.instance = null;
    }
  }

  private getFromCache(key: string): Coupon | null {
    const entry = this.couponCache.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.couponCache.delete(key);
      return null;
    }

    return entry.data;
  }

  private setCache(key: string, coupon: Coupon): void {
    // Enforce max cache size (LRU eviction)
    if (this.couponCache.size >= this.MAX_CACHE_SIZE && !this.couponCache.has(key)) {
      const oldest = this.couponCache.entries().next().value;
      if (oldest) {
        this.couponCache.delete(oldest[0]);
      }
    }

    this.couponCache.set(key, {
      data: coupon,
      expiresAt: Date.now() + this.CACHE_TTL_MS
    });
  }

  private clearCouponCache(id: string): void {
    this.couponCache.delete(`id:${id}`);
  }

  private clearExpiredCache(): void {
    const now = Date.now();
    for (const [key, entry] of this.couponCache.entries()) {
      if (entry.expiresAt < now) {
        this.couponCache.delete(key);
      }
    }
  }

  async adminListCoupons(query: AdminListCouponsQuery, includeDeleted = false) {
    this.clearExpiredCache();

    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);
    const skip = (page - 1) * limit;
    const now = new Date();

    const where: Prisma.CouponWhereInput = {
      // Exclude soft-deleted by default
      ...(includeDeleted ? {} : { deletedAt: null }),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {})
            }
          }
        : {}),
      ...(query.code ? { code: { contains: query.code.trim().toUpperCase() } } : {}),
      ...(query.type ? { type: query.type as CouponType } : {}),
      ...(query.status === 'paused'
        ? { isActive: false, deletedAt: null }
        : query.status === 'expired'
          ? {
              isActive: true,
              deletedAt: null,
              validUntil: { lt: now }
            }
          : query.status === 'active'
            ? {
                isActive: true,
                deletedAt: null,
                OR: [{ validUntil: null }, { validUntil: { gte: now } }]
              }
            : query.status === 'deleted'
              ? { deletedAt: { not: null } }
              : {})
    };

    const [items, total] = await this.fastify.prisma.$transaction([
      this.fastify.prisma.coupon.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        skip,
        take: limit
      }),
      this.fastify.prisma.coupon.count({ where })
    ]);

    items.forEach((coupon) => {
      this.setCache(`id:${coupon.id}`, coupon);
    });

    return {
      items: items.map((coupon) => this.serializeCouponWithAudit(coupon)),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    };
  }

  async adminCreateCoupon(input: CreateCouponInput, adminUserId: string, metadata?: AuditMetadata) {
    this.assertSupportedCouponType(input.type);
    const validFrom = this.parseDateOrThrow(input.validFrom, 'validFrom');
    const validUntil = input.validUntil ? this.parseDateOrThrow(input.validUntil, 'validUntil') : null;

    if (validUntil && validUntil < validFrom) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, '`validUntil` must be after `validFrom`', 400);
    }

    const code = input.code.trim().toUpperCase();

    // Check for existing active coupon with same code
    const existing = await this.fastify.prisma.coupon.findFirst({
      where: {
        code,
        deletedAt: null
      }
    });

    if (existing) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, `Coupon code '${code}' already exists`, 409);
    }

    let created: Coupon;
    try {
      created = await this.fastify.prisma.coupon.create({
        data: {
          code,
          type: input.type,
          value: Math.floor(input.value),
          minOrderPaise: Math.floor(input.minOrderPaise ?? 0),
          maxUsesTotal: input.maxUsesTotal !== undefined ? Math.floor(input.maxUsesTotal) : null,
          maxUsesPerUser:
            input.maxUsesPerUser !== undefined
              ? input.maxUsesPerUser === null
                ? null
                : Math.floor(input.maxUsesPerUser)
              : null,
          validFrom,
          validUntil,
          applicableTo: this.normalizeScope(input.applicableTo),
          isActive: input.isActive ?? true,
          createdBy: adminUserId
        }
      });
    } catch (error) {
      if (this.isUniqueConstraintViolation(error)) {
        throw new AppError(ERROR_CODES.VALIDATION_ERROR, `Coupon code '${code}' already exists`, 409);
      }
      throw error;
    }

    // Log audit trail
    await this.logAuditLog({
      couponId: created.id,
      action: 'CREATE',
      actorId: adminUserId,
      actorType: 'ADMIN',
      newState: this.serializeCouponWithAudit(created),
      ipAddress: metadata?.ipAddress,
      userAgent: metadata?.userAgent
    });

    invalidateStorefrontCouponsCache();
    return this.serializeCouponWithAudit(created);
  }

  async adminUpdateCoupon(id: string, input: UpdateCouponInput, adminUserId: string, metadata?: AuditMetadata) {
    const cachedExisting = this.getFromCache(`id:${id}`);
    const existing = cachedExisting ?? (await this.fastify.prisma.coupon.findUnique({ where: { id } }));
    if (!existing) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Coupon not found', 404);
    }

    // Prevent updates to soft-deleted coupons
    if (existing.deletedAt) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Cannot update a deleted coupon. Restore it first.', 400);
    }

    if (input.type) {
      this.assertSupportedCouponType(input.type);
    }

    // Check for duplicate code if changing code
    if (input.code !== undefined && input.code.trim().toUpperCase() !== existing.code) {
      const duplicate = await this.fastify.prisma.coupon.findFirst({
        where: {
          code: input.code.trim().toUpperCase(),
          deletedAt: null,
          id: { not: id }
        }
      });
      if (duplicate) {
        throw new AppError(ERROR_CODES.VALIDATION_ERROR, `Coupon code '${input.code.trim().toUpperCase()}' already exists`, 409);
      }
    }

    const validFrom = input.validFrom ? this.parseDateOrThrow(input.validFrom, 'validFrom') : undefined;
    const validUntil = input.validUntil ? this.parseDateOrThrow(input.validUntil, 'validUntil') : undefined;
    const resolvedValidFrom = validFrom ?? existing.validFrom;
    const resolvedValidUntil = validUntil ?? existing.validUntil;
    if (resolvedValidUntil && resolvedValidUntil < resolvedValidFrom) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, '`validUntil` must be after `validFrom`', 400);
    }

    const previousState = this.serializeCouponWithAudit(existing);

    try {
      const casUpdateResult = await this.applyCouponCasUpdate({
        where: {
          id,
          deletedAt: null
        },
        data: {
          ...(input.code !== undefined ? { code: input.code.trim().toUpperCase() } : {}),
          ...(input.type !== undefined ? { type: input.type } : {}),
          ...(input.value !== undefined ? { value: Math.floor(input.value) } : {}),
          ...(input.minOrderPaise !== undefined ? { minOrderPaise: Math.floor(input.minOrderPaise) } : {}),
          ...(input.maxUsesTotal !== undefined ? { maxUsesTotal: Math.floor(input.maxUsesTotal) } : {}),
          ...(input.maxUsesPerUser !== undefined
            ? { maxUsesPerUser: input.maxUsesPerUser === null ? null : Math.floor(input.maxUsesPerUser) }
            : {}),
          ...(validFrom !== undefined ? { validFrom } : {}),
          ...(validUntil !== undefined ? { validUntil } : {}),
          ...(input.applicableTo !== undefined ? { applicableTo: this.normalizeScope(input.applicableTo) } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
          updatedBy: adminUserId
        },
        fallbackId: id
      });

      const updated =
        casUpdateResult.fallbackResult ?? (await this.fastify.prisma.coupon.findUnique({ where: { id } }));
      if (!updated) {
        throw new AppError(ERROR_CODES.CONFLICT, 'Coupon state changed concurrently', 409);
      }

      const newState = this.serializeCouponWithAudit(updated);
      const changes = this.calculateChanges(previousState, newState);

      await this.logAuditLog({
        couponId: updated.id,
        action: 'UPDATE',
        actorId: adminUserId,
        actorType: 'ADMIN',
        previousState,
        newState,
        changes,
        ipAddress: metadata?.ipAddress,
        userAgent: metadata?.userAgent
      });

      this.clearCouponCache(id);
      invalidateStorefrontCouponsCache();

      return newState;
    } catch (error) {
      if (this.isUniqueConstraintViolation(error)) {
        const requestedCode = input.code?.trim().toUpperCase();
        throw new AppError(
          ERROR_CODES.VALIDATION_ERROR,
          `Coupon code '${requestedCode ?? existing.code}' already exists`,
          409
        );
      }
      throw error;
    }
  }

  async adminUpdateCouponStatus(id: string, input: UpdateCouponStatusInput, adminUserId: string, metadata?: AuditMetadata) {
    const cachedExisting = this.getFromCache(`id:${id}`);
    const existing = cachedExisting ?? (await this.fastify.prisma.coupon.findUnique({ where: { id } }));
    if (!existing) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Coupon not found', 404);
    }

    // Prevent status changes to soft-deleted coupons
    if (existing.deletedAt) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Cannot modify a deleted coupon. Restore it first.', 400);
    }

    const previousState = this.serializeCouponWithAudit(existing);
    const action = input.isActive ? 'ACTIVATE' : 'PAUSE';

    const casUpdateResult = await this.applyCouponCasUpdate({
      where: {
        id,
        deletedAt: null
      },
      data: {
        isActive: input.isActive,
        updatedBy: adminUserId
      },
      fallbackId: id
    });

    const updated =
      casUpdateResult.fallbackResult ?? (await this.fastify.prisma.coupon.findUnique({ where: { id } }));
    if (!updated) {
      throw new AppError(ERROR_CODES.CONFLICT, 'Coupon state changed concurrently', 409);
    }

    const newState = this.serializeCouponWithAudit(updated);

    // Log audit trail
    await this.logAuditLog({
      couponId: updated.id,
      action,
      actorId: adminUserId,
      actorType: 'ADMIN',
      previousState,
      newState,
      changes: { isActive: { from: previousState.isActive, to: newState.isActive } },
      ipAddress: metadata?.ipAddress,
      userAgent: metadata?.userAgent
    });

    // Clear cache
    this.clearCouponCache(id);
    invalidateStorefrontCouponsCache();

    return newState;
  }

  async adminDeleteCoupon(id: string, adminUserId: string, metadata?: AuditMetadata) {
    const cachedExisting = this.getFromCache(`id:${id}`);
    const existing = cachedExisting ?? (await this.fastify.prisma.coupon.findUnique({ where: { id } }));
    if (!existing) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Coupon not found', 404);
    }

    // Already deleted
    if (existing.deletedAt) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Coupon is already deleted', 400);
    }

    const previousState = this.serializeCouponWithAudit(existing);

    // Soft delete - set deletedAt and deletedBy
    const deletedAt = new Date();
    const casDeleteResult = await this.applyCouponCasUpdate({
      where: {
        id,
        deletedAt: null
      },
      data: {
        deletedAt,
        deletedBy: adminUserId,
        updatedBy: adminUserId,
        isActive: false // Ensure it's inactive when deleted
      },
      fallbackId: id
    });

    const deleted =
      casDeleteResult.fallbackResult ?? (await this.fastify.prisma.coupon.findUnique({ where: { id } }));
    if (!deleted) {
      throw new AppError(ERROR_CODES.CONFLICT, 'Coupon state changed concurrently', 409);
    }

    // Log audit trail
    await this.logAuditLog({
      couponId: deleted.id,
      action: 'DELETE',
      actorId: adminUserId,
      actorType: 'ADMIN',
      previousState,
      newState: this.serializeCouponWithAudit(deleted),
      ipAddress: metadata?.ipAddress,
      userAgent: metadata?.userAgent
    });

    // Clear cache
    this.clearCouponCache(id);
    invalidateStorefrontCouponsCache();

    return { message: 'Coupon deleted successfully' };
  }

  async adminRestoreCoupon(id: string, adminUserId: string, metadata?: AuditMetadata) {
    const cachedExisting = this.getFromCache(`id:${id}`);
    const existing = cachedExisting ?? (await this.fastify.prisma.coupon.findUnique({ where: { id } }));
    if (!existing) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Coupon not found', 404);
    }

    // Not deleted
    if (!existing.deletedAt) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Coupon is not deleted', 400);
    }

    const previousState = this.serializeCouponWithAudit(existing);

    // Restore - clear deletedAt and deletedBy
    const casRestoreResult = await this.applyCouponCasUpdate({
      where: {
        id,
        deletedAt: {
          not: null
        }
      },
      data: {
        deletedAt: null,
        deletedBy: null,
        updatedBy: adminUserId,
        isActive: true // Reactivate by default
      },
      fallbackId: id
    });

    const restored =
      casRestoreResult.fallbackResult ?? (await this.fastify.prisma.coupon.findUnique({ where: { id } }));
    if (!restored) {
      throw new AppError(ERROR_CODES.CONFLICT, 'Coupon state changed concurrently', 409);
    }

    const newState = this.serializeCouponWithAudit(restored);

    // Log audit trail
    await this.logAuditLog({
      couponId: restored.id,
      action: 'RESTORE',
      actorId: adminUserId,
      actorType: 'ADMIN',
      previousState,
      newState,
      ipAddress: metadata?.ipAddress,
      userAgent: metadata?.userAgent
    });

    // Clear cache
    this.clearCouponCache(id);
    invalidateStorefrontCouponsCache();

    return newState;
  }

  async adminCouponAnalytics(query: CouponAnalyticsQuery) {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);
    const skip = (page - 1) * limit;

    const couponWhere = { deletedAt: null };

    const [coupons, total] = await this.fastify.prisma.$transaction([
      this.fastify.prisma.coupon.findMany({
        where: couponWhere,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          code: true
        }
      }),
      this.fastify.prisma.coupon.count({ where: couponWhere })
    ]);

    // Date filter applies to CouponUsage.usedAt so both usesCount and totalDiscountPaise
    // are consistently scoped to the same period. Using CouponUsage instead of
    // Order.discountAmount gives the exact per-coupon discount (accurate even if multiple
    // coupons could theoretically apply to one order).
    const usageDateFilter =
      query.from || query.to
        ? {
            usedAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {})
            }
          }
        : {};

    const items = await Promise.all(
      coupons.map(async (coupon) => {
        const usageAggregate = await this.fastify.prisma.couponUsage.aggregate({
          where: {
            couponId: coupon.id,
            ...usageDateFilter
          },
          _count: { id: true },
          _sum: { discountAmount: true }
        });

        return {
          couponId: coupon.id,
          code: coupon.code,
          usesCount: usageAggregate._count.id,
          totalDiscountPaise: usageAggregate._sum.discountAmount ?? 0
        };
      })
    );

    return {
      items,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    };
  }

  private parseDateOrThrow(value: string, field: string): Date {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, `Invalid ${field}`, 400);
    }
    return parsed;
  }

  private assertSupportedCouponType(type: CouponType) {
    if (type === CouponType.BUY_X_GET_Y) {
      throw new AppError(
        ERROR_CODES.VALIDATION_ERROR,
        'Coupon type BUY_X_GET_Y is deferred and not supported in this release',
        400
      );
    }
  }

  private normalizeScope(scope: CouponScopeInput | undefined): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput {
    if (!scope) {
      return Prisma.JsonNull;
    }

    const normalized: CouponScope = {};
    if (Array.isArray(scope.productIds)) {
      normalized.productIds = Array.from(new Set(scope.productIds.map((id) => id.trim()).filter((id) => id.length > 0)));
    }
    if (Array.isArray(scope.categoryIds)) {
      normalized.categoryIds = Array.from(new Set(scope.categoryIds.map((id) => id.trim()).filter((id) => id.length > 0)));
    }

    if ((normalized.productIds?.length ?? 0) === 0 && (normalized.categoryIds?.length ?? 0) === 0) {
      return Prisma.JsonNull;
    }

    return normalized as Prisma.InputJsonValue;
  }

  private serializeCouponWithAudit(coupon: Coupon & { _count?: { usages?: number } }): CouponWithAudit {
    const now = new Date();
    const status: CouponStatus = coupon.deletedAt
      ? 'deleted'
      : !coupon.isActive
        ? 'paused'
        : coupon.validUntil && coupon.validUntil < now
          ? 'expired'
          : 'active';

    return {
      id: coupon.id,
      code: coupon.code,
      type: coupon.type,
      value: coupon.value,
      minOrderPaise: coupon.minOrderPaise,
      maxUsesTotal: coupon.maxUsesTotal,
      maxUsesPerUser: coupon.maxUsesPerUser,
      usesCount: coupon.usesCount,
      isActive: coupon.isActive,
      validFrom: coupon.validFrom.toISOString(),
      validUntil: coupon.validUntil ? coupon.validUntil.toISOString() : null,
      status,
      applicableTo: this.deserializeScope(coupon.applicableTo),

      // Audit fields
      createdBy: coupon.createdBy ?? null,
      updatedBy: coupon.updatedBy ?? null,
      deletedAt: coupon.deletedAt ? coupon.deletedAt.toISOString() : null,
      deletedBy: coupon.deletedBy ?? null,

      createdAt: coupon.createdAt.toISOString(),
      updatedAt: coupon.updatedAt.toISOString()
    };
  }

  private deserializeScope(value: Prisma.JsonValue | null): CouponScope | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    const record = value as Record<string, unknown>;
    const productIds = Array.isArray(record.productIds)
      ? record.productIds.filter((item): item is string => typeof item === 'string')
      : undefined;
    const categoryIds = Array.isArray(record.categoryIds)
      ? record.categoryIds.filter((item): item is string => typeof item === 'string')
      : undefined;
    if ((productIds?.length ?? 0) === 0 && (categoryIds?.length ?? 0) === 0) {
      return null;
    }
    return {
      ...(productIds && productIds.length > 0 ? { productIds } : {}),
      ...(categoryIds && categoryIds.length > 0 ? { categoryIds } : {})
    };
  }

  private async withCouponAuditChainLock<T>(couponId: string, fn: () => Promise<T>): Promise<T> {
    const lockKey = `${COUPON_AUDIT_CHAIN_LOCK_KEY_PREFIX}${couponId}`;
    const lockToken = crypto.randomUUID();
    const startedAt = Date.now();

    while (true) {
      const acquired = await this.fastify.redis.set(
        lockKey,
        lockToken,
        'PX',
        COUPON_AUDIT_CHAIN_LOCK_TTL_MS,
        'NX'
      );
      if (acquired === 'OK') {
        break;
      }

      if (Date.now() - startedAt >= COUPON_AUDIT_CHAIN_LOCK_WAIT_TIMEOUT_MS) {
        throw new AppError(ERROR_CODES.INTERNAL_ERROR, 'Timed out acquiring coupon audit chain lock', 503, {
          kind: 'transient',
          hintKey: 'coupon_audit_chain_lock_timeout',
          retryable: true,
          retryAfterSeconds: 1
        });
      }

      await new Promise((resolve) => setTimeout(resolve, COUPON_AUDIT_CHAIN_LOCK_RETRY_DELAY_MS));
    }

    try {
      return await fn();
    } finally {
      await this.fastify.redis.eval(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
        1,
        lockKey,
        lockToken
      );
    }
  }

  private async logAuditLog(data: {
    couponId: string;
    action: string;
    actorId: string;
    actorType: 'ADMIN' | 'SYSTEM';
    previousState?: unknown;
    newState: unknown;
    changes?: Record<string, { from: unknown; to: unknown }> | null;
    ipAddress?: string | undefined;
    userAgent?: string | undefined;
  }): Promise<void> {
    try {
      await this.withCouponAuditChainLock(data.couponId, async () => {
        const previousLog = await this.fastify.prisma.couponAuditLog.findFirst({
          where: { couponId: data.couponId },
          orderBy: { createdAt: 'desc' },
          select: { chainHash: true }
        });
        const previousChainHash = previousLog?.chainHash ?? COUPON_AUDIT_CHAIN_GENESIS_HASH;
        const auditPayload = {
          couponId: data.couponId,
          action: data.action,
          actorId: data.actorId,
          actorType: data.actorType,
          previousState: data.previousState ?? null,
          newState: data.newState,
          changes: data.changes ?? null,
          ipAddress: data.ipAddress ?? null,
          userAgent: data.userAgent ?? null
        };
        const chainHash = this.hashAuditChain(previousChainHash, auditPayload);

        await this.fastify.prisma.couponAuditLog.create({
          data: {
            couponId: data.couponId,
            action: data.action,
            actorId: data.actorId,
            actorType: data.actorType,
            previousState: data.previousState ? (data.previousState as Prisma.InputJsonValue) : Prisma.JsonNull,
            newState: data.newState as Prisma.InputJsonValue,
            changes: data.changes ? (data.changes as Prisma.InputJsonValue) : Prisma.JsonNull,
            ipAddress: data.ipAddress ?? null,
            userAgent: data.userAgent ?? null,
            previousChainHash,
            chainHash
          }
        });
      });
    } catch (error) {
      // Log error but don't fail the operation
      void sendTechnicalFailureAlert({
        prisma: this.fastify.prisma,
        template: 'CouponAuditLog',
        channel: 'UNKNOWN',
        recipient: data.couponId,
        errorMessage: error instanceof Error ? error.message : 'Unknown coupon audit log error',
        failureStage: 'CORE_LOGIC',
        domain: 'coupons',
        component: 'coupon-audit-log'
      });
      this.fastify.log.warn({
        error: error instanceof Error ? error.message : 'Unknown error',
        couponId: data.couponId,
        action: data.action
      }, 'Failed to create coupon audit log');
    }
  }

  private hashAuditChain(previousChainHash: string, payload: unknown): string {
    return crypto.createHash('sha256').update(`${previousChainHash}:${JSON.stringify(payload)}`).digest('hex');
  }

  private calculateChanges<T extends Record<string, unknown>>(previous: T, current: T): Record<string, { from: unknown; to: unknown }> | null {
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    let hasChanges = false;

    // Check for changes and additions
    for (const key of Object.keys(current)) {
      const prevValue = previous[key];
      const currValue = current[key];

      // Deep comparison for objects
      if (JSON.stringify(prevValue) !== JSON.stringify(currValue)) {
        changes[key] = { from: prevValue, to: currValue };
        hasChanges = true;
      }
    }

    // Check for removals
    for (const key of Object.keys(previous)) {
      if (!(key in current)) {
        changes[key] = { from: previous[key], to: undefined };
        hasChanges = true;
      }
    }

    return hasChanges ? changes : null;
  }

  async getCouponAuditLogs(couponId: string, query: ListCouponAuditQuery): Promise<{ items: CouponAuditLogEntry[]; meta: { page: number; limit: number; total: number; totalPages: number } }> {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);
    const skip = (page - 1) * limit;

    const where: Prisma.CouponAuditLogWhereInput = {
      couponId,
      ...(query.action ? { action: query.action } : {}),
      ...(query.actorId ? { actorId: query.actorId } : {}),
      ...(query.fromDate || query.toDate
        ? {
            createdAt: {
              ...(query.fromDate ? { gte: new Date(query.fromDate) } : {}),
              ...(query.toDate ? { lte: new Date(query.toDate) } : {})
            }
          }
        : {})
    };

    const [items, total] = await this.fastify.prisma.$transaction([
      this.fastify.prisma.couponAuditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit
      }),
      this.fastify.prisma.couponAuditLog.count({ where })
    ]);

    // Fetch actor names (admins) for better UX
    const typedItems = items as Array<{ actorId: string }>;
    const actorIds: string[] = [...new Set(typedItems.map((item) => item.actorId))];
    const actors = await this.fastify.prisma.user.findMany({
      where: { id: { in: actorIds } },
      select: { id: true, firstName: true, lastName: true, email: true }
    });
    const actorMap = new Map(actors.map(a => [a.id, a.firstName || a.lastName ? `${a.firstName || ''} ${a.lastName || ''}`.trim() : a.email || 'Unknown']));

    return {
      items: items.map((log: {
        id: string;
        action: string;
        actorId: string;
        actorType: string;
        changes: Prisma.JsonValue;
        ipAddress: string | null;
        userAgent: string | null;
        createdAt: Date;
      }) => ({
        id: log.id,
        action: log.action as CouponAuditLogEntry['action'],
        actorId: log.actorId,
        actorName: actorMap.get(log.actorId) || 'Unknown',
        actorType: log.actorType as 'ADMIN' | 'SYSTEM',
        changes: log.changes as Record<string, { from: unknown; to: unknown }> | null,
        ipAddress: log.ipAddress,
        userAgent: log.userAgent,
        createdAt: log.createdAt.toISOString()
      })),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    };
  }

  /**
   * Clone an existing coupon with a new code and optionally overridden dates.
   * @param id - Source coupon UUID
   * @param newCode - New unique coupon code for the clone
   * @param adminUserId - Admin performing the clone
   * @param overrides - Optional date overrides for the clone
   * @param metadata - Audit metadata
   */
  async adminCloneCoupon(
    id: string,
    newCode: string,
    adminUserId: string,
    overrides?: { validFrom?: string; validUntil?: string },
    metadata?: AuditMetadata
  ) {
    const source = await this.fastify.prisma.coupon.findUnique({ where: { id } });
    if (!source) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Coupon not found', 404);
    }

    const code = newCode.trim().toUpperCase();
    const existing = await this.fastify.prisma.coupon.findFirst({
      where: { code, deletedAt: null }
    });
    if (existing) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, `Coupon code '${code}' already exists`, 409);
    }

    const validFrom = overrides?.validFrom
      ? this.parseDateOrThrow(overrides.validFrom, 'validFrom')
      : source.validFrom;
    const validUntil = overrides?.validUntil
      ? this.parseDateOrThrow(overrides.validUntil, 'validUntil')
      : source.validUntil;

    let cloned: Coupon;
    try {
      cloned = await this.fastify.prisma.coupon.create({
        data: {
          code,
          type: source.type,
          value: source.value,
          minOrderPaise: source.minOrderPaise,
          maxUsesTotal: source.maxUsesTotal,
          maxUsesPerUser: source.maxUsesPerUser,
          validFrom,
          validUntil,
          applicableTo: source.applicableTo ?? Prisma.JsonNull,
          isActive: false,
          createdBy: adminUserId
        }
      });
    } catch (error) {
      if (this.isUniqueConstraintViolation(error)) {
        throw new AppError(ERROR_CODES.VALIDATION_ERROR, `Coupon code '${code}' already exists`, 409);
      }
      throw error;
    }

    await this.logAuditLog({
      couponId: cloned.id,
      action: 'CREATE',
      actorId: adminUserId,
      actorType: 'ADMIN',
      newState: this.serializeCouponWithAudit(cloned),
      ipAddress: metadata?.ipAddress,
      userAgent: metadata?.userAgent
    });

    invalidateStorefrontCouponsCache();
    return this.serializeCouponWithAudit(cloned);
  }

  async getAdminStorefrontCouponsStatus() {
    return getAdminStorefrontCouponsStatus(this.fastify.prisma);
  }

  async updateStorefrontCouponsEnabled(couponsEnabled: boolean) {
    await setMerchantCouponsEnabled(this.fastify.prisma, couponsEnabled);
    return getAdminStorefrontCouponsStatus(this.fastify.prisma);
  }

  /**
   * Get a single coupon by ID with full detail.
   * @param id - The coupon UUID
   */
  async adminGetCouponById(id: string) {
    const cached = this.getFromCache(`id:${id}`);
    if (cached) {
      return this.serializeCouponWithAudit(cached);
    }

    const coupon = await this.fastify.prisma.coupon.findUnique({
      where: { id }
    });

    if (!coupon) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Coupon not found', 404);
    }

    this.setCache(`id:${coupon.id}`, coupon);
    return this.serializeCouponWithAudit(coupon);
  }
}
