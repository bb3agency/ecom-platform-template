"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";
import { CART_EMPTY_BLURB } from "@/lib/content";
import { useCartStore } from "@/stores/cart";
import { useAuthStore } from "@/stores/auth";
import { useCartSync } from "@/hooks/use-cart-sync";
import { formatPrice } from "@/lib/format-price";
import { ShoppingCart, Plus, Minus, X, Trash2, ArrowRight, AlertTriangle, Tag, ShoppingBag, Sparkles } from "lucide-react";
import { clearCart, removeCartItem, updateCartItem, applyCartCoupon, removeCartCoupon } from "@/lib/cart-api";
import { getApiErrorMessage, getApiErrorMessageWithHint } from "@/lib/error-messages";
import { CartLineProductDetails } from "@/components/cart/CartLineProductDetails";
import { getCartLineImageAlt, getCartLineImageUrl, getCartLineProductName } from "@/lib/cart-line-display";
import { useStoreConfig } from "@/components/providers/StoreConfigProvider";
import { formatAppliedCouponLabel } from "@/lib/coupon-display";

export function CartWorkspace() {
  const { couponsEnabled, minOrderValuePaise, configAvailable } = useStoreConfig();
  useCartSync({ resyncKey: couponsEnabled });
  const cart = useCartStore((s) => s.cart);
  const items = useCartStore((s) => s.items);
  const setCart = useCartStore((s) => s.setCart);
  const accessToken = useAuthStore((s) => s.accessToken);
  const [error, setError] = useState<string | null>(null);
  const [loadingItemId, setLoadingItemId] = useState<string | null>(null);
  const [couponCode, setCouponCode] = useState("");
  const [couponLoading, setCouponLoading] = useState(false);

  const summary = useMemo(() => {
    if (!cart) return { subtotal: 0, discountAmount: 0, total: 0 };
    const subtotal = cart.subtotal;
    const discountAmount = couponsEnabled ? cart.discountAmount : 0;
    return {
      subtotal,
      discountAmount,
      total: couponsEnabled ? cart.total : Math.max(subtotal - discountAmount, 0),
    };
  }, [cart, couponsEnabled]);

  const effectiveMinOrderPaise = cart?.minOrderValuePaise ?? minOrderValuePaise;
  const meetsMinimumOrder =
    cart?.meetsMinimumOrder ??
    (effectiveMinOrderPaise === 0 || summary.subtotal >= effectiveMinOrderPaise);

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-3xl bg-white px-4 py-28 text-center shadow-sm ring-1 ring-black/[0.04]">
        <div className="mb-6 flex size-24 items-center justify-center rounded-full bg-gradient-to-br from-[#eff5ee] to-[#dbe8d8]">
          <ShoppingCart className="size-12 text-[#ec6e55]" aria-hidden />
        </div>
        <h2 className="mb-2 font-heading text-2xl font-bold text-[#23403d]">
          Your cart is empty
        </h2>
        <p className="mb-8 max-w-sm text-sm font-medium text-[#767676]">
          {CART_EMPTY_BLURB}
        </p>
        <Link
          href="/products"
          className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-[#23403d] px-8 text-sm font-bold text-white transition-all hover:-translate-y-0.5 hover:bg-[#ec6e55] hover:shadow-lg"
        >
          <Sparkles className="size-4" aria-hidden />
          Browse Products
        </Link>
      </div>
    );
  }

  const handleQuantity = async (itemId: string, quantity: number) => {
    try {
      setError(null);
      setLoadingItemId(itemId);
      const next = await updateCartItem(itemId, { quantity }, accessToken);
      setCart(next);
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setLoadingItemId(null);
    }
  };

  const handleRemove = async (itemId: string) => {
    try {
      setError(null);
      setLoadingItemId(itemId);
      const next = await removeCartItem(itemId, accessToken);
      setCart(next);
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setLoadingItemId(null);
    }
  };

  const handleClear = async () => {
    try {
      setError(null);
      const next = await clearCart(accessToken);
      setCart(next);
    } catch (err) {
      setError(getApiErrorMessage(err));
    }
  };

  const handleApplyCoupon = async () => {
    if (!couponsEnabled) { setError("Coupons are not available right now."); return; }
    const trimmed = couponCode.trim();
    if (!trimmed) return;
    try {
      setError(null);
      setCouponLoading(true);
      const next = await applyCartCoupon(trimmed, accessToken);
      setCart(next);
      setCouponCode("");
    } catch (err) {
      setError(getApiErrorMessageWithHint(err));
    } finally {
      setCouponLoading(false);
    }
  };

  const handleRemoveCoupon = async () => {
    try {
      setError(null);
      setCouponLoading(true);
      const next = await removeCartCoupon(accessToken);
      setCart(next);
    } catch (err) {
      setError(getApiErrorMessageWithHint(err));
    } finally {
      setCouponLoading(false);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_380px] lg:items-start xl:gap-8">

      {/* ── Cart Items ──────────────────────────────────────────────────── */}
      <section className="flex flex-col gap-4">
        {/* Header row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShoppingBag className="size-5 text-[#23403d]" aria-hidden />
            <h2 className="font-heading text-lg font-bold text-[#23403d]">
              Cart ({items.length} item{items.length !== 1 ? "s" : ""})
            </h2>
          </div>
          <button
            type="button"
            className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold text-[#999] transition-colors hover:bg-red-50 hover:text-red-500"
            onClick={handleClear}
          >
            <Trash2 className="size-3.5" /> Clear all
          </button>
        </div>

        {/* Items list */}
        <div className="flex flex-col gap-3">
          {items.map((item) => {
            const productName = getCartLineProductName(item);
            const isLoading = loadingItemId === item.id;
            return (
              <article
                key={item.id}
                className={`flex items-center gap-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/[0.04] transition-opacity sm:gap-5 sm:p-5 ${isLoading ? "opacity-50 pointer-events-none" : ""}`}
              >
                {/* Image */}
                <Link
                  href={item.product?.slug ? `/products/${item.product.slug}` : "#"}
                  className="relative size-20 shrink-0 overflow-hidden rounded-xl bg-[#faf8f5] sm:size-24"
                >
                  <Image
                    src={getCartLineImageUrl(item)}
                    alt={getCartLineImageAlt(item)}
                    fill
                    className="object-cover transition-transform duration-300 hover:scale-105"
                    sizes="96px"
                  />
                </Link>

                {/* Info */}
                <div className="min-w-0 flex-1">
                  <CartLineProductDetails item={item} />
                  <p className="mt-0.5 text-sm font-bold text-[#ec6e55]">
                    {formatPrice(item.variant.price)} <span className="text-xs font-medium text-[#999]">each</span>
                  </p>

                  {/* Quantity stepper — visible on mobile */}
                  <div className="mt-3 flex items-center justify-between sm:hidden">
                    <div className="flex h-9 items-center rounded-full border border-[#efe8e4] bg-[#faf8f5]">
                      <button
                        type="button"
                        className="flex size-9 items-center justify-center rounded-full text-[#555] transition-all hover:bg-white hover:text-[#23403d] disabled:opacity-30"
                        onClick={() => handleQuantity(item.id, Math.max(1, item.quantity - 1))}
                        disabled={isLoading || item.quantity <= 1}
                        aria-label="Decrease quantity"
                      >
                        <Minus className="size-3" />
                      </button>
                      <span className="w-8 text-center text-sm font-bold text-[#23403d]">{item.quantity}</span>
                      <button
                        type="button"
                        className="flex size-9 items-center justify-center rounded-full text-[#555] transition-all hover:bg-white hover:text-[#23403d] disabled:opacity-30"
                        onClick={() => handleQuantity(item.id, item.quantity + 1)}
                        disabled={isLoading}
                        aria-label="Increase quantity"
                      >
                        <Plus className="size-3" />
                      </button>
                    </div>
                    <p className="font-bold text-[#23403d]">{formatPrice(item.lineTotal)}</p>
                  </div>
                </div>

                {/* Quantity stepper — desktop */}
                <div className="hidden sm:flex sm:items-center sm:gap-1">
                  <div className="flex h-10 items-center rounded-full border border-[#efe8e4] bg-[#faf8f5] px-1">
                    <button
                      type="button"
                      className="flex size-8 items-center justify-center rounded-full text-[#555] transition-all hover:bg-white hover:text-[#23403d] disabled:opacity-30"
                      onClick={() => handleQuantity(item.id, Math.max(1, item.quantity - 1))}
                      disabled={isLoading || item.quantity <= 1}
                      aria-label="Decrease quantity"
                    >
                      <Minus className="size-3" />
                    </button>
                    <span className="w-8 text-center text-sm font-bold text-[#23403d]">{item.quantity}</span>
                    <button
                      type="button"
                      className="flex size-8 items-center justify-center rounded-full text-[#555] transition-all hover:bg-white hover:text-[#23403d] disabled:opacity-30"
                      onClick={() => handleQuantity(item.id, item.quantity + 1)}
                      disabled={isLoading}
                      aria-label="Increase quantity"
                    >
                      <Plus className="size-3" />
                    </button>
                  </div>
                </div>

                {/* Line total + remove — desktop */}
                <div className="hidden flex-col items-end gap-2 sm:flex">
                  <p className="text-base font-extrabold text-[#23403d]">{formatPrice(item.lineTotal)}</p>
                  <button
                    type="button"
                    className="flex size-7 items-center justify-center rounded-full text-[#ccc] transition-colors hover:bg-red-50 hover:text-red-500 disabled:opacity-40"
                    onClick={() => handleRemove(item.id)}
                    disabled={isLoading}
                    aria-label={`Remove ${productName}`}
                  >
                    <X className="size-4" />
                  </button>
                </div>

                {/* Remove — mobile only */}
                <button
                  type="button"
                  className="flex size-8 shrink-0 items-center justify-center rounded-full text-[#ccc] transition-colors hover:bg-red-50 hover:text-red-500 disabled:opacity-40 sm:hidden"
                  onClick={() => handleRemove(item.id)}
                  disabled={isLoading}
                  aria-label={`Remove ${productName}`}
                >
                  <X className="size-4" />
                </button>
              </article>
            );
          })}
        </div>

        {error && (
          <div className="flex items-center gap-2 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
            <AlertTriangle className="size-4 shrink-0" aria-hidden />
            {error}
          </div>
        )}

        {/* Continue shopping */}
        <div className="pt-1">
          <Link
            href="/products"
            className="inline-flex h-10 items-center gap-2 rounded-full border border-[#e8ede7] bg-white px-5 text-xs font-bold text-[#23403d] transition-all hover:border-[#23403d] hover:shadow-sm"
          >
            ← Continue Shopping
          </Link>
        </div>
      </section>

      {/* ── Order Summary ────────────────────────────────────────────────── */}
      <aside className="flex flex-col gap-4 lg:sticky lg:top-24">
        <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-black/[0.04]">
          {/* Header */}
          <div className="border-b border-[#f0ece8] bg-gradient-to-r from-[#faf8f5] to-white px-5 py-4 sm:px-6">
            <h2 className="font-heading text-lg font-bold text-[#23403d]">Order Summary</h2>
          </div>

          <div className="flex flex-col gap-0 px-5 py-5 sm:px-6">
            {/* Coupon */}
            {couponsEnabled ? (
              <div className="mb-5 flex flex-col gap-2 rounded-xl border border-[#efe8e4] bg-[#faf8f5] p-3.5">
                <div className="flex items-center gap-2">
                  <Tag className="size-3.5 text-[#ec6e55]" aria-hidden />
                  <span className="text-xs font-bold uppercase tracking-wide text-[#767676]">Promo Code</span>
                </div>
                {cart?.coupon ? (
                  <div className="flex items-center justify-between rounded-lg bg-[#eff5ee] px-3 py-2">
                    <span className="text-xs font-bold text-[#00aa63]">
                      {formatAppliedCouponLabel(cart.coupon) ?? "Coupon applied"}
                    </span>
                    <button
                      type="button"
                      disabled={couponLoading}
                      onClick={handleRemoveCoupon}
                      className="text-xs font-bold text-[#ec6e55] hover:underline disabled:opacity-50"
                    >
                      Remove
                    </button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={couponCode}
                      onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                      placeholder="Enter code"
                      aria-label="Coupon code"
                      className="h-9 flex-1 rounded-lg border border-[#efe8e4] bg-white px-3 text-xs font-bold uppercase text-[#23403d] placeholder:font-normal placeholder:normal-case placeholder:text-[#bbb] focus:border-[#23403d] focus:outline-none"
                    />
                    <button
                      type="button"
                      disabled={couponLoading || couponCode.trim().length === 0}
                      onClick={handleApplyCoupon}
                      className="h-9 rounded-lg bg-[#23403d] px-4 text-xs font-bold text-white transition-colors hover:bg-[#ec6e55] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Apply
                    </button>
                  </div>
                )}
              </div>
            ) : null}

            {/* Line items */}
            <div className="flex flex-col gap-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-medium text-[#767676]">Subtotal</span>
                <span className="font-bold text-[#23403d]">{formatPrice(summary.subtotal)}</span>
              </div>

              {summary.discountAmount > 0 && (
                <div className="flex items-center justify-between">
                  <span className="font-medium text-[#00aa63]">Discount</span>
                  <span className="font-bold text-[#00aa63]">−{formatPrice(summary.discountAmount)}</span>
                </div>
              )}

              <div className="flex items-center justify-between">
                <span className="font-medium text-[#767676]">Shipping</span>
                <span className="text-xs font-semibold text-[#999]">Calculated at checkout</span>
              </div>

              {effectiveMinOrderPaise > 0 && (
                <div className="flex items-center justify-between border-t border-dashed border-[#f0ece8] pt-3">
                  <span className="text-xs font-medium text-[#999]">Min. order</span>
                  <span className="text-xs font-bold text-[#23403d]">{formatPrice(effectiveMinOrderPaise)}</span>
                </div>
              )}

              {/* Total */}
              <div className="flex items-center justify-between rounded-xl bg-[#faf8f5] px-4 py-3">
                <span className="font-heading text-base font-bold text-[#23403d]">Total</span>
                <span className="font-heading text-2xl font-extrabold text-[#ec6e55]">{formatPrice(summary.total)}</span>
              </div>
            </div>

            {/* CTA */}
            <div className="mt-5">
              {!configAvailable ? (
                <div className="flex flex-col gap-3">
                  <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" aria-hidden />
                    <p className="text-xs font-medium text-amber-800">Store settings unavailable. Refresh the page.</p>
                  </div>
                  <button disabled className="flex h-13 w-full cursor-not-allowed items-center justify-center gap-2 rounded-full bg-[#23403d]/30 text-sm font-bold text-white">
                    Proceed to checkout <ArrowRight className="size-4" aria-hidden />
                  </button>
                </div>
              ) : !meetsMinimumOrder && effectiveMinOrderPaise > 0 ? (
                <div className="flex flex-col gap-3">
                  <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" aria-hidden />
                    <p className="text-xs font-medium text-amber-800">
                      Add {formatPrice(effectiveMinOrderPaise - summary.subtotal)} more to reach the {formatPrice(effectiveMinOrderPaise)} minimum.
                    </p>
                  </div>
                  <button disabled aria-disabled="true" className="flex h-13 w-full cursor-not-allowed items-center justify-center gap-2 rounded-full bg-[#23403d]/30 text-sm font-bold text-white">
                    Proceed to checkout <ArrowRight className="size-4" aria-hidden />
                  </button>
                </div>
              ) : (
                <Link
                  href={accessToken ? "/checkout" : "/login?redirect=/checkout"}
                  className="flex h-13 w-full items-center justify-center gap-2 rounded-full bg-[#23403d] text-sm font-bold text-white shadow-md transition-all hover:-translate-y-0.5 hover:bg-[#ec6e55] hover:shadow-lg"
                >
                  Proceed to checkout <ArrowRight className="size-4" />
                </Link>
              )}
            </div>

            <p className="mt-4 text-center text-[11px] font-medium text-[#bbb]">
              🔒 Secure &amp; encrypted checkout
            </p>
          </div>
        </div>

        {/* Trust badges */}
        <div className="grid grid-cols-3 gap-2">
          {[
            { emoji: "🌿", label: "Chemical Free" },
            { emoji: "🚚", label: "Fast Delivery" },
            { emoji: "↩️", label: "Easy Returns" },
          ].map(({ emoji, label }) => (
            <div key={label} className="flex flex-col items-center gap-1 rounded-xl bg-white px-2 py-3 text-center ring-1 ring-black/[0.04]">
              <span className="text-lg" aria-hidden>{emoji}</span>
              <span className="text-[10px] font-semibold text-[#767676]">{label}</span>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}
