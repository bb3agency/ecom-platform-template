import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getAdminStorefrontCouponsStatus,
  invalidateStorefrontCouponsCache,
  isStorefrontCouponsEnabled,
  setMerchantCouponsEnabled
} from './coupons-feature';

describe('isStorefrontCouponsEnabled', () => {
  beforeEach(() => {
    invalidateStorefrontCouponsCache();
  });

  it('returns merchant StoreSettings.couponsEnabled', async () => {
    const findUnique = vi.fn().mockResolvedValue({ couponsEnabled: true });
    const enabled = await isStorefrontCouponsEnabled({
      storeSettings: { findUnique },
      coupon: { count: vi.fn() }
    } as never);
    expect(enabled).toBe(true);
    expect(findUnique).toHaveBeenCalledWith({
      where: { singletonKey: 'default' },
      select: { couponsEnabled: true }
    });
  });

  it('returns false when store settings row is missing', async () => {
    const enabled = await isStorefrontCouponsEnabled({
      storeSettings: { findUnique: vi.fn().mockResolvedValue(null) },
      coupon: { count: vi.fn() }
    } as never);
    expect(enabled).toBe(false);
  });
});

describe('setMerchantCouponsEnabled', () => {
  beforeEach(() => {
    invalidateStorefrontCouponsCache();
  });

  it('upserts StoreSettings.couponsEnabled', async () => {
    const upsert = vi.fn().mockResolvedValue({ couponsEnabled: true });
    const findUnique = vi.fn().mockResolvedValue({ pickupPincode: '522007' });
    const enabled = await setMerchantCouponsEnabled(
      {
        storeSettings: { findUnique, upsert }
      } as never,
      true
    );
    expect(enabled).toBe(true);
    expect(upsert).toHaveBeenCalled();
  });
});

describe('getAdminStorefrontCouponsStatus', () => {
  beforeEach(() => {
    invalidateStorefrontCouponsCache();
  });

  it('reports merchant toggle and redeemable coupon count', async () => {
    const status = await getAdminStorefrontCouponsStatus({
      storeSettings: {
        findUnique: vi.fn().mockResolvedValue({ couponsEnabled: true })
      },
      coupon: { count: vi.fn().mockResolvedValue(2) }
    } as never);

    expect(status).toEqual({
      merchantEnabled: true,
      storefrontEnabled: true,
      redeemableCouponCount: 2
    });
  });
});
