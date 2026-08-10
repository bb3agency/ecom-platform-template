import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { invalidateStorefrontCouponsCache } from '@common/coupons/coupons-feature';
import { CartService } from './cart.service';

/**
 * GST tax breakup on GET /cart/delivery-rates (2026-08-10).
 *
 * Prices are GST-INCLUSIVE: the breakup carves CGST+SGST (intra-state) or IGST
 * (inter-state) OUT of the GOODS total (items − discount) — taxable + tax always
 * equals what the customer pays for the goods, and totals never change.
 * Delivery/shipping is untaxed and excluded from the tax base (merchant policy
 * 2026-08-10). Classification is pincode-based: admin pickup pincode vs the
 * buyer's delivery pincode.
 */

const STORE_SETTINGS = {
  // GST billing on via the merchant toggle + master flag stored in the DB row
  // (the FEATURE_GST_INVOICING_ENABLED env default is false in tests).
  gstInvoicingEnabled: true,
  gstBillingEnabled: true,
  gstin: '36ABCDE1234F1Z5',
  sellerState: 'Telangana',
  pickupPincode: '500001'
};

function createFastify(settings: Record<string, unknown> | null): FastifyInstance {
  return {
    prisma: {
      storeSettings: {
        findUnique: vi.fn().mockResolvedValue(settings)
      },
      cart: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'cart_1',
          coupon: null,
          items: [
            {
              quantity: 2,
              priceSnapshot: 30000, // 2 × ₹300 at 5% GST
              variant: {
                weight: 500,
                gstRatePercent: 5,
                productId: 'p1',
                product: { categoryId: 'c1', isLocalDeliveryOnly: false, attributes: null }
              }
            },
            {
              quantity: 1,
              priceSnapshot: 40000, // ₹400 at 18% GST
              variant: {
                weight: 250,
                gstRatePercent: 18,
                productId: 'p2',
                product: { categoryId: 'c1', isLocalDeliveryOnly: false, attributes: null }
              }
            }
          ]
        })
      }
    },
    log: { warn: vi.fn(), error: vi.fn() }
  } as unknown as FastifyInstance;
}

describe('CartService delivery-rates GST tax breakup', () => {
  beforeEach(() => {
    invalidateStorefrontCouponsCache();
    // Force the noop shipping path (no provider credentials).
    vi.stubEnv('DELHIVERY_API_KEY', '');
    vi.stubEnv('DELHIVERY_PICKUP_PINCODE', '');
    vi.stubEnv('DELHIVERY_BASE_URL', '');
    vi.stubEnv('SHIPROCKET_EMAIL', '');
    vi.stubEnv('SHIPROCKET_PASSWORD', '');
    vi.stubEnv('SHIPROCKET_PICKUP_PINCODE', '');
  });

  afterEach(() => {
    invalidateStorefrontCouponsCache();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('carves CGST+SGST out of the inclusive total for an intra-state pincode', async () => {
    const service = new CartService(createFastify(STORE_SETTINGS));
    // Seller 500001 (Telangana) → buyer 500090 (Telangana) = intra-state.
    const result = await service.getDeliveryRates('user_1', undefined, '500090');

    // ₹600 line at 5%: taxable 57143, tax 2857 → CGST 1429 + SGST 1428.
    // ₹400 line at 18%: taxable 33898, tax 6102 → CGST 3051 + SGST 3051.
    expect(result.taxBreakup).toEqual({
      gstBillingEnabled: true,
      isInterState: false,
      taxableAmountPaise: 91041,
      cgstPaise: 4480,
      sgstPaise: 4479,
      igstPaise: 0
    });
    // The carve-out reconciles exactly with the GOODS total — shipping is untaxed
    // and never part of the tax base.
    const breakup = result.taxBreakup!;
    expect(
      breakup.taxableAmountPaise + breakup.cgstPaise + breakup.sgstPaise + breakup.igstPaise
    ).toBe(100000);
  });

  it('books the whole carved tax as IGST for an inter-state pincode', async () => {
    const service = new CartService(createFastify(STORE_SETTINGS));
    // Seller 500001 (Telangana) → buyer 560037 (Karnataka) = inter-state.
    const result = await service.getDeliveryRates('user_1', undefined, '560037');

    expect(result.taxBreakup).toEqual({
      gstBillingEnabled: true,
      isInterState: true,
      taxableAmountPaise: 91041,
      cgstPaise: 0,
      sgstPaise: 0,
      igstPaise: 8959
    });
  });

  it('omits the breakup entirely when GST billing is disabled', async () => {
    const service = new CartService(
      createFastify({ ...STORE_SETTINGS, gstBillingEnabled: false })
    );
    const result = await service.getDeliveryRates('user_1', undefined, '500090');
    expect(result).not.toHaveProperty('taxBreakup');
  });

  it('omits the breakup when the store has no settings row at all', async () => {
    const service = new CartService(createFastify(null));
    const result = await service.getDeliveryRates('user_1', undefined, '500090');
    expect(result).not.toHaveProperty('taxBreakup');
  });
});
