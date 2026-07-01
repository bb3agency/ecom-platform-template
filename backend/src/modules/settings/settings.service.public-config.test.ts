import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { featureFlags } from '@config/feature-flags';
import { invalidateStorefrontCouponsCache } from '@common/coupons/coupons-feature';
import { SettingsService } from './settings.service';

describe('SettingsService getPublicStoreConfig', () => {
  const originalFlags = {
    reviews: featureFlags.reviews,
    wishlist: featureFlags.wishlist,
    gstInvoicing: featureFlags.gstInvoicing
  };

  beforeEach(() => {
    invalidateStorefrontCouponsCache();
  });

  afterEach(() => {
    featureFlags.reviews = originalFlags.reviews;
    featureFlags.wishlist = originalFlags.wishlist;
    featureFlags.gstInvoicing = originalFlags.gstInvoicing;
    invalidateStorefrontCouponsCache();
  });

  it('returns store settings and runtime feature flags for the storefront', async () => {
    // reviewsEnabled is now DB-driven (StoreSettings.reviewsEnabled); the env flag
    // is intentionally OFF here to prove the DB merchant toggle is what drives it.
    featureFlags.reviews = false;
    featureFlags.wishlist = true;
    featureFlags.gstInvoicing = false;

    const findUnique = vi.fn().mockImplementation(({ select }: { select?: Record<string, boolean> }) => {
      if (select?.couponsEnabled) {
        return Promise.resolve({ couponsEnabled: true });
      }
      return Promise.resolve({
        isCodEnabled: true,
        minOrderValuePaise: 25000,
        mobileOtpSignupEnabled: true,
        reviewsEnabled: true,
        storeName: 'Acme Store',
        sellerAddress: '12 Market Rd, Hyderabad',
        sellerState: 'Telangana',
        contactEmail: 'hello@acme.test',
        contactPhone: '+91 90000 00000'
      });
    });

    const fastify = {
      prisma: {
        storeSettings: { findUnique },
        coupon: { count: vi.fn() }
      }
    } as unknown as FastifyInstance;
    const service = new SettingsService(fastify);

    await expect(service.getPublicStoreConfig()).resolves.toEqual({
      isCodEnabled: true,
      minOrderValuePaise: 25000,
      mobileOtpSignupEnabled: true,
      couponsEnabled: true,
      reviewsEnabled: true,
      wishlistEnabled: true,
      gstInvoicingEnabled: false,
      // store identity/contact exposed for the storefront footer (sellerAddress → storeAddress)
      storeName: 'Acme Store',
      storeAddress: '12 Market Rd, Hyderabad',
      storeState: 'Telangana',
      contactEmail: 'hello@acme.test',
      contactPhone: '+91 90000 00000'
    });
  });

  it('reflects merchant couponsEnabled=false from the database', async () => {
    const findUnique = vi.fn().mockImplementation(({ select }: { select?: Record<string, boolean> }) => {
      if (select?.couponsEnabled) {
        return Promise.resolve({ couponsEnabled: false });
      }
      return Promise.resolve({
        isCodEnabled: false,
        minOrderValuePaise: 0,
        mobileOtpSignupEnabled: false
      });
    });

    const fastify = {
      prisma: {
        storeSettings: { findUnique },
        coupon: { count: vi.fn() }
      }
    } as unknown as FastifyInstance;
    const service = new SettingsService(fastify);

    await expect(service.getPublicStoreConfig()).resolves.toEqual(
      expect.objectContaining({
        couponsEnabled: false
      })
    );
  });
});
