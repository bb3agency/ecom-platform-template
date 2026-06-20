import type { Prisma, PrismaClient } from '@prisma/client';
import { resolvePickupPincode } from '@common/shipping/resolve-pickup-pincode';

type CouponsPrisma = PrismaClient | Prisma.TransactionClient;

const SETTINGS_SINGLETON_KEY = 'default';
const CACHE_TTL_MS = 30_000;

let cached: { value: boolean; expiresAt: number } | null = null;

/** Coupons customers can redeem right now (active, not deleted, within validity window). */
export function buildRedeemableStorefrontCouponWhere(now = new Date()): Prisma.CouponWhereInput {
  return {
    isActive: true,
    deletedAt: null,
    validFrom: { lte: now },
    OR: [{ validUntil: null }, { validUntil: { gte: now } }]
  };
}

export async function countRedeemableStorefrontCoupons(
  prisma: CouponsPrisma,
  now = new Date()
): Promise<number> {
  return prisma.coupon.count({
    where: buildRedeemableStorefrontCouponWhere(now)
  });
}

async function readMerchantCouponsEnabled(prisma: CouponsPrisma): Promise<boolean> {
  const settings = await prisma.storeSettings.findUnique({
    where: { singletonKey: SETTINGS_SINGLETON_KEY },
    select: { couponsEnabled: true }
  });
  return settings?.couponsEnabled ?? false;
}

/** Storefront coupons follow the merchant toggle in Admin → Coupons (StoreSettings.couponsEnabled). */
export async function isStorefrontCouponsEnabled(prisma: CouponsPrisma): Promise<boolean> {
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const value = await readMerchantCouponsEnabled(prisma);
  cached = { value, expiresAt: now + CACHE_TTL_MS };
  return value;
}

export async function setMerchantCouponsEnabled(
  prisma: PrismaClient,
  enabled: boolean
): Promise<boolean> {
  const defaultPickupPincode =
    (await resolvePickupPincode(prisma, { noopFallback: '500001' })) ?? '500001';

  const updated = await prisma.storeSettings.upsert({
    where: { singletonKey: SETTINGS_SINGLETON_KEY },
    update: { couponsEnabled: enabled },
    create: {
      singletonKey: SETTINGS_SINGLETON_KEY,
      pickupPincode: defaultPickupPincode,
      couponsEnabled: enabled
    },
    select: { couponsEnabled: true }
  });

  invalidateStorefrontCouponsCache();
  return updated.couponsEnabled;
}

export async function getAdminStorefrontCouponsStatus(prisma: CouponsPrisma): Promise<{
  merchantEnabled: boolean;
  storefrontEnabled: boolean;
  redeemableCouponCount: number;
}> {
  const [merchantEnabled, redeemableCouponCount] = await Promise.all([
    isStorefrontCouponsEnabled(prisma),
    countRedeemableStorefrontCoupons(prisma)
  ]);

  return {
    merchantEnabled,
    storefrontEnabled: merchantEnabled,
    redeemableCouponCount
  };
}

export function invalidateStorefrontCouponsCache(): void {
  cached = null;
}
