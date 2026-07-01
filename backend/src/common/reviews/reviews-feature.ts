import type { Prisma, PrismaClient } from '@prisma/client';

type ReviewsPrisma = PrismaClient | Prisma.TransactionClient;

const SETTINGS_SINGLETON_KEY = 'default';

/**
 * Whether storefront customer reviews are enabled, per the merchant toggle in
 * Admin → Settings (`StoreSettings.reviewsEnabled`). This replaces the build-time
 * `FEATURE_REVIEWS_ENABLED` env flag so merchants can flip reviews on/off from the
 * admin UI without a redeploy. Mirrors `isStorefrontCouponsEnabled`.
 */
export async function isStorefrontReviewsEnabled(prisma: ReviewsPrisma): Promise<boolean> {
  const settings = await prisma.storeSettings.findUnique({
    where: { singletonKey: SETTINGS_SINGLETON_KEY },
    select: { reviewsEnabled: true }
  });
  return settings?.reviewsEnabled ?? false;
}
