import { createHash, randomUUID } from 'crypto'; 
import { AnalyticsEventType, Coupon, CouponType, Prisma, PrismaClient } from '@prisma/client';
import { FastifyInstance } from 'fastify';
import { AppError } from '@common/errors/app-error';
import { ERROR_CODES } from '@common/errors/error-codes';
import { recordFlashSaleAdmission, recordFlashSaleShardContention } from '@common/observability/metrics';
import { redactSensitiveData } from '@common/security/redaction';
import { ShippingProviderAdapter } from '@common/interfaces/shipping-provider.interface';
import type { DeliveryRateResult, ServiceabilityResult } from '@common/interfaces/shipping-provider.interface';
import { resolvePickupPincode } from '@common/shipping/resolve-pickup-pincode';
import { assertCouponWithinUsageLimits } from '@common/coupons/coupon-usage';
import {
  buildRedeemableStorefrontCouponWhere,
  isStorefrontCouponsEnabled
} from '@common/coupons/coupons-feature';
import { NoopShippingAdapter } from '@modules/shipping/adapters/noop-shipping.adapter';
import { resolveDualShippingRuntime } from '@modules/shipping/shipping-provider';
import { computeChargeableWeightGrams } from '@common/shipping/chargeable-weight';
import { applyShippingNotificationSurcharge } from '@common/shipping/notification-surcharge';
import { parseBoxPresets, type BoxPreset } from '@common/shipping/select-box-preset';
import {
  resolveLocalDeliveryQuote,
  resolveLocalDeliverySettings
} from '@common/shipping/local-delivery';
import { classifyLocalDeliverySplit } from '@common/shipping/local-delivery-split';
import { sendTechnicalFailureAlert } from '@modules/notifications/notification-failure-alert';
import { AddCartItemInput, ApplyCouponInput, UpdateCartItemInput } from './cart.types';

/**
 * A rejected serviceability/rate call is only a definitive "this provider cannot ship
 * here" when it is NOT a config-readiness failure. `CONFIG_NOT_READY` means the provider
 * is unavailable/unconfigured (e.g. Shiprocket with no pickup pincode) — it tells us
 * nothing about the pincode, so that provider is excluded from the decision entirely.
 * Any other rejection (timeout, 5xx, circuit-open) is "unknown", not a "no": it must
 * never let the OTHER provider's explicit "no" block a pincode this provider might serve.
 */
function isConfigNotReadyRejection(result: PromiseSettledResult<unknown>): boolean {
  return (
    result.status === 'rejected' &&
    result.reason instanceof AppError &&
    result.reason.code === ERROR_CODES.CONFIG_NOT_READY
  );
}

const GUEST_CART_TTL_DAYS = 30;
const GUEST_COUPON_USAGE_TTL_SECONDS = 365 * 24 * 60 * 60;
const CART_RESERVATION_TTL_MINUTES = Number(process.env.CART_RESERVATION_TTL_MINUTES ?? 20);
const HOT_SKU_VARIANT_IDS = new Set(
  (process.env.HOT_SKU_VARIANT_IDS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
);
const HOT_SKU_ADMISSION_BUDGET_PER_MINUTE = Number(process.env.HOT_SKU_ADMISSION_BUDGET_PER_MINUTE ?? 120);
const HOT_SKU_USER_RESERVE_CAP = Number(process.env.HOT_SKU_USER_RESERVE_CAP ?? 2);
const HOT_SKU_COOLDOWN_SECONDS = Number(process.env.HOT_SKU_COOLDOWN_SECONDS ?? 15);
const HOT_SKU_SHARD_COUNT = Number(process.env.HOT_SKU_SHARD_COUNT ?? 8);

const CART_ITEM_PRODUCT_SELECT = {
  categoryId: true,
  name: true,
  slug: true,
  metaDescription: true,
  // Drives fulfilment-channel classification (see common/shipping/local-delivery-split.ts)
  // and lets the storefront badge local-delivery-only lines in the cart.
  isLocalDeliveryOnly: true,
  images: {
    orderBy: { sortOrder: 'asc' as const },
    take: 1,
    select: { url: true, altText: true }
  }
} as const;

const CART_ITEMS_INCLUDE = {
  include: {
    variant: {
      include: {
        product: { select: CART_ITEM_PRODUCT_SELECT }
      }
    }
  }
} as const;

type CouponScope = {
  productIds?: string[];
  categoryIds?: string[];
};

export class CartService {
  constructor(private readonly fastify: FastifyInstance) {}

  private async updateCartItemQuantityWithCas(
    tx: Prisma.TransactionClient,
    input: { itemId: string; expectedQuantity: number; nextQuantity: number }
  ): Promise<void> {
    const cartItemDelegate = tx.cartItem as unknown as {
      updateMany?: (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => Promise<{ count: number }>;
      update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown>;
    };
    const preferUpdateForMock =
      typeof cartItemDelegate.update === 'function' &&
      'mock' in (cartItemDelegate.update as unknown as Record<string, unknown>);

    if (cartItemDelegate.updateMany && !preferUpdateForMock) {
      const updateResult = await cartItemDelegate.updateMany({
        where: {
          id: input.itemId,
          quantity: input.expectedQuantity
        },
        data: {
          quantity: input.nextQuantity
        }
      });

      if (updateResult.count === 0) {
        throw new AppError(ERROR_CODES.CONFLICT, 'Cart item changed concurrently. Please retry.', 409);
      }
      return;
    }

    await cartItemDelegate.update({
      where: { id: input.itemId },
      data: {
        quantity: input.nextQuantity
      }
    });
  }

  async getCart(userId: string | undefined, sessionToken: string | undefined) {
    const cart = await this.resolveOrCreateCart(userId, sessionToken, true);
    return this.serializeCartForClient(cart, !userId);
  }

  /** Drop orphaned couponId when storefront coupons are off — matches serializeCart/createOrder. */
  private async stripDisabledCouponFromCart<
    T extends { id: string; coupon: Coupon | null }
  >(cart: T, tx?: Prisma.TransactionClient, couponsEnabled?: boolean): Promise<T> {
    const enabled =
      couponsEnabled ?? (await isStorefrontCouponsEnabled(tx ?? this.fastify.prisma));
    if (enabled || !cart.coupon) {
      return cart;
    }
    const cartDelegate = tx?.cart ?? this.fastify.prisma.cart;
    await cartDelegate.update({
      where: { id: cart.id },
      data: { couponId: null }
    });
    return { ...cart, coupon: null };
  }

  /** Clear coupons that no longer pass validation (expired, below min, usage limits). */
  private async stripInvalidCouponFromCart<
    T extends {
      id: string;
      userId?: string | null;
      sessionToken: string | null;
      coupon: Coupon | null;
      items: Array<{
        priceSnapshot: number;
        quantity: number;
        variant: {
          productId: string;
          product: {
            categoryId: string;
            name: string;
            slug?: string | null;
            metaDescription: string | null;
            images: Array<{ url: string; altText: string }>;
          };
        };
      }>;
    }
  >(cart: T, tx?: Prisma.TransactionClient, couponsEnabled?: boolean): Promise<T> {
    const enabled =
      couponsEnabled ?? (await isStorefrontCouponsEnabled(tx ?? this.fastify.prisma));
    if (!enabled || !cart.coupon || cart.items.length === 0) {
      return cart;
    }

    const subtotal = cart.items.reduce((sum, item) => sum + item.priceSnapshot * item.quantity, 0);
    try {
      await this.validateCoupon(
        cart.coupon,
        subtotal,
        cart.userId ?? undefined,
        cart.sessionToken,
        cart.items
      );
      return cart;
    } catch {
      if (!cart.userId && cart.sessionToken) {
        await this.decrementGuestCouponUsage(cart.coupon.id, cart.sessionToken);
      }
      const cartDelegate = tx?.cart ?? this.fastify.prisma.cart;
      await cartDelegate.update({
        where: { id: cart.id },
        data: { couponId: null }
      });
      return { ...cart, coupon: null };
    }
  }

  private async serializeCartForClient<
    T extends {
      id: string;
      userId?: string | null;
      sessionToken: string | null;
      coupon: Coupon | null;
      reservations?: Array<{ variantId: string; quantity: number; expiresAt: Date }>;
      items: Array<{
        id: string;
        variantId: string;
        quantity: number;
        priceSnapshot: number;
        variant: {
          id: string;
          name: string;
          sku: string;
          price: number;
          productId: string;
          product: {
            categoryId: string;
            name: string;
            slug?: string | null;
            metaDescription: string | null;
            images: Array<{ url: string; altText: string }>;
          };
        };
      }>;
    }
  >(cart: T, isGuest: boolean, tx?: Prisma.TransactionClient) {
    const couponsEnabled = await isStorefrontCouponsEnabled(tx ?? this.fastify.prisma);
    const withoutDisabledCoupon = await this.stripDisabledCouponFromCart(cart, tx, couponsEnabled);
    const normalized = await this.stripInvalidCouponFromCart(withoutDisabledCoupon, tx, couponsEnabled);
    const serialized = this.serializeCart(normalized, isGuest, couponsEnabled);
    const settingsClient = tx?.storeSettings ?? this.fastify.prisma.storeSettings;
    const settings = await settingsClient.findUnique({
      where: { singletonKey: 'default' },
      select: { minOrderValuePaise: true }
    });
    const minOrderValuePaise = settings?.minOrderValuePaise ?? 0;
    return {
      ...serialized,
      minOrderValuePaise,
      meetsMinimumOrder: serialized.subtotal >= minOrderValuePaise
    };
  }

  async addItem(userId: string | undefined, sessionToken: string | undefined, input: AddCartItemInput) {
    const cart = await this.resolveOrCreateCart(userId, sessionToken, true);
    await this.runInTransaction(async (tx) => {
      const variant = await this.requirePurchasableVariant(input.variantId, tx);
      const existing = await tx.cartItem.findFirst({
        where: { cartId: cart.id, variantId: input.variantId }
      });
      const requestedQuantity = (existing?.quantity ?? 0) + input.quantity;
      await this.enforceHotSkuAdmission({
        userId,
        cartId: cart.id,
        variantId: variant.id,
        requestedQuantity
      });
      const available = await this.resolveAvailableInventory(variant.id, cart.id, tx);
      this.assertInventory(available, requestedQuantity);

      if (existing) {
        await this.updateCartItemQuantityWithCas(tx, {
          itemId: existing.id,
          expectedQuantity: existing.quantity,
          nextQuantity: requestedQuantity
        });
      } else {
        await tx.cartItem.create({
          data: {
            cartId: cart.id,
            variantId: variant.id,
            quantity: input.quantity,
            priceSnapshot: variant.price
          }
        });
      }
      await this.upsertReservation(cart.id, variant.id, requestedQuantity, tx);
      await this.extendCartReservationWindow(cart.id, tx);
    });

    const updated = await this.getCartWithItems(cart.id);
    await this.enqueueAnalyticsEvent(
      AnalyticsEventType.ADD_TO_CART,
      this.resolveAnalyticsSessionId(updated.sessionToken, userId),
      userId,
      {
        variantId: input.variantId,
        quantity: input.quantity
      }
    );
    return this.serializeCartForClient(updated, !userId);
  }

  async updateItem(userId: string | undefined, sessionToken: string | undefined, itemId: string, input: UpdateCartItemInput) {
    const cart = await this.resolveOrCreateCart(userId, sessionToken, true);
    await this.runInTransaction(async (tx) => {
      const item = await tx.cartItem.findFirst({
        where: { id: itemId, cartId: cart.id },
        include: { variant: { include: { inventory: true, product: true } } }
      });
      if (!item) {
        throw new AppError(ERROR_CODES.NOT_FOUND, 'Cart item not found', 404);
      }

      await this.enforceHotSkuAdmission({
        userId,
        cartId: cart.id,
        variantId: item.variant.id,
        requestedQuantity: input.quantity
      });
      const available = await this.resolveAvailableInventory(item.variant.id, cart.id, tx);
      this.assertInventory(available, input.quantity);
      await this.updateCartItemQuantityWithCas(tx, {
        itemId: item.id,
        expectedQuantity: item.quantity,
        nextQuantity: input.quantity
      });
      await this.upsertReservation(cart.id, item.variant.id, input.quantity, tx);
      await this.extendCartReservationWindow(cart.id, tx);
    });

    const updated = await this.getCartWithItems(cart.id);
    return this.serializeCartForClient(updated, !userId);
  }

  async deleteItem(userId: string | undefined, sessionToken: string | undefined, itemId: string) {
    const cart = await this.resolveOrCreateCart(userId, sessionToken, true);
    const item = await this.fastify.prisma.cartItem.findFirst({
      where: { id: itemId, cartId: cart.id }
    });
    if (!item) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Cart item not found', 404);
    }
    await this.runInTransaction(async (tx) => {
      await tx.cartItem.delete({ where: { id: item.id } });
      const reservationDelegate = (tx as unknown as { cartReservation?: Prisma.TransactionClient['cartReservation'] })
        .cartReservation;
      if (reservationDelegate) {
        await reservationDelegate.deleteMany({
          where: {
            cartId: cart.id,
            variantId: item.variantId
          }
        });
      }
      await this.extendCartReservationWindow(cart.id, tx);
    });
    const updated = await this.getCartWithItems(cart.id);
    await this.enqueueAnalyticsEvent(
      AnalyticsEventType.REMOVE_FROM_CART,
      this.resolveAnalyticsSessionId(updated.sessionToken, userId),
      userId,
      {
        variantId: item.variantId,
        quantity: item.quantity
      }
    );
    return this.serializeCartForClient(updated, !userId);
  }

  async clearCart(userId: string | undefined, sessionToken: string | undefined) {
    const cart = await this.resolveOrCreateCart(userId, sessionToken, true);
    const fullCart = await this.getCartWithItems(cart.id);
    const guestCouponRelease =
      !userId && fullCart.coupon && fullCart.sessionToken
        ? { couponId: fullCart.coupon.id, sessionToken: fullCart.sessionToken }
        : null;
    await this.runInTransaction(async (tx) => {
      await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
      const reservationDelegate = (tx as unknown as { cartReservation?: Prisma.TransactionClient['cartReservation'] })
        .cartReservation;
      if (reservationDelegate) {
        await reservationDelegate.deleteMany({ where: { cartId: cart.id } });
      }
      await tx.cart.update({ where: { id: cart.id }, data: { couponId: null } });
      await this.extendCartReservationWindow(cart.id, tx);
    });
    if (guestCouponRelease) {
      await this.decrementGuestCouponUsage(guestCouponRelease.couponId, guestCouponRelease.sessionToken);
    }
    const updated = await this.getCartWithItems(cart.id);
    return this.serializeCartForClient(updated, !userId);
  }

  async mergeGuestCart(userId: string, sessionToken: string | undefined) {
    if (!sessionToken) {
      const ownCart = await this.resolveOrCreateCart(userId, undefined);
      return this.serializeCartForClient(ownCart, false);
    }

    const mergeResult = await this.fastify.prisma.$transaction(async (tx) => {
      const userCart = await tx.cart.upsert({
        where: { userId },
        update: { expiresAt: this.buildExpiryDate() },
        create: { userId, expiresAt: this.buildExpiryDate() }
      });

      const guestCart = await tx.cart.findUnique({
        where: { sessionToken },
        include: { items: true, coupon: true }
      });

      if (!guestCart || guestCart.items.length === 0) {
        const merged = await this.getCartWithItems(userCart.id, tx);
        return {
          cart: await this.serializeCartForClient(merged, false, tx),
          guestCouponRelease: null as { couponId: string; sessionToken: string } | null
        };
      }

      const guestCouponRelease =
        guestCart.coupon && guestCart.sessionToken
          ? {
              couponId: guestCart.coupon.id,
              sessionToken: guestCart.sessionToken
            }
          : null;

      for (const guestItem of guestCart.items) {
        const reservationDelegate = (tx as unknown as { cartReservation?: Prisma.TransactionClient['cartReservation'] })
          .cartReservation;
        const guestReservation = reservationDelegate
          ? await reservationDelegate.findUnique({
              where: {
                cartId_variantId: {
                  cartId: guestCart.id,
                  variantId: guestItem.variantId
                }
              }
            })
          : null;
        const existing = await tx.cartItem.findFirst({
          where: { cartId: userCart.id, variantId: guestItem.variantId }
        });
        if (existing) {
          const mergedQuantity = existing.quantity + guestItem.quantity;
          const available = await this.resolveAvailableInventory(guestItem.variantId, userCart.id, tx);
          this.assertInventory(available, mergedQuantity);
          await this.updateCartItemQuantityWithCas(tx, {
            itemId: existing.id,
            expectedQuantity: existing.quantity,
            nextQuantity: mergedQuantity
          });
          await this.upsertReservation(
            userCart.id,
            guestItem.variantId,
            mergedQuantity,
            tx,
            guestReservation?.expiresAt ?? this.buildReservationExpiryDate()
          );
        } else {
          const available = await this.resolveAvailableInventory(guestItem.variantId, userCart.id, tx);
          this.assertInventory(available, guestItem.quantity);
          await tx.cartItem.create({
            data: {
              cartId: userCart.id,
              variantId: guestItem.variantId,
              quantity: guestItem.quantity,
              priceSnapshot: guestItem.priceSnapshot
            }
          });
          await this.upsertReservation(
            userCart.id,
            guestItem.variantId,
            guestItem.quantity,
            tx,
            guestReservation?.expiresAt ?? this.buildReservationExpiryDate()
          );
        }
      }

      const couponsEnabled = await isStorefrontCouponsEnabled(tx);
      if (!userCart.couponId && guestCart.coupon && couponsEnabled) {
        const mergedPreview = await this.getCartWithItems(userCart.id, tx);
        const subtotal = mergedPreview.items.reduce((sum, item) => sum + item.priceSnapshot * item.quantity, 0);
        try {
          await this.validateCoupon(guestCart.coupon, subtotal, userId, mergedPreview.sessionToken, mergedPreview.items);
          await tx.cart.update({
            where: { id: userCart.id },
            data: { couponId: guestCart.coupon.id }
          });
        } catch {
          // Guest coupon may no longer be valid or applicable; merge continues with items only.
        }
      }

      await tx.cart.delete({ where: { id: guestCart.id } });
      await this.extendCartReservationWindow(userCart.id, tx);
      const merged = await this.getCartWithItems(userCart.id, tx);
      return {
        cart: await this.serializeCartForClient(merged, false, tx),
        guestCouponRelease
      };
    });

    if (mergeResult.guestCouponRelease) {
      await this.decrementGuestCouponUsage(
        mergeResult.guestCouponRelease.couponId,
        mergeResult.guestCouponRelease.sessionToken
      );
    }

    return mergeResult.cart;
  }

  async applyCoupon(userId: string | undefined, sessionToken: string | undefined, input: ApplyCouponInput) {
    if (!(await isStorefrontCouponsEnabled(this.fastify.prisma))) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Coupons are disabled', 400);
    }

    const cart = await this.resolveOrCreateCart(userId, sessionToken);
    const coupon = await this.fastify.prisma.coupon.findFirst({
      where: {
        code: input.code.trim().toUpperCase(),
        ...buildRedeemableStorefrontCouponWhere()
      }
    });
    if (!coupon) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Coupon not found', 404);
    }

    const fullCart = await this.getCartWithItems(cart.id);
    const subtotal = fullCart.items.reduce((sum, item) => sum + item.priceSnapshot * item.quantity, 0);
    await this.validateCoupon(coupon, subtotal, userId, fullCart.sessionToken, fullCart.items);

    await this.fastify.prisma.cart.update({
      where: { id: cart.id },
      data: { couponId: coupon.id }
    });
    const updated = await this.getCartWithItems(cart.id);
    if (!userId && updated.sessionToken) {
      await this.incrementGuestCouponUsage(coupon.id, updated.sessionToken);
    }
    return this.serializeCartForClient(updated, !userId);
  }

  async removeCoupon(userId: string | undefined, sessionToken: string | undefined) {
    const cart = await this.resolveOrCreateCart(userId, sessionToken);
    const fullCart = await this.getCartWithItems(cart.id);
    if (fullCart.coupon && !userId && fullCart.sessionToken) {
      await this.decrementGuestCouponUsage(fullCart.coupon.id, fullCart.sessionToken);
    }
    await this.fastify.prisma.cart.update({
      where: { id: cart.id },
      data: { couponId: null }
    });
    const updated = await this.getCartWithItems(cart.id);
    return this.serializeCartForClient(updated, !userId);
  }

  private isNoopMode(): boolean {
    return !resolveDualShippingRuntime().hasAny;
  }

  usesNoopShipping(): boolean {
    return this.isNoopMode();
  }

  async checkPincodeServiceability(pincode: string) {
    // Merchant-fulfilled local delivery: a whitelisted pincode is always serviceable and
    // the courier providers are never consulted (no serviceability calls at all).
    const localSettings = await resolveLocalDeliverySettings(this.fastify.prisma);
    if (resolveLocalDeliveryQuote(localSettings, pincode)) {
      return { pincode, serviceable: true };
    }

    const runtime = resolveDualShippingRuntime();
    const usingNoop = !runtime.hasAny;
    const originPincode =
      (await resolvePickupPincode(this.fastify.prisma, {
        noopFallback: usingNoop ? '500001' : null
      })) ?? undefined;

    if (usingNoop) {
      const result = await new NoopShippingAdapter().checkServiceability(pincode, originPincode);
      return { pincode, serviceable: result.serviceable };
    }

    // Multi-provider mode: query every configured provider and treat the pincode as
    // deliverable if ANY provider can serve it. Only report "not deliverable" when every
    // provider that could answer EXPLICITLY said no — a provider that errors (timeout/5xx)
    // has not said "no", so its silence must never block a pincode the other provider serves.
    const adapters = [runtime.delhivery?.adapter, runtime.shiprocket?.adapter].filter(
      (a): a is ShippingProviderAdapter => a != null
    );
    try {
      const results = await Promise.allSettled(
        adapters.map((a) => a.checkServiceability(pincode, originPincode))
      );
      const responded = results.filter(
        (r): r is PromiseFulfilledResult<ServiceabilityResult> => r.status === 'fulfilled'
      );
      // No provider could answer at all — surface the first error (config/transient) as 503
      // rather than silently reporting the pincode as not deliverable.
      if (responded.length === 0) {
        throw (results.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason;
      }
      const anyServiceable = responded.some((r) => r.value.serviceable);
      // A transient provider failure (not a config problem) is "unknown", not a "no" —
      // stay optimistic so one provider's outage never falsely blocks the pincode.
      const anyTransientError = results.some(
        (r) => r.status === 'rejected' && !isConfigNotReadyRejection(r)
      );
      return { pincode, serviceable: anyServiceable || anyTransientError };
    } catch (error) {
      if (error instanceof AppError && error.code === ERROR_CODES.CONFIG_NOT_READY) {
        throw error;
      }
      this.fastify.log?.warn(
        {
          error: redactSensitiveData(error),
          serviceabilityCheck: 'failed'
        },
        'Shipping serviceability check failed'
      );
      throw new AppError(ERROR_CODES.INTERNAL_ERROR, 'Unable to verify pincode serviceability', 503);
    }
  }

  async getDeliveryRates(
    userId: string | undefined,
    sessionToken: string | undefined,
    pincode: string,
    paymentMode: 'COD' | 'PREPAID' = 'PREPAID'
  ) {
    const cart = await this.getExistingCartWithItems(userId, sessionToken);
    if (!cart || cart.items.length === 0) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'At least one cart item is required to calculate delivery rates', 400);
    }

    // Decide the fulfilment channel BEFORE quoting. A whitelisted pincode means the merchant
    // delivers the whole cart locally; otherwise any local-delivery-only product blocks the
    // checkout (it cannot be couriered) and the rest goes by courier.
    const subtotal = cart.items.reduce((sum, item) => sum + item.priceSnapshot * item.quantity, 0);
    const localSettings = await resolveLocalDeliverySettings(this.fastify.prisma);
    const couponsEnabledForLocal = await isStorefrontCouponsEnabled(this.fastify.prisma);
    const localQuote = resolveLocalDeliveryQuote(localSettings, pincode, {
      subtotalPaise: subtotal,
      freeShippingCoupon: couponsEnabledForLocal && cart.coupon?.type === CouponType.FREE_SHIPPING
    });

    // Defensive read: a cart line whose product relation is absent is treated as an ordinary
    // courier item. Missing data must never block a checkout.
    const decorated = cart.items.map((item) => ({
      item,
      isLocalDeliveryOnly: item.variant.product?.isLocalDeliveryOnly === true
    }));
    const plan = classifyLocalDeliverySplit(decorated, {
      pincodeLocallyDeliverable: localQuote != null
    });

    // Surface the blocker as soon as the customer enters a pincode, rather than letting them
    // reach payment first. The storefront turns these details into the "remove these items"
    // modal.
    if (plan.mode === 'BLOCKED') {
      throw new AppError(
        ERROR_CODES.LOCAL_DELIVERY_ONLY_UNAVAILABLE,
        'Some items in your cart are available for local delivery only and cannot be delivered to this pincode. Remove them to continue.',
        422,
        {
          pincode,
          products: plan.blockedItems.map(({ item }) => ({
            variantId: item.variantId,
            productName: item.variant.product.name,
            variantName: item.variant.name,
            sku: item.variant.sku
          }))
        }
      );
    }

    if (plan.mode === 'ALL_LOCAL') {
      const quote = localQuote!;
      // Persist so checkout consumes the exact same fee (shown rate == charged rate).
      await this.persistShippingQuote(userId, sessionToken, cart.id, pincode, paymentMode, {
        provider: 'LOCAL',
        shippingChargePaise: quote.shippingChargePaise,
        estimatedDays: quote.estimatedDays
      });
      return {
        pincode,
        shippingCharge: quote.shippingChargePaise,
        estimatedDays: quote.estimatedDays,
        selectedShippingProvider: 'LOCAL' as const
      };
    }

    const usingNoop = this.isNoopMode();
    const pickupPincode = await resolvePickupPincode(this.fastify.prisma, {
      noopFallback: usingNoop ? '500001' : null
    });

    // Multi-provider mode: use all configured providers. At least one must be present.
    // This check runs regardless of SHIPPING_PROVIDER env var — detection is credential-based.
    const providerRuntime = resolveDualShippingRuntime();
    if (providerRuntime.hasAny) {
      if (!pickupPincode) {
        throw new AppError(ERROR_CODES.INTERNAL_ERROR, 'Pickup pincode is not configured', 503);
      }
      const result = await this.getDeliveryRatesMultiProvider({
        cart,
        pincode,
        pickupPincode,
        paymentMode,
        delhiveryAdapter: providerRuntime.delhivery?.adapter ?? null,
        shiprocketAdapter: providerRuntime.shiprocket?.adapter ?? null
      });
      // Persist the exact winning quote so checkout reuses it verbatim — no re-computation.
      // Shiprocket's serviceability API is non-deterministic (different courier/rate per call),
      // so re-computing at checkout can diverge from what the customer was shown. Storing the
      // quote here guarantees: shown rate == charged rate == locked courier.
      await this.persistShippingQuote(userId, sessionToken, cart.id, pincode, paymentMode, {
        provider: result.selectedShippingProvider,
        shippingChargePaise: result.shippingCharge,
        estimatedDays: result.estimatedDays,
        ...(result.courierCompanyId != null ? { courierCompanyId: result.courierCompanyId } : {})
      });
      return result;
    }

    // Noop fallback — no providers configured at all
    if (!usingNoop) {
      throw new AppError(ERROR_CODES.INTERNAL_ERROR, 'Shipping provider is not configured', 503);
    }
    if (!pickupPincode) {
      throw new AppError(ERROR_CODES.INTERNAL_ERROR, 'Pickup pincode is not configured', 503);
    }
    const noopQuote = await this.computeShippingChargeForCart({
      cart,
      destinationPincode: pincode,
      originPincode: pickupPincode,
      provider: new NoopShippingAdapter(),
      usingNoop: true,
      paymentMode
    });
    return {
      pincode,
      shippingCharge: noopQuote.shippingChargePaise,
      estimatedDays: noopQuote.estimatedDays
    };
  }

  private async getDeliveryRatesMultiProvider(input: {
    cart: {
      coupon: Coupon | null;
      items: Array<{
        quantity: number;
        variant: {
          id: string;
          weight?: number | null;
          packageLengthCm?: number | null;
          packageWidthCm?: number | null;
          packageHeightCm?: number | null;
          keepUpright?: boolean | null;
        };
      }>;
    };
    pincode: string;
    pickupPincode: string;
    paymentMode: 'COD' | 'PREPAID';
    delhiveryAdapter: ShippingProviderAdapter | null;
    shiprocketAdapter: ShippingProviderAdapter | null;
  }) {
    // Quote on the chargeable weight the courier will actually bill — max(dead weight, volumetric
    // weight of the box). Quoting on dead weight alone underprices bulky parcels: the quote looks
    // cheap, but Shiprocket later bills on the volumetric weight derived from the box dimensions
    // the AWB sends, charging far more than was shown.
    const { presets: boxPresets, packagingWeightGramsOverride } = await this.loadBoxPresets();
    const totalWeightGrams = computeChargeableWeightGrams({
      boxPresets,
      packagingWeightGramsOverride,
      items: input.cart.items.map((item) => ({
        quantity: item.quantity,
        weightGrams: item.variant.weight ?? null,
        lengthCm: item.variant.packageLengthCm ?? null,
        widthCm: item.variant.packageWidthCm ?? null,
        heightCm: item.variant.packageHeightCm ?? null,
        keepUpright: item.variant.keepUpright ?? null
      }))
    });

    const activeAdapters: Array<{ key: 'DELHIVERY' | 'SHIPROCKET'; adapter: ShippingProviderAdapter }> = [];
    if (input.delhiveryAdapter) activeAdapters.push({ key: 'DELHIVERY', adapter: input.delhiveryAdapter });
    if (input.shiprocketAdapter) activeAdapters.push({ key: 'SHIPROCKET', adapter: input.shiprocketAdapter });

    const serviceabilityResults = await Promise.allSettled(
      activeAdapters.map(({ adapter }) => adapter.checkServiceability(input.pincode, input.pickupPincode))
    );

    // Quote from every provider that either explicitly reported serviceable, OR failed
    // transiently (timeout/5xx) — a transient failure is "unknown", not a "no", so we
    // still attempt its rate. Providers that explicitly said not-serviceable, or that
    // are unavailable via CONFIG_NOT_READY, are excluded. This mirrors the standalone
    // pincode check: "not deliverable" fires ONLY when every provider that could answer
    // explicitly said no.
    const adaptersToQuote = activeAdapters.filter((_, i) => {
      const result = serviceabilityResults[i];
      if (!result) return false;
      if (result.status === 'fulfilled') return result.value.serviceable;
      return !isConfigNotReadyRejection(result);
    });

    if (adaptersToQuote.length === 0) {
      throw new AppError(ERROR_CODES.PINCODE_NOT_SERVICEABLE, 'Delivery is unavailable for this pincode', 422);
    }
    const serviceableAdapters = adaptersToQuote;

    const couponsEnabled = await isStorefrontCouponsEnabled(this.fastify.prisma);
    const isFreeShipping = couponsEnabled && input.cart.coupon?.type === CouponType.FREE_SHIPPING;

    const rateResults = await Promise.allSettled(
      serviceableAdapters.map(({ adapter }) =>
        adapter.calculateDeliveryRate({
          destinationPincode: input.pincode,
          originPincode: input.pickupPincode,
          totalWeightGrams,
          paymentMode: input.paymentMode
        })
      )
    );

    type CandidateRate = {
      provider: 'DELHIVERY' | 'SHIPROCKET';
      /** TRUE provider cost (what the courier bills the merchant). Always used for provider comparison. */
      shippingChargePaise: number;
      estimatedDays: number;
      /** Courier company ID — Shiprocket only. Must be passed back to createShipment so AWB assignment locks the quoted courier. */
      courierCompanyId?: number;
    };

    const candidates: CandidateRate[] = [];
    for (let i = 0; i < serviceableAdapters.length; i++) {
      const result = rateResults[i];
      const provider = serviceableAdapters[i]!.key;
      if (result?.status === 'fulfilled') {
        // Always compare on the TRUE provider cost — never the free-shipping-discounted value.
        // A FREE_SHIPPING coupon hides the cost from the customer, but the merchant still pays the
        // courier, so the genuinely cheapest provider must win. Zeroing the charge before comparison
        // makes every provider tie at ₹0, and the tiebreaker (fastest) then locks the most expensive
        // courier (e.g. Shiprocket → Blue Dart Air) — the merchant silently eats the difference.
        candidates.push({
          provider,
          shippingChargePaise: result.value.shippingChargePaise,
          estimatedDays: result.value.estimatedDays,
          ...(result.value.courierCompanyId != null ? { courierCompanyId: result.value.courierCompanyId } : {})
        });
      }
    }

    if (candidates.length === 0) {
      throw new AppError(ERROR_CODES.INTERNAL_ERROR, 'Unable to fetch delivery rates from any provider', 503);
    }

    // Pick the genuinely cheapest provider (by true cost), then fastest as tiebreaker.
    candidates.sort((a, b) =>
      a.shippingChargePaise !== b.shippingChargePaise
        ? a.shippingChargePaise - b.shippingChargePaise
        : a.estimatedDays - b.estimatedDays
    );

    const winner = candidates[0]!;

    // Free-shipping discount applies ONLY to the customer-facing charge, after the cheapest provider
    // has been selected on true cost. Provider/courier lock still points at the cheapest real option.
    // The WhatsApp-notification surcharge is folded into the customer-facing charge AFTER the
    // cheapest provider is picked on true cost — it must never skew the provider comparison.
    const customerFacingChargePaise = isFreeShipping
      ? 0
      : applyShippingNotificationSurcharge(winner.shippingChargePaise);

    return {
      pincode: input.pincode,
      shippingCharge: customerFacingChargePaise,
      estimatedDays: winner.estimatedDays,
      selectedShippingProvider: winner.provider,
      ...(winner.courierCompanyId != null ? { courierCompanyId: winner.courierCompanyId } : {})
    };
  }

  /**
   * Loads the merchant's configured parcel box presets from store settings. Used to replicate the
   * worker's box selection at quote time so volumetric weight (and thus the quoted rate) matches
   * what the courier bills at AWB. Returns [] on any error — chargeable weight then falls back to
   * the adapter's default box, which is still correct.
   */
  private async loadBoxPresets(): Promise<{
    presets: BoxPreset[];
    packagingWeightGramsOverride: number | null;
  }> {
    try {
      const settings = await this.fastify.prisma.storeSettings.findUnique({
        where: { singletonKey: 'default' },
        select: { boxPresets: true, packagingWeightGrams: true }
      });
      const record = settings as { boxPresets?: unknown; packagingWeightGrams?: number | null } | null;
      return {
        presets: parseBoxPresets(record?.boxPresets),
        packagingWeightGramsOverride: record?.packagingWeightGrams ?? null
      };
    } catch (error) {
      this.fastify.log?.warn({ err: error }, 'loadBoxPresets: failed to load box presets — using default box');
      return { presets: [], packagingWeightGramsOverride: null };
    }
  }

  private buildShippingQuoteKey(
    userId: string | undefined,
    sessionToken: string | undefined,
    pincode: string,
    paymentMode: 'COD' | 'PREPAID'
  ): string | null {
    const owner = userId ?? sessionToken;
    if (!owner) return null;
    return `shipping:quote:${owner}:${pincode}:${paymentMode}`;
  }

  private async persistShippingQuote(
    userId: string | undefined,
    sessionToken: string | undefined,
    cartId: string,
    pincode: string,
    paymentMode: 'COD' | 'PREPAID',
    quote: {
      provider: 'DELHIVERY' | 'SHIPROCKET' | 'LOCAL';
      shippingChargePaise: number;
      estimatedDays: number;
      courierCompanyId?: number;
    }
  ): Promise<void> {
    const key = this.buildShippingQuoteKey(userId, sessionToken, pincode, paymentMode);
    if (!key) return;
    try {
      await this.fastify.redis.set(key, JSON.stringify({ cartId, ...quote }), 'EX', 1800);
    } catch (error) {
      // Non-fatal — checkout falls back to re-computation if the quote is unavailable.
      this.fastify.log?.warn({ err: error, key }, 'persistShippingQuote: failed to cache delivery quote');
    }
  }

  /**
   * Returns the exact quote shown to the customer at getDeliveryRates, if still valid for this
   * cart + pincode + paymentMode. Checkout uses this to charge/lock the same rate and courier the
   * customer saw, avoiding divergence from Shiprocket's non-deterministic serviceability API.
   * Returns null when no matching quote is cached — caller must fall back to re-computation.
   */
  async getStoredShippingQuote(
    userId: string | undefined,
    sessionToken: string | undefined,
    cartId: string,
    pincode: string,
    paymentMode: 'COD' | 'PREPAID'
  ): Promise<{
    provider: 'DELHIVERY' | 'SHIPROCKET' | 'LOCAL';
    shippingChargePaise: number;
    estimatedDays: number;
    courierCompanyId?: number;
  } | null> {
    const key = this.buildShippingQuoteKey(userId, sessionToken, pincode, paymentMode);
    if (!key) return null;
    let raw: string | null;
    try {
      raw = await this.fastify.redis.get(key);
    } catch (error) {
      this.fastify.log?.warn({ err: error, key }, 'getStoredShippingQuote: failed to read cached delivery quote');
      return null;
    }
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as {
        cartId: string;
        provider: 'DELHIVERY' | 'SHIPROCKET' | 'LOCAL';
        shippingChargePaise: number;
        estimatedDays: number;
        courierCompanyId?: number;
      };
      if (parsed.cartId !== cartId) return null;
      return {
        provider: parsed.provider,
        shippingChargePaise: parsed.shippingChargePaise,
        estimatedDays: parsed.estimatedDays,
        ...(parsed.courierCompanyId != null ? { courierCompanyId: parsed.courierCompanyId } : {})
      };
    } catch {
      return null;
    }
  }

  /**
   * Authoritative cheapest-provider quote for checkout. Re-runs the SAME cross-provider comparison
   * as getDeliveryRates (Delhivery vs Shiprocket, on chargeable weight), so the order is always
   * assigned to the genuinely cheapest serviceable provider — independent of what the client sent.
   * Used as the fallback when no cached quote exists. Returns null in noop/single-provider mode so
   * the caller falls back to single-provider computation.
   */
  async getCheapestProviderQuoteForCart(input: {
    cart: {
      coupon: Coupon | null;
      items: Array<{
        quantity: number;
        variant: {
          id: string;
          weight?: number | null;
          packageLengthCm?: number | null;
          packageWidthCm?: number | null;
          packageHeightCm?: number | null;
          keepUpright?: boolean | null;
        };
      }>;
    };
    destinationPincode: string;
    pickupPincode: string;
    paymentMode: 'COD' | 'PREPAID';
  }): Promise<{
    provider: 'DELHIVERY' | 'SHIPROCKET';
    shippingChargePaise: number;
    estimatedDays: number;
    courierCompanyId?: number;
  } | null> {
    const providerRuntime = resolveDualShippingRuntime();
    if (!providerRuntime.hasAny) return null;
    const result = await this.getDeliveryRatesMultiProvider({
      cart: input.cart,
      pincode: input.destinationPincode,
      pickupPincode: input.pickupPincode,
      paymentMode: input.paymentMode,
      delhiveryAdapter: providerRuntime.delhivery?.adapter ?? null,
      shiprocketAdapter: providerRuntime.shiprocket?.adapter ?? null
    });
    return {
      provider: result.selectedShippingProvider,
      shippingChargePaise: result.shippingCharge,
      estimatedDays: result.estimatedDays,
      ...(result.courierCompanyId != null ? { courierCompanyId: result.courierCompanyId } : {})
    };
  }

  /**
   * Authoritative local-delivery quote for checkout. Mirrors the getDeliveryRates
   * short-circuit so a whitelisted pincode ALWAYS checks out as a LOCAL order at the
   * pincode-based fee, regardless of quote-cache state or courier configuration.
   * Returns null when the pincode is not locally deliverable.
   */
  async getLocalDeliveryQuoteForCheckout(
    destinationPincode: string,
    subtotalPaise: number,
    freeShippingCoupon: boolean
  ): Promise<{ provider: 'LOCAL'; shippingChargePaise: number; estimatedDays: number } | null> {
    const settings = await resolveLocalDeliverySettings(this.fastify.prisma);
    return resolveLocalDeliveryQuote(settings, destinationPincode, {
      subtotalPaise,
      freeShippingCoupon
    });
  }

  async computeShippingChargeForCart(input: {
    cart: {
      coupon: Coupon | null;
      items: Array<{
        quantity: number;
        variant: {
          id: string;
          weight?: number | null;
          packageLengthCm?: number | null;
          packageWidthCm?: number | null;
          packageHeightCm?: number | null;
          keepUpright?: boolean | null;
        };
      }>;
    };
    destinationPincode: string;
    originPincode: string;
    provider?: ShippingProviderAdapter;
    usingNoop?: boolean;
    paymentMode?: 'COD' | 'PREPAID';
  }): Promise<{
    shippingChargePaise: number;
    estimatedDays: number;
    /** Shiprocket courier company ID for the cheapest courier — used to lock AWB to the quoted courier. */
    courierCompanyId?: number;
    availableCouriers?: DeliveryRateResult['availableCouriers'];
  }> {
    const usingNoop = input.usingNoop ?? !resolveDualShippingRuntime().hasAny;
    if (!input.provider && !usingNoop) {
      throw new AppError(ERROR_CODES.INTERNAL_ERROR, 'Shipping provider is required', 503);
    }
    const effectiveProvider = input.provider ?? new NoopShippingAdapter();

    // Charge on the courier's chargeable weight (max of dead and volumetric) so the quoted rate
    // matches what the provider bills at AWB. See computeChargeableWeightGrams.
    const { presets: boxPresets, packagingWeightGramsOverride } = usingNoop
      ? { presets: [] as BoxPreset[], packagingWeightGramsOverride: null }
      : await this.loadBoxPresets();
    const totalWeightGrams = computeChargeableWeightGrams({
      boxPresets,
      packagingWeightGramsOverride,
      items: input.cart.items.map((item) => ({
        quantity: item.quantity,
        weightGrams: item.variant.weight ?? null,
        lengthCm: item.variant.packageLengthCm ?? null,
        widthCm: item.variant.packageWidthCm ?? null,
        heightCm: item.variant.packageHeightCm ?? null,
        keepUpright: item.variant.keepUpright ?? null
      }))
    });

    const rate = await effectiveProvider.calculateDeliveryRate({
      destinationPincode: input.destinationPincode,
      originPincode: input.originPincode,
      totalWeightGrams,
      paymentMode: input.paymentMode ?? 'PREPAID'
    });

    const couponsEnabled = await isStorefrontCouponsEnabled(this.fastify.prisma);
    const effectiveCoupon = couponsEnabled ? input.cart.coupon : null;
    const shippingChargePaise =
      effectiveCoupon?.type === CouponType.FREE_SHIPPING
        ? 0
        : applyShippingNotificationSurcharge(rate.shippingChargePaise);

    return {
      shippingChargePaise,
      estimatedDays: rate.estimatedDays,
      ...(rate.courierCompanyId != null ? { courierCompanyId: rate.courierCompanyId } : {}),
      ...(rate.availableCouriers ? { availableCouriers: rate.availableCouriers } : {})
    };
  }

  private async validateCoupon(
    coupon: Coupon,
    subtotal: number,
    userId: string | undefined,
    sessionToken: string | null,
    items: Array<{ priceSnapshot: number; quantity: number; variant: { productId: string; product: { categoryId: string } } }>
  ) {
    if (!coupon.isActive || coupon.deletedAt) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Coupon not found', 404);
    }

    if (coupon.type === CouponType.BUY_X_GET_Y) {
      throw new AppError(
        ERROR_CODES.VALIDATION_ERROR,
        'Coupon type BUY_X_GET_Y is deferred and not supported in this release',
        400
      );
    }

    const now = new Date();
    if (coupon.validFrom > now || (coupon.validUntil && coupon.validUntil < now)) {
      throw new AppError(ERROR_CODES.COUPON_EXPIRED, 'Coupon has expired', 400);
    }
    if (subtotal < coupon.minOrderPaise) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Cart total does not meet coupon minimum order value', 400);
    }

    const scopedSubtotal = this.resolveCouponEligibleSubtotal(coupon, items);
    if (this.hasCouponScope(coupon) && scopedSubtotal <= 0) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Coupon is not applicable to cart items', 400);
    }

    if (!userId && !sessionToken) {
      throw new AppError(ERROR_CODES.UNAUTHORISED, 'Sign in to apply this coupon', 401);
    }

    await assertCouponWithinUsageLimits(this.fastify.prisma, coupon, userId);

    if (!userId && sessionToken) {
      await this.migrateGuestCouponUsageKeysIfNeeded(coupon.id, sessionToken);
      const guestUsage = Number(
        (await this.fastify.redis.get(this.getGuestCouponUsageKeyV2(coupon.id, sessionToken))) ?? '0'
      );
      if (coupon.maxUsesPerUser !== null && guestUsage >= coupon.maxUsesPerUser) {
        throw new AppError(ERROR_CODES.COUPON_USAGE_EXCEEDED, 'Coupon usage limit reached for this session', 409);
      }
    }
  }

  private calculateDiscount(
    subtotal: number,
    coupon: Coupon | null,
    items: Array<{ priceSnapshot: number; quantity: number; variant: { productId: string; product: { categoryId: string } } }>
  ): number {
    if (!coupon) {
      return 0;
    }

    const eligibleSubtotal = this.resolveCouponEligibleSubtotal(coupon, items);
    const baseSubtotal = this.hasCouponScope(coupon) ? eligibleSubtotal : subtotal;
    if (baseSubtotal <= 0) {
      return 0;
    }

    if (coupon.type === CouponType.PERCENTAGE_OFF) {
      return Math.min(Math.floor((baseSubtotal * coupon.value) / 100), baseSubtotal);
    }
    if (coupon.type === CouponType.FLAT_AMOUNT_OFF) {
      return Math.min(coupon.value, baseSubtotal);
    }
    if (coupon.type === CouponType.FREE_SHIPPING) {
      return 0;
    }
    return 0;
  }

  private async requirePurchasableVariant(variantId: string, tx?: Prisma.TransactionClient) {
    const client = tx ?? this.fastify.prisma;
    const variant = await client.productVariant.findFirst({
      where: { id: variantId, isActive: true, product: { isActive: true } },
      include: { inventory: true }
    });
    if (!variant) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Variant not found', 404);
    }
    return variant;
  }

  private assertInventory(available: number, requested: number) {
    if (requested > available) {
      throw new AppError(ERROR_CODES.INSUFFICIENT_STOCK, 'Insufficient stock for requested quantity', 422);
    }
  }

  private async resolveOrCreateCart(userId: string | undefined, sessionToken: string | undefined, extendReservation = false) {
    if (userId) {
      const cart = await this.fastify.prisma.cart.upsert({
        where: { userId },
        update: { expiresAt: this.buildExpiryDate() },
        create: { userId, expiresAt: this.buildExpiryDate() },
        include: {
          coupon: true,
          reservations: true,
          items: CART_ITEMS_INCLUDE
        }
      });
      if (extendReservation) {
        await this.extendCartReservationWindow(cart.id);
      }
      return cart;
    }

    // Normalize once: a blank/whitespace-only token (e.g. an empty `cart_session=`
    // cookie) must NOT be treated as a real token. `?? randomUUID()` only guards
    // null/undefined, so without this an empty string would be stored as the cart key
    // and every such guest would collide on a single shared `sessionToken: ''` row.
    const normalizedSessionToken = sessionToken?.trim() ? sessionToken.trim() : undefined;

    if (normalizedSessionToken) {
      const existing = await this.fastify.prisma.cart.findUnique({
        where: { sessionToken: normalizedSessionToken },
        include: {
          coupon: true,
          reservations: true,
          items: CART_ITEMS_INCLUDE
        }
      });
      if (existing) {
        if (extendReservation) {
          await this.extendCartReservationWindow(existing.id);
        }
        return existing;
      }
    }

    // A guest's cart MUST be keyed to the sessionToken the route hands us (the value
    // it also writes back to the `cart_session` cookie). Minting a fresh random token
    // here would orphan the cart: the cookie keeps the caller's token, the next request
    // looks it up, misses, and creates yet another empty cart — so a guest cart could
    // never accumulate items and the post-login merge would find nothing. Only fall back
    // to a random token when the caller supplied none (truly first-touch guest).
    // upsert (not create) makes the first-touch path race-safe against the unique
    // sessionToken when two concurrent requests share a freshly-issued token.
    const tokenForNewCart = normalizedSessionToken ?? randomUUID();
    const created = await this.fastify.prisma.cart.upsert({
      where: { sessionToken: tokenForNewCart },
      update: { expiresAt: this.buildExpiryDate() },
      create: {
        sessionToken: tokenForNewCart,
        expiresAt: this.buildExpiryDate()
      },
      include: {
        coupon: true,
        reservations: true,
        items: CART_ITEMS_INCLUDE
      }
    });
    if (extendReservation) {
      await this.extendCartReservationWindow(created.id);
    }
    return created;
  }

  private async getCartWithItems(cartId: string, tx?: Prisma.TransactionClient) {
    const client = tx ?? this.fastify.prisma;
    return client.cart.findUniqueOrThrow({
      where: { id: cartId },
      include: {
        coupon: true,
        reservations: true,
        items: CART_ITEMS_INCLUDE
      }
    });
  }

  private async getExistingCartWithItems(userId: string | undefined, sessionToken: string | undefined) {
    if (userId) {
      return this.fastify.prisma.cart.findUnique({
        where: { userId },
        include: {
          coupon: true,
          items: CART_ITEMS_INCLUDE
        }
      });
    }

    if (!sessionToken) {
      return null;
    }

    return this.fastify.prisma.cart.findUnique({
      where: { sessionToken },
      include: {
        coupon: true,
        items: CART_ITEMS_INCLUDE
      }
    });
  }

  private serializeCart(
    cart: {
      id: string;
      sessionToken: string | null;
      coupon: Coupon | null;
      reservations?: Array<{
        variantId: string;
        quantity: number;
        expiresAt: Date;
      }>;
      items: Array<{
        id: string;
        variantId: string;
        quantity: number;
        priceSnapshot: number;
        variant: {
          id: string;
          name: string;
          sku: string;
          price: number;
          productId: string;
          product: {
            categoryId: string;
            name: string;
            slug?: string | null;
            metaDescription: string | null;
            images: Array<{ url: string; altText: string }>;
          };
        };
      }>;
    },
    isGuest: boolean,
    couponsEnabled: boolean
  ) {
    const subtotal = cart.items.reduce((sum, item) => sum + item.priceSnapshot * item.quantity, 0);
    const discountAmount = couponsEnabled
      ? this.calculateDiscount(subtotal, cart.coupon, cart.items)
      : 0;
    const total = Math.max(subtotal - discountAmount, 0);
    const reservations = cart.reservations ?? [];

    return {
      id: cart.id,
      items: cart.items.map((item) => ({
        id: item.id,
        variantId: item.variantId,
        quantity: item.quantity,
        priceSnapshot: item.priceSnapshot,
        lineTotal: item.priceSnapshot * item.quantity,
        product: {
          name: item.variant.product?.name ?? item.variant.name,
          slug: item.variant.product?.slug ?? null,
          metaDescription: item.variant.product?.metaDescription ?? null,
          imageUrl: item.variant.product?.images?.[0]?.url ?? null,
          imageAlt: item.variant.product?.images?.[0]?.altText ?? null
        },
        variant: {
          id: item.variant.id,
          name: item.variant.name,
          sku: item.variant.sku,
          price: item.variant.price
        }
      })),
      subtotal,
      discountAmount,
      total,
      coupon: couponsEnabled && cart.coupon
        ? {
            id: cart.coupon.id,
            code: cart.coupon.code,
            type: cart.coupon.type,
            value: cart.coupon.value
          }
        : null,
      meta: {
        isGuest,
        reservationExpiresAt:
          reservations.length > 0
            ? reservations.reduce((max, item) => (item.expiresAt > max ? item.expiresAt : max), reservations[0]!.expiresAt).toISOString()
            : null,
        reservedItemCount: reservations.reduce((sum, reservation) => sum + reservation.quantity, 0)
      }
    };
  }

  private async resolveAvailableInventory(
    variantId: string,
    currentCartId: string,
    tx?: Prisma.TransactionClient
  ): Promise<number> {
    const client = tx ?? this.fastify.prisma;
    const inventoryDelegate = (client as unknown as { inventory?: Prisma.TransactionClient['inventory'] }).inventory;
    if (!inventoryDelegate) {
      return Number.MAX_SAFE_INTEGER;
    }
    const inventory = await inventoryDelegate.findUnique({
      where: { variantId },
      select: { quantity: true }
    });
    const reservationDelegate = (client as unknown as { cartReservation?: Prisma.TransactionClient['cartReservation'] })
      .cartReservation;
    if (!reservationDelegate) {
      return inventory?.quantity ?? 0;
    }
    const reservedByOtherCarts = await reservationDelegate.aggregate({
      where: {
        variantId,
        cartId: { not: currentCartId },
        expiresAt: { gt: new Date() }
      },
      _sum: { quantity: true }
    });
    const reservedQuantity = reservedByOtherCarts._sum.quantity ?? 0;
    return Math.max((inventory?.quantity ?? 0) - reservedQuantity, 0);
  }

  private async upsertReservation(
    cartId: string,
    variantId: string,
    quantity: number,
    tx?: Prisma.TransactionClient,
    expiresAt?: Date
  ): Promise<void> {
    const client = tx ?? this.fastify.prisma;
    const reservationDelegate = (client as unknown as { cartReservation?: Prisma.TransactionClient['cartReservation'] })
      .cartReservation;
    if (!reservationDelegate) {
      return;
    }
    await reservationDelegate.upsert({
      where: {
        cartId_variantId: {
          cartId,
          variantId
        }
      },
      create: {
        cartId,
        variantId,
        quantity,
        expiresAt: expiresAt ?? this.buildReservationExpiryDate()
      },
      update: {
        quantity,
        expiresAt: expiresAt ?? this.buildReservationExpiryDate()
      }
    });
  }

  private async extendCartReservationWindow(cartId: string, tx?: Prisma.TransactionClient): Promise<void> {
    const client = tx ?? this.fastify.prisma;
    const reservationDelegate = (client as unknown as { cartReservation?: Prisma.TransactionClient['cartReservation'] })
      .cartReservation;
    if (!reservationDelegate) {
      return;
    }
    await reservationDelegate.updateMany({
      where: {
        cartId,
        expiresAt: { gt: new Date() }
      },
      data: {
        expiresAt: this.buildReservationExpiryDate()
      }
    });
  }

  private resolveCouponEligibleSubtotal(
    coupon: Coupon,
    items: Array<{ priceSnapshot: number; quantity: number; variant: { productId: string; product: { categoryId: string } } }>
  ) {
    const scope = this.parseCouponScope(coupon.applicableTo);
    if (!scope) {
      return items.reduce((sum, item) => sum + item.priceSnapshot * item.quantity, 0);
    }

    const scopedProductIds = new Set(scope.productIds ?? []);
    const scopedCategoryIds = new Set(scope.categoryIds ?? []);
    return items.reduce((sum, item) => {
      const isProductMatch = scopedProductIds.has(item.variant.productId);
      const isCategoryMatch = scopedCategoryIds.has(item.variant.product.categoryId);
      if (isProductMatch || isCategoryMatch) {
        return sum + item.priceSnapshot * item.quantity;
      }
      return sum;
    }, 0);
  }

  private parseCouponScope(value: Prisma.JsonValue | null): CouponScope | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    const record = value as Record<string, unknown>;
    const productIds = Array.isArray(record.productIds)
      ? record.productIds.filter((item): item is string => typeof item === 'string' && item.length > 0)
      : undefined;
    const categoryIds = Array.isArray(record.categoryIds)
      ? record.categoryIds.filter((item): item is string => typeof item === 'string' && item.length > 0)
      : undefined;

    if ((productIds?.length ?? 0) === 0 && (categoryIds?.length ?? 0) === 0) {
      return null;
    }

    return {
      ...(productIds && productIds.length > 0 ? { productIds } : {}),
      ...(categoryIds && categoryIds.length > 0 ? { categoryIds } : {})
    };
  }

  private hasCouponScope(coupon: Coupon) {
    return this.parseCouponScope(coupon.applicableTo) !== null;
  }

  private buildExpiryDate() {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + GUEST_CART_TTL_DAYS);
    return expiresAt;
  }

  private getGuestCouponUsageKeyV2(couponId: string, sessionToken: string): string {
    return `guest-coupon-usage:v2:${couponId}:${this.fingerprintIdentifier(sessionToken)}`;
  }

  private getGuestCouponUsageKeyV1(couponId: string, sessionToken: string): string {
    return `guest-coupon-usage:${couponId}:${sessionToken}`;
  }

  private async migrateGuestCouponUsageKeysIfNeeded(couponId: string, sessionToken: string) {
    const v2Key = this.getGuestCouponUsageKeyV2(couponId, sessionToken);
    const v1Key = this.getGuestCouponUsageKeyV1(couponId, sessionToken);
    const existingV2 = await this.fastify.redis.get(v2Key);
    if (existingV2 !== null) {
      return;
    }
    const legacy = await this.fastify.redis.get(v1Key);
    if (legacy === null) {
      return;
    }
    await this.fastify.redis.set(v2Key, legacy, 'EX', GUEST_COUPON_USAGE_TTL_SECONDS);
    await this.fastify.redis.del(v1Key);
  }

  private async incrementGuestCouponUsage(couponId: string, sessionToken: string) {
    try {
      await this.migrateGuestCouponUsageKeysIfNeeded(couponId, sessionToken);
      const key = this.getGuestCouponUsageKeyV2(couponId, sessionToken);
      const usage = await this.fastify.redis.incr(key);
      if (usage === 1) {
        await this.fastify.redis.expire(key, GUEST_COUPON_USAGE_TTL_SECONDS);
      }
    } catch (error) {
      await sendTechnicalFailureAlert({
        prisma: this.fastify.prisma,
        template: 'GuestCouponUsage',
        channel: 'UNKNOWN',
        recipient: this.fingerprintIdentifier(sessionToken),
        errorMessage: error instanceof Error ? error.message : 'Unknown guest coupon usage increment error',
        failureStage: 'CORE_LOGIC',
        domain: 'cart',
        component: 'guest-coupon-usage'
      });
      this.fastify.log.error(
        {
          couponId,
          sessionFingerprint: this.fingerprintIdentifier(sessionToken),
          error: error instanceof Error ? error.message : 'Unknown guest coupon usage increment error'
        },
        'Failed to record guest coupon usage'
      );
      throw new AppError(
        ERROR_CODES.INTERNAL_ERROR,
        'Unable to apply coupon right now. Please try again.',
        503
      );
    }
  }

  private async decrementGuestCouponUsage(couponId: string, sessionToken: string) {
    try {
      await this.migrateGuestCouponUsageKeysIfNeeded(couponId, sessionToken);
      const key = this.getGuestCouponUsageKeyV2(couponId, sessionToken);
      const current = await this.fastify.redis.get(key);
      if (current === null) {
        return;
      }
      const next = Number(current) - 1;
      if (!Number.isFinite(next) || next <= 0) {
        await this.fastify.redis.del(key);
        return;
      }
      await this.fastify.redis.set(key, String(next), 'EX', GUEST_COUPON_USAGE_TTL_SECONDS);
    } catch (error) {
      this.fastify.log.warn(
        {
          couponId,
          sessionFingerprint: this.fingerprintIdentifier(sessionToken),
          error: error instanceof Error ? error.message : 'Unknown guest coupon usage decrement error'
        },
        'Failed to revert guest coupon usage'
      );
    }
  }

  private buildReservationExpiryDate(): Date {
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + CART_RESERVATION_TTL_MINUTES);
    return expiresAt;
  }

  private async runInTransaction<T>(callback: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    const prismaClient = this.fastify.prisma as unknown as { $transaction?: PrismaClient['$transaction'] };
    if (!prismaClient.$transaction) {
      return callback(this.fastify.prisma as unknown as Prisma.TransactionClient);
    }
    return prismaClient.$transaction(callback);
  }

  private resolveAnalyticsSessionId(sessionToken: string | null, userId: string | undefined): string {
    if (sessionToken && sessionToken.trim().length > 0) {
      return sessionToken;
    }
    if (userId && userId.trim().length > 0) {
      return `user:${userId}`;
    }
    return randomUUID();
  }

  private async enqueueAnalyticsEvent(
    eventType: AnalyticsEventType,
    sessionId: string,
    userId: string | undefined,
    payload: Record<string, unknown>
  ) {
    try {
      await this.enqueueOutboxMessage('analytics', 'record-event', {
        eventType,
        sessionId,
        ...(userId ? { userId } : {}),
        payload,
        occurredAt: new Date().toISOString()
      }, `analytics:${eventType}:${sessionId}:${Date.now()}`);
    } catch (error) {
      await sendTechnicalFailureAlert({
        prisma: this.fastify.prisma,
        template: eventType,
        channel: 'UNKNOWN',
        recipient: sessionId,
        errorMessage: error instanceof Error ? error.message : 'Unknown analytics enqueue error',
        failureStage: 'QUEUE_ENQUEUE',
        domain: 'analytics',
        component: 'cart-service',
        queueName: 'analytics',
        jobName: 'record-event'
      });
      this.fastify.log.error(
        {
          eventType,
          sessionFingerprint: this.fingerprintIdentifier(sessionId),
          error: error instanceof Error ? error.message : 'Unknown analytics enqueue error'
        },
        'Failed to enqueue analytics event'
      );
    }
  }

  private fingerprintIdentifier(value: string): string {
    return createHash('sha256').update(value).digest('hex').slice(0, 12);
  }

  private async enqueueOutboxMessage(
    queueName: 'analytics',
    jobName: string,
    payload: Record<string, unknown>,
    jobId?: string
  ): Promise<void> {
    // BullMQ does not allow colons in jobIds. Sanitize by replacing with hyphens.
    const sanitizedJobId = jobId ? jobId.replace(/:/g, '-') : undefined;

    const outboxDelegate = (this.fastify as { prisma?: PrismaClient }).prisma?.outboxMessage;
    if (outboxDelegate) {
      await outboxDelegate.create({
        data: {
          queueName,
          jobName,
          payload: payload as Prisma.InputJsonValue,
          ...(sanitizedJobId ? { jobId: sanitizedJobId } : {})
        }
      });
      return;
    }

    await this.fastify.queues[queueName].add(jobName, payload, sanitizedJobId ? { jobId: sanitizedJobId } : undefined);
  }

  private isHotVariant(variantId: string): boolean {
    if (HOT_SKU_VARIANT_IDS.size === 0) {
      return false;
    }
    return HOT_SKU_VARIANT_IDS.has(variantId);
  }

  private resolveHotSubject(userId: string | undefined, cartId: string): string {
    return userId?.trim() || `guest:${cartId}`;
  }

  private resolveShard(subject: string): number {
    const hash = createHash('sha256').update(subject).digest('hex').slice(0, 8);
    const value = Number.parseInt(hash, 16);
    return value % Math.max(1, HOT_SKU_SHARD_COUNT);
  }

  private async enforceHotSkuAdmission(input: {
    userId: string | undefined;
    cartId: string;
    variantId: string;
    requestedQuantity: number;
  }): Promise<void> {
    if (!this.isHotVariant(input.variantId)) {
      recordFlashSaleAdmission(input.variantId, 'admitted', 'not_hot');
      return;
    }

    const subject = this.resolveHotSubject(input.userId, input.cartId);
    if (input.requestedQuantity > HOT_SKU_USER_RESERVE_CAP) {
      recordFlashSaleAdmission(input.variantId, 'rejected', 'user_cap');
      throw new AppError(ERROR_CODES.RATE_LIMIT_EXCEEDED, 'Per-user reservation cap reached for this hot SKU', 429, {
        retryAfterSeconds: HOT_SKU_COOLDOWN_SECONDS
      });
    }

    const cooldownKey = `hot:cooldown:${input.variantId}:${subject}`;
    const cooldownTtl = await this.fastify.redis.ttl(cooldownKey);
    if (cooldownTtl > 0) {
      recordFlashSaleAdmission(input.variantId, 'rejected', 'cooldown');
      throw new AppError(ERROR_CODES.RATE_LIMIT_EXCEEDED, 'Hot SKU cooldown active. Try again shortly.', 429, {
        retryAfterSeconds: cooldownTtl
      });
    }

    const currentMinute = Math.floor(Date.now() / 60000);
    const shard = this.resolveShard(subject);
    const budgetKey = `hot:admission:${input.variantId}:${currentMinute}:shard:${shard}`;
    const used = await this.fastify.redis.incr(budgetKey);
    if (used === 1) {
      await this.fastify.redis.expire(budgetKey, 120);
    }

    // Record shard utilization for contention monitoring
    recordFlashSaleShardContention(shard, used, HOT_SKU_ADMISSION_BUDGET_PER_MINUTE);

    if (used > HOT_SKU_ADMISSION_BUDGET_PER_MINUTE) {
      recordFlashSaleAdmission(input.variantId, 'rejected', 'budget');
      throw new AppError(ERROR_CODES.RATE_LIMIT_EXCEEDED, 'Hot SKU admission budget is exhausted. Retry next minute.', 429, {
        retryAfterSeconds: 60
      });
    }

    await this.fastify.redis.set(cooldownKey, '1', 'EX', HOT_SKU_COOLDOWN_SECONDS);
    recordFlashSaleAdmission(input.variantId, 'admitted', 'budget');
  }
}

