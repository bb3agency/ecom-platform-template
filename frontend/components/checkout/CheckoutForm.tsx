"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import Link from "next/link";
import { useSafeRouter } from "@/lib/use-safe-router";
import { MapPin, AlertTriangle, ShoppingBag, Truck, Tag } from "lucide-react";
import { checkPincodeServiceability, getDeliveryRates, applyCartCoupon, removeCartCoupon } from "@/lib/cart-api";
import { getApiErrorMessage, getApiErrorMessageWithHint } from "@/lib/error-messages";
import { ApiError } from "@/lib/api";
import { createIdempotencyKey } from "@/lib/idempotency";
import { useAuthStore } from "@/stores/auth";
import { useCartStore } from "@/stores/cart";
import { createMyAddress, getMyAddresses, type UserAddress } from "@/lib/users-api";
import { createOrder, prepareCheckout, confirmPrepaid } from "@/lib/orders-api";
import { formatPrice } from "@/lib/format-price";
import { CartLineProductDetails } from "@/components/cart/CartLineProductDetails";
import { useCartSync } from "@/hooks/use-cart-sync";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import { getCartLineImageAlt, getCartLineImageUrl } from "@/lib/cart-line-display";
import { useStoreConfig } from "@/components/providers/StoreConfigProvider";
import { formatAppliedCouponLabel, isFreeShippingCoupon } from "@/lib/coupon-display";

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => {
      open: () => void;
      on: (event: string, handler: (response: Record<string, unknown>) => void) => void;
    };
  }
}

const schema = z.object({
  fullName: z.string().min(2).max(100),
  phone: z.string().min(10).max(15),
  line1: z.string().min(5).max(200),
  line2: z.string().max(200).optional(),
  city: z.string().min(2),
  state: z.string().min(2),
  pincode: z.string().length(6),
  paymentMode: z.enum(["PREPAID", "COD"]),
  notes: z.string().max(2000).optional(),
  saveAddress: z.boolean().optional(),
});

type CheckoutValues = z.infer<typeof schema>;

type AddressFieldName = Extract<
  keyof CheckoutValues,
  "fullName" | "phone" | "line1" | "line2" | "city" | "state" | "pincode"
>;


function addressToFormValues(addr: UserAddress): Partial<CheckoutValues> {
  return {
    fullName: addr.fullName,
    phone: addr.phone,
    line1: addr.line1,
    line2: addr.line2 ?? "",
    city: addr.city,
    state: addr.state,
    pincode: addr.pincode,
  };
}

export function CheckoutForm() {
  const router = useSafeRouter();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [savedAddresses, setSavedAddresses] = useState<UserAddress[]>([]);
  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(null);
  const [shippingQuote, setShippingQuote] = useState<{ shippingCharge: number; estimatedDays: number; selectedShippingProvider?: "DELHIVERY" | "SHIPROCKET"; courierCompanyId?: number } | null>(null);
  const [shippingQuoteLoading, setShippingQuoteLoading] = useState(false);
  const [shippingQuoteError, setShippingQuoteError] = useState<string | null>(null);
  const [couponCode, setCouponCode] = useState("");
  const [couponLoading, setCouponLoading] = useState(false);
  const [couponError, setCouponError] = useState<string | null>(null);
  const { couponsEnabled, isCodEnabled, minOrderValuePaise, configAvailable } = useStoreConfig();
  useCartSync({ resyncKey: couponsEnabled });
  const api = useAuthenticatedApi();
  const accessToken = useAuthStore((s) => s.accessToken);
  const storefrontSessionStatus = useAuthStore((s) => s.storefrontSessionStatus);
  const user = useAuthStore((s) => s.user);
  const cart = useCartStore((s) => s.cart);
  const setCart = useCartStore((s) => s.setCart);
  const clearCart = useCartStore((s) => s.clearCart);
  const clearPendingMerge = useCartStore((s) => s.clearPendingMerge);

  const form = useForm<CheckoutValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      paymentMode: "PREPAID",
      fullName: user?.firstName ? `${user.firstName} ${user.lastName ?? ""}`.trim() : "",
      phone: "",
      line1: "",
      line2: "",
      city: "",
      state: "",
      pincode: "",
      saveAddress: false,
    },
  });

  // Load and auto-fill default saved address on mount (authenticated customers only)
  useEffect(() => {
    if (!accessToken || storefrontSessionStatus === "checking") return;

    let cancelled = false;

    void getMyAddresses(accessToken)
      .then((addrs) => {
        if (cancelled) return;

        setSavedAddresses(addrs);

        // Auto-select default address (or first if no default)
        const defaultAddr = addrs.find((a) => a.isDefault) ?? addrs[0];
        if (defaultAddr) {
          setSelectedAddressId(defaultAddr.id);

          // Auto-fill form fields with default address
          const patch = addressToFormValues(defaultAddr);
          Object.entries(patch).forEach(([key, value]) => {
            if (value !== undefined) {
              form.setValue(key as keyof CheckoutValues, value as string, {
                shouldValidate: false,
                shouldDirty: false,
              });
            }
          });
        }
      })
      .catch(() => {
        // Non-fatal: user can enter address manually
        if (!cancelled) {
          setSavedAddresses([]);
        }
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once per token+status change
  }, [accessToken, storefrontSessionStatus]);

  const pincode = useWatch({ control: form.control, name: "pincode" });
  const paymentMode = useWatch({ control: form.control, name: "paymentMode" });

  useEffect(() => {
    if (!accessToken || !pincode || pincode.length !== 6) {
      setShippingQuote(null);
      setShippingQuoteError(null);
      return;
    }
    let cancelled = false;
    setShippingQuoteLoading(true);
    setShippingQuoteError(null);
    void getDeliveryRates(pincode, accessToken, paymentMode)
      .then((rates) => {
        if (!cancelled) {
          setShippingQuote({
            shippingCharge: rates.shippingCharge,
            estimatedDays: rates.estimatedDays,
            selectedShippingProvider: rates.selectedShippingProvider,
            courierCompanyId: rates.courierCompanyId,
          });
          setShippingQuoteError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setShippingQuote(null);
          const isProviderError =
            err instanceof ApiError &&
            (err.code === "CONFIG_NOT_READY" || err.code === "INTERNAL_ERROR");
          setShippingQuoteError(
            isProviderError
              ? "Delivery estimate is temporarily unavailable. COD is still available, or contact us for assistance."
              : getApiErrorMessageWithHint(err),
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setShippingQuoteLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [accessToken, pincode, paymentMode, cart?.coupon?.id]);

  const clearSavedAddressOnManualEdit = () => {
    if (selectedAddressId) setSelectedAddressId(null);
  };

  const registerAddressField = (name: AddressFieldName) => {
    const { onChange, ...rest } = form.register(name);
    return {
      ...rest,
      onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
        void onChange(event);
        clearSavedAddressOnManualEdit();
      },
    };
  };

  const handleApplyCoupon = async () => {
    if (!couponsEnabled) {
      setCouponError("Coupons are not available right now.");
      return;
    }
    if (!couponCode.trim()) {
      setCouponError("Please enter a coupon code.");
      return;
    }
    setCouponLoading(true);
    setCouponError(null);
    try {
      const next = await applyCartCoupon(couponCode, accessToken);
      setCart(next);
      setCouponCode("");
    } catch (err) {
      setCouponError(getApiErrorMessageWithHint(err));
    } finally {
      setCouponLoading(false);
    }
  };

  const handleRemoveCoupon = async () => {
    setCouponLoading(true);
    setCouponError(null);
    try {
      const next = await removeCartCoupon(accessToken);
      setCart(next);
    } catch (err) {
      setCouponError(getApiErrorMessage(err));
    } finally {
      setCouponLoading(false);
    }
  };

  if (storefrontSessionStatus === "checking") {
    return (
      <div className="rounded-[20px] bg-white p-8 shadow-sm" aria-busy="true">
        <div className="animate-pulse space-y-4">
          <div className="h-6 w-1/3 rounded bg-gray-200" />
          <div className="h-12 rounded bg-gray-100" />
          <div className="h-12 rounded bg-gray-100" />
          <div className="h-12 w-2/3 rounded bg-gray-100" />
        </div>
      </div>
    );
  }

  if (!accessToken) {
    return (
      <div className="rounded-[20px] bg-white p-8 shadow-sm text-center">
        <div className="mb-4 flex justify-center">
          <div className="flex size-16 items-center justify-center rounded-full bg-[#eff5ee]">
            <ShoppingBag className="size-8 text-[#23403d]" aria-hidden />
          </div>
        </div>
        <p className="mb-6 text-sm font-medium text-[#767676]">
          Please sign in to place an order.
        </p>
        <Link
          href="/login?redirect=/checkout"
          className="inline-flex h-12 items-center justify-center rounded-full bg-[#23403d] px-8 text-sm font-bold text-white transition-colors hover:bg-[#ec6e55]"
        >
          Sign in to continue
        </Link>
      </div>
    );
  }

  const selectSavedAddress = (addr: UserAddress) => {
    setSelectedAddressId(addr.id);
    form.reset({ ...form.getValues(), ...addressToFormValues(addr), saveAddress: false });
  };

  const cartItems = cart?.items ?? [];
  const cartSubtotal = cart?.subtotal ?? cartItems.reduce((s, i) => s + i.priceSnapshot * i.quantity, 0);
  const cartDiscount = couponsEnabled ? (cart?.discountAmount ?? 0) : 0;
  const hasAppliedCoupon = couponsEnabled && Boolean(cart?.coupon);
  const appliedCouponLabel = formatAppliedCouponLabel(couponsEnabled ? cart?.coupon : null);
  const freeShippingCouponApplied = couponsEnabled && isFreeShippingCoupon(cart?.coupon);
  const cartPayableTotal = cart?.total ?? cartSubtotal;
  const effectiveMinOrderPaise = cart?.minOrderValuePaise ?? minOrderValuePaise;
  const meetsMinimumOrder =
    cart?.meetsMinimumOrder ??
    (effectiveMinOrderPaise === 0 || cartSubtotal >= effectiveMinOrderPaise);
  const belowMinOrder = configAvailable && !meetsMinimumOrder && effectiveMinOrderPaise > 0;
  const checkoutBlocked = !configAvailable || belowMinOrder;
  const shippingCharge = shippingQuote?.shippingCharge ?? 0;
  const hasShippingQuote = shippingQuote !== null && !shippingQuoteError;
  const estimatedPayableTotal = hasShippingQuote
    ? Math.max(cartPayableTotal + shippingCharge, 0)
    : cartPayableTotal;

  const submit = form.handleSubmit(async (values) => {
    setError(null);
    setSubmitting(true);
    try {
      if (!isCodEnabled && values.paymentMode === "COD") {
        setError("COD is currently unavailable. Please choose prepaid.");
        setSubmitting(false);
        return;
      }
      if (!meetsMinimumOrder && effectiveMinOrderPaise > 0) {
        setError(
          `Your cart subtotal doesn't meet the minimum of ${formatPrice(effectiveMinOrderPaise)}. Please add more items to your cart.`,
        );
        setSubmitting(false);
        return;
      }
      const pincodeResult = await checkPincodeServiceability(values.pincode);
      if (!pincodeResult.serviceable) {
        setError("Delivery is not available at this pincode.");
        setSubmitting(false);
        return;
      }

      let addressId = selectedAddressId;

      if (!addressId && values.saveAddress) {
        const created = await createMyAddress(accessToken, {
          fullName: values.fullName,
          phone: values.phone,
          line1: values.line1,
          ...(values.line2?.trim() ? { line2: values.line2.trim() } : {}),
          city: values.city,
          state: values.state,
          pincode: values.pincode,
          isDefault: savedAddresses.length === 0,
        });
        addressId = created.id;
        setSavedAddresses((prev) => [...prev, created]);
      }

      // COD: create order directly (order confirmed immediately)
      if (values.paymentMode === "COD") {
        const orderIdempotencyKey = createIdempotencyKey();
        const order = await createOrder(
          addressId
            ? {
                addressId,
                paymentMode: "COD",
                notes: values.notes,
                selectedShippingProvider: shippingQuote?.selectedShippingProvider,
                shippingChargePaise: shippingQuote?.shippingCharge,
                courierCompanyId: shippingQuote?.courierCompanyId,
              }
            : {
                paymentMode: "COD",
                shippingAddress: {
                  fullName: values.fullName,
                  phone: values.phone,
                  line1: values.line1,
                  ...(values.line2?.trim() ? { line2: values.line2.trim() } : {}),
                  city: values.city,
                  state: values.state,
                  pincode: values.pincode,
                },
                notes: values.notes,
                selectedShippingProvider: shippingQuote?.selectedShippingProvider,
                shippingChargePaise: shippingQuote?.shippingCharge,
                courierCompanyId: shippingQuote?.courierCompanyId,
              },
          accessToken,
          orderIdempotencyKey,
        );
        clearPendingMerge();
        clearCart();
        router.push(`/checkout/success?orderId=${order.id}`);
        return;
      }

      // PREPAID: prepare checkout session (no DB order yet)
      const razorpayKey = process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID;
      if (!razorpayKey) {
        setError("Payment gateway is not configured. Contact support.");
        setSubmitting(false);
        return;
      }
      if (!window.Razorpay) {
        setError("Payment SDK unavailable. Refresh and try again.");
        setSubmitting(false);
        return;
      }

      const prepareKey = createIdempotencyKey();
      const checkout = await prepareCheckout(
        addressId
          ? {
              addressId,
              notes: values.notes,
              selectedShippingProvider: shippingQuote?.selectedShippingProvider,
              shippingChargePaise: shippingQuote?.shippingCharge,
              courierCompanyId: shippingQuote?.courierCompanyId,
            }
          : {
              shippingAddress: {
                fullName: values.fullName,
                phone: values.phone,
                line1: values.line1,
                ...(values.line2?.trim() ? { line2: values.line2.trim() } : {}),
                city: values.city,
                state: values.state,
                pincode: values.pincode,
              },
              notes: values.notes,
              selectedShippingProvider: shippingQuote?.selectedShippingProvider,
              shippingChargePaise: shippingQuote?.shippingCharge,
              courierCompanyId: shippingQuote?.courierCompanyId,
            },
        accessToken,
        prepareKey,
      );

      const confirmKey = createIdempotencyKey();
      const razorpay = new window.Razorpay({
        key: razorpayKey,
        amount: checkout.amount,
        currency: checkout.currency,
        order_id: checkout.razorpayOrderId,
        name: process.env.NEXT_PUBLIC_STORE_NAME ?? "Store",
        description: "Complete your order",
        prefill: {
          name: values.fullName,
          contact: values.phone,
          ...(user?.email ? { email: user.email } : {}),
        },
        handler: async (response: {
          razorpay_payment_id: string;
          razorpay_order_id: string;
          razorpay_signature: string;
        }) => {
          try {
            const confirmedOrder = await confirmPrepaid(
              {
                checkoutSessionId: checkout.checkoutSessionId,
                razorpayOrderId: response.razorpay_order_id,
                razorpayPaymentId: response.razorpay_payment_id,
                razorpaySignature: response.razorpay_signature,
              },
              accessToken,
              confirmKey,
            );
            clearPendingMerge();
            clearCart();
            router.push(`/checkout/success?orderId=${confirmedOrder.id}`);
          } catch (confirmError) {
            setError(getApiErrorMessage(confirmError));
            setSubmitting(false);
          }
        },
        modal: {
          ondismiss: () => {
            setSubmitting(false);
          },
        },
      });

      razorpay.on("payment.failed", (response: Record<string, unknown>) => {
        const err = response.error as Record<string, unknown> | undefined;
        const isCancelled =
          (err?.reason as string | undefined) === "cancelled" ||
          (err?.source as string) === "customer";
        setSubmitting(false);
        setError(
          isCancelled
            ? "Payment was cancelled. Please try again when ready."
            : `Payment failed: ${(err?.description as string | undefined) ?? "Please try again or use a different payment method."}`,
        );
      });

      razorpay.open();
    } catch (err) {
      if (err instanceof ApiError && err.code === "VALIDATION_ERROR") {
        setError(getApiErrorMessageWithHint(err));
      } else if (
        err instanceof ApiError &&
        (err.code === "CONFIG_NOT_READY" || err.code === "INTERNAL_ERROR")
      ) {
        setError(
          "Our payment or delivery service is temporarily unavailable. Please try COD, or contact us to complete your order.",
        );
      } else {
        setError(getApiErrorMessage(err));
      }
      setSubmitting(false);
    }
  });

  const inputCls = "h-11 w-full rounded-xl border border-[#e8e4e0] bg-[#faf8f5] px-4 text-sm font-medium text-[#23403d] placeholder:text-[#bbb] transition-colors focus:border-[#23403d] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#23403d]/10 sm:h-12";
  const labelCls = "block text-xs font-bold uppercase tracking-wide text-[#555]";
  const fieldCls = "grid gap-1.5";

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">

      {/* ── Cart Item Cards ───────────────────────────────────────────── */}
      {cartItems.length > 0 && (
        <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-black/[0.04]">
          <div className="flex items-center gap-2 border-b border-[#f0ece8] bg-[#faf8f5] px-5 py-3.5">
            <ShoppingBag className="size-4 text-[#23403d]" aria-hidden />
            <span className="text-sm font-bold text-[#23403d]">
              Your items ({cartItems.length})
            </span>
          </div>

          <div className="divide-y divide-[#f0ece8]">
            {cartItems.map((item) => (
              <div key={item.id} className="flex items-center gap-3 px-5 py-3.5">
                <div className="relative size-14 shrink-0 overflow-hidden rounded-xl bg-[#faf8f5]">
                  <Image
                    src={getCartLineImageUrl(item)}
                    alt={getCartLineImageAlt(item)}
                    fill
                    className="object-cover"
                    sizes="56px"
                  />
                  <span className="absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full bg-[#23403d] text-[10px] font-bold text-white">
                    {item.quantity}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <CartLineProductDetails
                    item={item}
                    nameClassName="truncate text-xs font-bold text-[#23403d] sm:text-sm"
                    descriptionClassName="text-[10px] text-[#999] line-clamp-1"
                  />
                </div>
                <span className="shrink-0 text-sm font-extrabold text-[#ec6e55]">
                  {formatPrice(item.priceSnapshot * item.quantity)}
                </span>
              </div>
            ))}
          </div>

          <div className="border-t border-[#f0ece8] bg-[#faf8f5] px-5 py-3 space-y-1.5">
            <div className="flex justify-between text-xs text-[#999]">
              <span>Subtotal</span>
              <span className="font-semibold text-[#23403d]">{formatPrice(cartSubtotal)}</span>
            </div>
            {cartDiscount > 0 && (
              <div className="flex justify-between text-xs text-[#00aa63]">
                <span className="flex items-center gap-1"><Tag className="size-3" aria-hidden /> Discount</span>
                <span className="font-bold">−{formatPrice(cartDiscount)}</span>
              </div>
            )}
            {freeShippingCouponApplied && cartDiscount === 0 && (
              <div className="flex justify-between text-xs text-[#00aa63]">
                <span className="flex items-center gap-1"><Tag className="size-3" aria-hidden /> Coupon</span>
                <span className="font-bold">Free shipping</span>
              </div>
            )}
            <div className="flex justify-between border-t border-[#e8e4e0] pt-1.5 text-sm font-bold text-[#23403d]">
              <span>Total</span>
              <span>{formatPrice(cartPayableTotal)}</span>
            </div>
          </div>
        </div>
      )}

      {/* ── Alerts ───────────────────────────────────────────────────── */}
      {!configAvailable ? (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" aria-hidden />
          Store settings are temporarily unavailable. Please refresh the page before placing an order.
        </div>
      ) : null}
      {belowMinOrder ? (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" aria-hidden />
          <p className="text-xs font-medium text-amber-800">
            Add {formatPrice(effectiveMinOrderPaise - cartSubtotal)} more to reach the{" "}
            {formatPrice(effectiveMinOrderPaise)} minimum order value.
          </p>
        </div>
      ) : null}

      {/* ── Shipping Details ─────────────────────────────────────────── */}
      <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-black/[0.04]">
        <div className="border-b border-[#f0ece8] bg-[#faf8f5] px-5 py-3.5">
          <h2 className="flex items-center gap-2 text-sm font-bold text-[#23403d]">
            <MapPin className="size-4 text-[#ec6e55]" aria-hidden />
            Shipping Details
          </h2>
        </div>

        <div className="grid gap-4 p-5">
          {/* Saved Addresses */}
          {savedAddresses.length > 0 && (
            <div className="grid gap-2">
              <p className="text-xs font-bold uppercase tracking-wide text-[#999]">Saved addresses</p>
              <div className="flex flex-wrap gap-2">
                {savedAddresses.map((addr) => (
                  <button
                    key={addr.id}
                    type="button"
                    onClick={() => selectSavedAddress(addr)}
                    className={`rounded-xl border px-3 py-2 text-xs font-medium transition-all text-left ${
                      selectedAddressId === addr.id
                        ? "border-[#23403d] bg-[#23403d] text-white shadow-sm"
                        : "border-[#e8e4e0] bg-[#faf8f5] text-[#23403d] hover:border-[#23403d]"
                    }`}
                  >
                    {addr.fullName} — {addr.line1}, {addr.city}
                    {addr.isDefault ? " ✓" : ""}
                  </button>
                ))}
              </div>
              <p className="text-xs text-[#bbb]">
                Manage in{" "}
                <Link href="/settings" className="font-bold text-[#ec6e55] underline">
                  account settings
                </Link>
                .
              </p>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className={fieldCls}>
              <label className={labelCls} htmlFor="fullName">Full Name</label>
              <input id="fullName" className={inputCls} placeholder="John Doe" {...registerAddressField("fullName")} />
              {form.formState.errors.fullName && (
                <p className="text-xs text-red-500">{form.formState.errors.fullName.message}</p>
              )}
            </div>
            <div className={fieldCls}>
              <label className={labelCls} htmlFor="phone">Phone</label>
              <input id="phone" className={inputCls} placeholder="9876543210" {...registerAddressField("phone")} />
              {form.formState.errors.phone && (
                <p className="text-xs text-red-500">{form.formState.errors.phone.message}</p>
              )}
            </div>
          </div>

          <div className={fieldCls}>
            <label className={labelCls} htmlFor="line1">Address line 1</label>
            <input id="line1" className={inputCls} placeholder="House/Flat No., Street, Locality" {...registerAddressField("line1")} />
            {form.formState.errors.line1 && (
              <p className="text-xs text-red-500">{form.formState.errors.line1.message}</p>
            )}
          </div>

          <div className={fieldCls}>
            <label className={labelCls} htmlFor="line2">
              Address line 2 <span className="font-normal normal-case text-[#bbb]">(optional)</span>
            </label>
            <input id="line2" className={inputCls} placeholder="Landmark, apartment, etc." {...registerAddressField("line2")} />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
            <div className={fieldCls}>
              <label className={labelCls} htmlFor="city">City</label>
              <input id="city" className={inputCls} {...registerAddressField("city")} />
            </div>
            <div className={fieldCls}>
              <label className={labelCls} htmlFor="state">State</label>
              <input id="state" className={inputCls} {...registerAddressField("state")} />
            </div>
            <div className={fieldCls}>
              <label className={labelCls} htmlFor="pincode">Pincode</label>
              <input id="pincode" className={inputCls} maxLength={6} {...registerAddressField("pincode")} />
            </div>
          </div>

          {!selectedAddressId && (
            <label className="flex cursor-pointer items-center gap-2.5 text-sm font-medium text-[#555]">
              <input type="checkbox" className="size-4 accent-[#ec6e55]" {...form.register("saveAddress")} />
              Save this address for future orders
            </label>
          )}
        </div>
      </div>

      {/* ── Payment Method ────────────────────────────────────────────── */}
      <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-black/[0.04]">
        <div className="border-b border-[#f0ece8] bg-[#faf8f5] px-5 py-3.5">
          <h2 className="flex items-center gap-2 text-sm font-bold text-[#23403d]">
            <span className="flex size-5 items-center justify-center rounded-full bg-[#ec6e55] text-[10px] font-extrabold text-white">2</span>
            Payment Method
          </h2>
        </div>

        <fieldset className="grid gap-3 p-5">
          <legend className="sr-only">Payment Method</legend>
          <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-[#e8e4e0] bg-[#faf8f5] px-4 py-3.5 text-sm font-bold text-[#23403d] transition-all has-[:checked]:border-[#23403d] has-[:checked]:bg-white has-[:checked]:shadow-sm">
            <input type="radio" value="PREPAID" className="size-4 accent-[#ec6e55]" {...form.register("paymentMode")} />
            <span>Pay Online</span>
            <span className="ml-auto rounded-full bg-[#eff5ee] px-2 py-0.5 text-[10px] font-bold text-[#23403d]">UPI · Cards · Wallets</span>
          </label>
          {isCodEnabled ? (
            <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-[#e8e4e0] bg-[#faf8f5] px-4 py-3.5 text-sm font-bold text-[#23403d] transition-all has-[:checked]:border-[#23403d] has-[:checked]:bg-white has-[:checked]:shadow-sm">
              <input type="radio" value="COD" className="size-4 accent-[#ec6e55]" {...form.register("paymentMode")} />
              <span>Cash on Delivery</span>
              <span className="ml-auto rounded-full bg-[#eff5ee] px-2 py-0.5 text-[10px] font-bold text-[#23403d]">Pay on arrival</span>
            </label>
          ) : (
            <p className="rounded-xl border border-[#e8e4e0] bg-[#faf8f5] px-4 py-3 text-xs font-medium text-[#bbb]">
              Cash on Delivery is currently disabled.
            </p>
          )}
        </fieldset>
      </div>

      {/* ── Coupon ────────────────────────────────────────────────────── */}
      {couponsEnabled ? (
        <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-black/[0.04]">
          <div className="border-b border-[#f0ece8] bg-[#faf8f5] px-5 py-3.5">
            <h2 className="flex items-center gap-2 text-sm font-bold text-[#23403d]">
              <Tag className="size-4 text-[#ec6e55]" aria-hidden />
              Promo Code
            </h2>
          </div>
          <div className="p-5">
            {hasAppliedCoupon ? (
              <div className="flex items-center justify-between rounded-xl bg-[#eff5ee] px-4 py-3">
                <span className="text-sm font-bold text-[#00aa63]">{appliedCouponLabel ?? "Coupon applied"}</span>
                <button
                  type="button"
                  onClick={() => void handleRemoveCoupon()}
                  disabled={couponLoading}
                  className="text-xs font-bold text-[#ec6e55] hover:underline disabled:opacity-60"
                >
                  Remove
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Enter coupon code"
                  value={couponCode}
                  onChange={(e) => { setCouponCode(e.target.value.toUpperCase()); setCouponError(null); }}
                  disabled={couponLoading}
                  className="flex-1 rounded-xl border border-[#e8e4e0] bg-[#faf8f5] px-4 py-2.5 text-sm font-bold uppercase placeholder:font-normal placeholder:normal-case placeholder:text-[#bbb] focus:border-[#23403d] focus:bg-white focus:outline-none disabled:opacity-60"
                />
                <button
                  type="button"
                  onClick={() => void handleApplyCoupon()}
                  disabled={couponLoading || !couponCode.trim()}
                  className="rounded-xl bg-[#23403d] px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-[#ec6e55] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {couponLoading ? "…" : "Apply"}
                </button>
              </div>
            )}
            {couponError && <p className="mt-2 text-xs font-medium text-[#ec6e55]">{couponError}</p>}
          </div>
        </div>
      ) : null}

      {/* ── Order Notes ───────────────────────────────────────────────── */}
      <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-black/[0.04]">
        <div className="border-b border-[#f0ece8] bg-[#faf8f5] px-5 py-3.5">
          <label className="text-sm font-bold text-[#23403d]" htmlFor="notes">
            Order Notes <span className="font-normal text-[#bbb]">(optional)</span>
          </label>
        </div>
        <div className="p-5">
          <textarea
            id="notes"
            className="min-h-[80px] w-full rounded-xl border border-[#e8e4e0] bg-[#faf8f5] px-4 py-3 text-sm font-medium text-[#23403d] placeholder:text-[#bbb] focus:border-[#23403d] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#23403d]/10"
            placeholder="Special delivery instructions, preferred delivery time, etc."
            {...form.register("notes")}
          />
        </div>
      </div>

      {/* ── Order Summary ─────────────────────────────────────────────── */}
      <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-black/[0.04]">
        <div className="border-b border-[#f0ece8] bg-[#faf8f5] px-5 py-3.5">
          <h2 className="flex items-center gap-2 text-sm font-bold text-[#23403d]">
            <Truck className="size-4 text-[#ec6e55]" aria-hidden />
            Order Total
          </h2>
        </div>
        <div className="grid gap-2.5 p-5 text-sm">
          <div className="flex justify-between">
            <span className="text-[#767676]">Subtotal</span>
            <span className="font-semibold text-[#23403d]">{formatPrice(cartSubtotal)}</span>
          </div>
          {cartDiscount > 0 && (
            <div className="flex justify-between text-[#00aa63]">
              <span>Discount</span>
              <span className="font-bold">−{formatPrice(cartDiscount)}</span>
            </div>
          )}
          {freeShippingCouponApplied && cartDiscount === 0 && (
            <div className="flex justify-between text-[#00aa63]">
              <span>Coupon</span>
              <span className="font-bold">Free shipping</span>
            </div>
          )}
          <div className="flex items-center justify-between">
            <span className="text-[#767676]">Shipping</span>
            <span className={`font-semibold ${shippingQuoteLoading ? "animate-pulse text-[#bbb]" : "text-[#23403d]"}`}>
              {shippingQuoteLoading
                ? "Calculating…"
                : shippingQuoteError
                  ? "—"
                  : pincode?.length === 6
                    ? hasShippingQuote
                      ? shippingCharge === 0 ? "Free" : formatPrice(shippingCharge)
                      : "—"
                    : <span className="text-xs text-[#bbb]">Enter pincode</span>}
            </span>
          </div>
          {shippingQuoteError && (
            <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700">{shippingQuoteError}</p>
          )}
          {shippingQuote && shippingQuote.estimatedDays > 0 && (
            <p className="text-xs text-[#999]">
              Estimated delivery: {shippingQuote.estimatedDays} day{shippingQuote.estimatedDays !== 1 ? "s" : ""}
            </p>
          )}
          <div className="flex items-center justify-between rounded-xl bg-[#faf8f5] px-4 py-3">
            <span className="font-heading font-bold text-[#23403d]">
              {hasShippingQuote ? "Estimated total" : "Cart total"}
            </span>
            <span className="font-heading text-xl font-extrabold text-[#ec6e55]">{formatPrice(estimatedPayableTotal)}</span>
          </div>
          {!hasShippingQuote && pincode?.length !== 6 && (
            <p className="text-xs text-[#bbb]">Enter a valid pincode to preview shipping cost.</p>
          )}
        </div>
      </div>

      {/* ── Place Order ───────────────────────────────────────────────── */}
      <button
        type="submit"
        className="h-14 w-full rounded-2xl bg-[#23403d] text-base font-extrabold text-white shadow-md transition-all hover:-translate-y-0.5 hover:bg-[#ec6e55] hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0"
        disabled={submitting || checkoutBlocked}
      >
        {submitting
          ? "Processing…"
          : !configAvailable
            ? "Store settings unavailable"
            : belowMinOrder
              ? "Minimum order not met"
              : paymentMode === "COD"
                ? "Place Order — Cash on Delivery"
                : "Place Order — Pay Online"}
      </button>

      {error ? (
        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            {error}
            {error.includes("order history") && (
              <Link href="/orders" className="ml-2 font-bold underline">Go to orders</Link>
            )}
          </span>
        </div>
      ) : null}
    </form>
  );
}
