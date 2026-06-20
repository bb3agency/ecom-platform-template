import { CouponType } from '@prisma/client';

export type CouponScopeInput = {
  productIds?: string[];
  categoryIds?: string[];
};

export type CreateCouponInput = {
  code: string;
  type: CouponType;
  value: number;
  minOrderPaise?: number;
  maxUsesTotal?: number;
  maxUsesPerUser?: number | null;
  validFrom: string;
  validUntil?: string;
  applicableTo?: CouponScopeInput;
  isActive?: boolean;
};

export type UpdateCouponInput = Partial<CreateCouponInput>;

export type UpdateCouponStatusInput = {
  isActive: boolean;
};

export type AdminListCouponsQuery = {
  page?: number;
  limit?: number;
  code?: string;
  status?: 'active' | 'expired' | 'paused';
  /** Filter by CouponType: PERCENTAGE_OFF | FLAT_AMOUNT_OFF | FREE_SHIPPING */
  type?: 'PERCENTAGE_OFF' | 'FLAT_AMOUNT_OFF' | 'FREE_SHIPPING';
  from?: string;
  to?: string;
};

export type CouponAnalyticsQuery = {
  page?: number;
  limit?: number;
  from?: string;
  to?: string;
};

// Extended status with deleted state
export type CouponStatus = 'active' | 'paused' | 'expired' | 'deleted';

// Coupon scope output (deserialized from DB)
export type CouponScope = {
  productIds?: string[];
  categoryIds?: string[];
};

// Full coupon with audit fields
export type CouponWithAudit = {
  id: string;
  code: string;
  type: CouponType;
  value: number;
  minOrderPaise: number;
  maxUsesTotal: number | null;
  maxUsesPerUser: number | null;
  usesCount: number;
  isActive: boolean;
  validFrom: string;
  validUntil: string | null;
  status: CouponStatus;
  applicableTo: CouponScope | null;

  // Audit fields
  createdBy: string | null;
  createdByName?: string; // Joined from admin user
  updatedBy: string | null;
  updatedByName?: string;
  deletedAt: string | null;
  deletedBy: string | null;
  deletedByName?: string;

  createdAt: string;
  updatedAt: string;
};

// Audit log entry
export type CouponAuditLogEntry = {
  id: string;
  action: 'CREATE' | 'UPDATE' | 'DELETE' | 'RESTORE' | 'PAUSE' | 'RESUME' | 'ACTIVATE';
  actorId: string;
  actorName: string;
  actorType: 'ADMIN' | 'SYSTEM';
  changes: Record<string, { from: unknown; to: unknown }> | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
};

// Query for listing audit logs
export type ListCouponAuditQuery = {
  page?: number;
  limit?: number;
  action?: string;
  actorId?: string;
  fromDate?: string;
  toDate?: string;
};

// Detailed coupon usage stats
export type CouponUsageStats = {
  couponId: string;
  code: string;
  usesCount: number;
  totalDiscountPaise: number;
  uniqueUsers: number;
  averageDiscountPaise: number;
  revenueGeneratedPaise: number;
  lastUsedAt: string | null;
};

// Input for restore operation
export type RestoreCouponInput = {
  id: string;
  adminUserId: string;
  ipAddress?: string;
  userAgent?: string;
};

// Audit metadata for tracking
export type AuditMetadata = {
  ipAddress?: string | undefined;
  userAgent?: string | undefined;
};
