"use client";

import { useEffect, useRef, useState } from "react";
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
import {
  LocalDeliveryBlockedNotice,
  LocalDeliverySplitNotice,
  type BlockedLocalDeliveryProduct,
} from "./LocalDeliveryNotices";
import type { DeliverySplit } from "@/types/cart";
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
  const [shippingQuote, setShippingQuote] = useState<{ shippingCharge: number; estimatedDays: number; selectedShippingProvider?: "DELHIVERY" | "SHIPROCKET" | "LOCAL"; courierCompanyId?: number } | null>(null);
  const [shippingQuoteLoading, setShippingQuoteLoading] = useState(false);
  const [shippingQuoteError, setShippingQuoteError] = useState<string | null>(null);
  // Product-level local delivery. `deliverySplit` is set when the cart will become two orders;
  // `blockedLocalDelivery` when local-only items cannot reach the pincode at all. Both notices
  // stay re-openable from the order summary while the customer is still in checkout.
  const [deliverySplit, setDeliverySplit] = useState<DeliverySplit | null>(null);
  const [splitNoticeOpen, setSplitNoticeOpen] = useState(false);
  const [blockedLocalDelivery, setBlockedLocalDelivery] = useState<{
    pincode: string;
    products: BlockedLocalDeliveryProduct[];
  } | null>(null);
  const [blockedNoticeOpen, setBlockedNoticeOpen] = useState(false);
  const [couponCode, setCouponCode] = useState("");
  const [couponLoading, setCouponLoading] = useState(false);
  const [couponError, setCouponError] = useState<string | null>(null);
  const { couponsEnabled, isCodEnabled, minOrderValuePaise, configAvailable } = useStoreConfig();
  // Bumped after the mount-time coupon reset so the cart re-syncs from the
  // server AFTER the removal — otherwise an in-flight initial getCart could
  // resolve later and restore the stale coupon it fetched pre-removal.
  const [couponResetDone, setCouponResetDone] = useState(false);
  useCartSync({ resyncKey: `${couponsEnabled}-${couponResetDone}` });
  const api = useAuthenticatedApi();
  const accessToken = useAuthStore((s) => s.accessToken);
  const storefrontSessionStatus = useAuthStore((s) => s.storefrontSessionStatus);
  const user = useAuthStore((s) => s.user);
  const cart = useCartStore((s) => s.cart);
  const setCart = useCartStore((s) => s.setCart);
  const clearCart = useCartStore((s) => s.clearCart);
  const clearPendingMerge = useCartStore((s) => s.clearPendingMerge);

  // Each checkout visit starts WITHOUT a coupon. The backend keeps couponId on
  // the cart until an order is created, so a coupon applied in an abandoned
  // checkout silently carried over to the next visit (and looked "stuck" even
  // across completed orders when the local store held a stale cart). Clear any
  // leftover coupon once on mount — removeCartCoupon is an idempotent no-op
  // when none is applied. A coupon the user applies DURING this visit is kept.
  const userAppliedCouponRef = useRef(false);
  useEffect(() => {
    let cancelled = false;
    void removeCartCoupon(accessToken)
      .then((next) => {
        // Don't clobber a coupon the user applied while this request was in flight.
        if (!cancelled && !userAppliedCouponRef.current) setCart(next);
      })
      .catch(() => {
        // Non-fatal — the cart sync above still renders the current server state.
      })
      .finally(() => {
        if (!cancelled) setCouponResetDone(true);
      });
    return () => {
      cancelled = true;
    };
    // Mount-only: rerunning on token changes mid-checkout would wipe an applied coupon.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
          // Cart splits across fulfilment channels: surface the explanation once per
          // pincode, then leave it re-openable from the summary.
          setDeliverySplit(rates.split ?? null);
          setBlockedLocalDelivery(null);
          if (rates.split) setSplitNoticeOpen(true);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setShippingQuote(null);
          setDeliverySplit(null);
          // Local-delivery-only items that cannot reach this pincode. The customer must remove
          // them; the backend refuses the order until they do.
          if (err instanceof ApiError && err.code === "LOCAL_DELIVERY_ONLY_UNAVAILABLE") {
            const details = err.details as
              | { pincode?: string; products?: BlockedLocalDeliveryProduct[] }
              | undefined;
            setBlockedLocalDelivery({
              pincode: details?.pincode ?? pincode,
              products: details?.products ?? [],
            });
            setBlockedNoticeOpen(true);
            setShippingQuoteError(
              "Some items in your cart can't be delivered to this pincode. Remove them to continue.",
            );
            return;
          }
          setBlockedLocalDelivery(null);
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
    userAppliedCouponRef.current = true;
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
      <div className="rounded-[20px] bg-card p-8 shadow-sm" aria-busy="true">
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
      <div className="rounded-[20px] bg-card p-8 shadow-sm text-center">
        <div className="mb-4 flex justify-center">
          <div className="flex size-16 items-center justify-center rounded-full bg-secondary">
            <ShoppingBag className="size-8 text-primary" aria-hidden />
          </div>
        </div>
        <p className="mb-6 text-sm font-medium text-muted-foreground">
          Please sign in to place an order.
        </p>
        <Link
          href="/login?redirect=/checkout"
          className="inline-flex h-12 items-center justify-center rounded-full bg-primary px-8 text-sm font-bold text-white transition-colors hover:bg-accent"
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
  // Local-delivery-only items that cannot reach the entered pincode hard-block checkout: the
  // customer has to remove them (the backend refuses the order either way).
  const checkoutBlocked = !configAvailable || belowMinOrder || blockedLocalDelivery !== null;
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
      if (err instanceof ApiError && err.code === "LOCAL_DELIVERY_ONLY_UNAVAILABLE") {
        // The pincode changed (or the whitelist did) between quoting and submitting. Re-raise
        // the blocking notice so the customer sees exactly what to remove.
        const details = err.details as
          | { pincode?: string; products?: BlockedLocalDeliveryProduct[] }
          | undefined;
        setBlockedLocalDelivery({
          pincode: details?.pincode ?? form.getValues("pincode"),
          products: details?.products ?? [],
        });
        setBlockedNoticeOpen(true);
        setError("Some items in your cart can't be delivered to this pincode.");
      } else if (err instanceof ApiError && err.code === "VALIDATION_ERROR") {
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

  const inputCls = "h-11 w-full rounded-xl border border-border bg-muted px-4 text-sm font-medium text-primary placeholder:text-muted-foreground transition-colors focus:border-primary focus:bg-card focus:outline-none focus:ring-2 focus:ring-primary/10 sm:h-12";
  const labelCls = "block text-xs font-bold uppercase tracking-wide text-muted-foreground";
  const fieldCls = "grid gap-1.5";

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">

      {/* ── Cart Item Cards ───────────────────────────────────────────── */}
      {cartItems.length > 0 && (
        <div className="overflow-hidden rounded-2xl bg-card shadow-sm ring-1 ring-black/[0.04]">
          <div className="flex items-center gap-2 border-b border-border bg-muted px-5 py-3.5">
            <ShoppingBag className="size-4 text-primary" aria-hidden />
            <span className="text-sm font-bold text-primary">
              Your items ({cartItems.length})
            </span>
          </div>

          <div className="divide-y divide-border">
            {cartItems.map((item) => (
              <div key={item.id} className="flex items-center gap-3 px-5 py-3.5">
                <div className="relative size-14 shrink-0 overflow-hidden rounded-xl bg-muted">
                  <Image
                    src={getCartLineImageUrl(item)}
                    alt={getCartLineImageAlt(item)}
                    fill
                    className="object-cover"
                    sizes="56px"
                  />
                  <span className="absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-white">
                    {item.quantity}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <CartLineProductDetails
                    item={item}
                    nameClassName="truncate text-xs font-bold text-primary sm:text-sm"
                    descriptionClassName="text-[10px] text-muted-foreground line-clamp-1"
                  />
                </div>
                <span className="shrink-0 text-sm font-extrabold text-accent">
                  {formatPrice(item.priceSnapshot * item.quantity)}
                </span>
              </div>
            ))}
          </div>

          <div className="border-t border-border bg-muted px-5 py-3 space-y-1.5">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Subtotal</span>
              <span className="font-semibold text-primary">{formatPrice(cartSubtotal)}</span>
            </div>
            {cartDiscount > 0 && (
              <div className="flex justify-between text-xs text-success">
                <span className="flex items-center gap-1"><Tag className="size-3" aria-hidden /> Discount</span>
                <span className="font-bold">−{formatPrice(cartDiscount)}</span>
              </div>
            )}
            {freeShippingCouponApplied && cartDiscount === 0 && (
              <div className="flex justify-between text-xs text-success">
                <span className="flex items-center gap-1"><Tag className="size-3" aria-hidden /> Coupon</span>
                <span className="font-bold">Free shipping</span>
              </div>
            )}
            <div className="flex justify-between border-t border-border pt-1.5 text-sm font-bold text-primary">
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
      <div className="overflow-hidden rounded-2xl bg-card shadow-sm ring-1 ring-black/[0.04]">
        <div className="border-b border-border bg-muted px-5 py-3.5">
          <h2 className="flex items-center gap-2 text-sm font-bold text-primary">
            <MapPin className="size-4 text-accent" aria-hidden />
            Shipping Details
          </h2>
        </div>

        <div className="grid gap-4 p-5">
          {/* Saved Addresses */}
          {savedAddresses.length > 0 && (
            <div className="grid gap-2">
              <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Saved addresses</p>
              <div className="flex flex-wrap gap-2">
                {savedAddresses.map((addr) => (
                  <button
                    key={addr.id}
                    type="button"
                    onClick={() => selectSavedAddress(addr)}
                    className={`rounded-xl border px-3 py-2 text-xs font-medium transition-all text-left ${
                      selectedAddressId === addr.id
                        ? "border-primary bg-primary text-white shadow-sm"
                        : "border-border bg-muted text-primary hover:border-primary"
                    }`}
                  >
                    {addr.fullName} — {addr.line1}, {addr.city}
                    {addr.isDefault ? " ✓" : ""}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Manage in{" "}
                <Link href="/settings" className="font-bold text-accent underline">
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
              Address line 2 <span className="font-normal normal-case text-muted-foreground">(optional)</span>
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
            <label className="flex cursor-pointer items-center gap-2.5 text-sm font-medium text-muted-foreground">
              <input type="checkbox" className="size-4 accent-accent" {...form.register("saveAddress")} />
              Save this address for future orders
            </label>
          )}
        </div>
      </div>

      {/* ── Payment Method ────────────────────────────────────────────── */}
      <div className="overflow-hidden rounded-2xl bg-card shadow-sm ring-1 ring-black/[0.04]">
        <div className="border-b border-border bg-muted px-5 py-3.5">
          <h2 className="flex items-center gap-2 text-sm font-bold text-primary">
            <span className="flex size-5 items-center justify-center rounded-full bg-accent text-[10px] font-extrabold text-white">2</span>
            Payment Method
          </h2>
        </div>

        <fieldset className="grid gap-3 p-5">
          <legend className="sr-only">Payment Method</legend>
          <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-border bg-muted px-4 py-3.5 text-sm font-bold text-primary transition-all has-[:checked]:border-primary has-[:checked]:bg-card has-[:checked]:shadow-sm">
            <input type="radio" value="PREPAID" className="size-4 accent-accent" {...form.register("paymentMode")} />
            <span>Pay Online</span>
            <span className="ml-auto rounded-full bg-secondary px-2 py-0.5 text-[10px] font-bold text-primary">UPI · Cards · Wallets</span>
          </label>
          {isCodEnabled ? (
            <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-border bg-muted px-4 py-3.5 text-sm font-bold text-primary transition-all has-[:checked]:border-primary has-[:checked]:bg-card has-[:checked]:shadow-sm">
              <input type="radio" value="COD" className="size-4 accent-accent" {...form.register("paymentMode")} />
              <span>Cash on Delivery</span>
              <span className="ml-auto rounded-full bg-secondary px-2 py-0.5 text-[10px] font-bold text-primary">Pay on arrival</span>
            </label>
          ) : (
            <p className="rounded-xl border border-border bg-muted px-4 py-3 text-xs font-medium text-muted-foreground">
              Cash on Delivery is currently disabled.
            </p>
          )}
        </fieldset>
      </div>

      {/* ── Coupon ────────────────────────────────────────────────────── */}
      {couponsEnabled ? (
        <div className="overflow-hidden rounded-2xl bg-card shadow-sm ring-1 ring-black/[0.04]">
          <div className="border-b border-border bg-muted px-5 py-3.5">
            <h2 className="flex items-center gap-2 text-sm font-bold text-primary">
              <Tag className="size-4 text-accent" aria-hidden />
              Promo Code
            </h2>
          </div>
          <div className="p-5">
            {hasAppliedCoupon ? (
              <div className="flex items-center justify-between rounded-xl bg-secondary px-4 py-3">
                <span className="text-sm font-bold text-success">{appliedCouponLabel ?? "Coupon applied"}</span>
                <button
                  type="button"
                  onClick={() => void handleRemoveCoupon()}
                  disabled={couponLoading}
                  className="text-xs font-bold text-accent hover:underline disabled:opacity-60"
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
                  className="flex-1 rounded-xl border border-border bg-muted px-4 py-2.5 text-sm font-bold uppercase placeholder:font-normal placeholder:normal-case placeholder:text-muted-foreground focus:border-primary focus:bg-card focus:outline-none disabled:opacity-60"
                />
                <button
                  type="button"
                  onClick={() => void handleApplyCoupon()}
                  disabled={couponLoading || !couponCode.trim()}
                  className="rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {couponLoading ? "…" : "Apply"}
                </button>
              </div>
            )}
            {couponError && <p className="mt-2 text-xs font-medium text-accent">{couponError}</p>}
          </div>
        </div>
      ) : null}

      {/* ── Order Notes ───────────────────────────────────────────────── */}
      <div className="overflow-hidden rounded-2xl bg-card shadow-sm ring-1 ring-black/[0.04]">
        <div className="border-b border-border bg-muted px-5 py-3.5">
          <label className="text-sm font-bold text-primary" htmlFor="notes">
            Order Notes <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
        </div>
        <div className="p-5">
          <textarea
            id="notes"
            className="min-h-[80px] w-full rounded-xl border border-border bg-muted px-4 py-3 text-sm font-medium text-primary placeholder:text-muted-foreground focus:border-primary focus:bg-card focus:outline-none focus:ring-2 focus:ring-primary/10"
            placeholder="Special delivery instructions, preferred delivery time, etc."
            {...form.register("notes")}
          />
        </div>
      </div>

      {/* ── Order Summary ─────────────────────────────────────────────── */}
      <div className="overflow-hidden rounded-2xl bg-card shadow-sm ring-1 ring-black/[0.04]">
        <div className="border-b border-border bg-muted px-5 py-3.5">
          <h2 className="flex items-center gap-2 text-sm font-bold text-primary">
            <Truck className="size-4 text-accent" aria-hidden />
            Order Total
          </h2>
        </div>
        <div className="grid gap-2.5 p-5 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Subtotal</span>
            <span className="font-semibold text-primary">{formatPrice(cartSubtotal)}</span>
          </div>
          {cartDiscount > 0 && (
            <div className="flex justify-between text-success">
              <span>Discount</span>
              <span className="font-bold">−{formatPrice(cartDiscount)}</span>
            </div>
          )}
          {freeShippingCouponApplied && cartDiscount === 0 && (
            <div className="flex justify-between text-success">
              <span>Coupon</span>
              <span className="font-bold">Free shipping</span>
            </div>
          )}
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Shipping</span>
            <span className={`font-semibold ${shippingQuoteLoading ? "animate-pulse text-muted-foreground" : "text-primary"}`}>
              {shippingQuoteLoading
                ? "Calculating…"
                : shippingQuoteError
                  ? "—"
                  : pincode?.length === 6
                    ? hasShippingQuote
                      ? shippingCharge === 0 ? "Free" : formatPrice(shippingCharge)
                      : "—"
                    : <span className="text-xs text-muted-foreground">Enter pincode</span>}
            </span>
          </div>
          {shippingQuoteError && (
            <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700">{shippingQuoteError}</p>
          )}
          {shippingQuote?.selectedShippingProvider === "LOCAL" && !deliverySplit && (
            <p className="rounded-xl bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700">
              Local delivery — this order is delivered directly by the store.
            </p>
          )}
          {/* Split notice: dismissible, but always re-openable while the customer is still
              in checkout (and again later from the order page). */}
          {deliverySplit && (
            <div className="rounded-xl border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-xs font-medium text-sky-800">
              <p>This cart will be placed as two separate orders. You still pay once.</p>
              <button
                type="button"
                onClick={() => setSplitNoticeOpen(true)}
                className="mt-1 font-bold underline underline-offset-2 hover:no-underline"
              >
                See what goes in each order
              </button>
            </div>
          )}
          {blockedLocalDelivery && (
            <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive">
              <p>
                Some items can&apos;t be delivered to {blockedLocalDelivery.pincode}. Remove them
                to continue.
              </p>
              <button
                type="button"
                onClick={() => setBlockedNoticeOpen(true)}
                className="mt-1 font-bold underline underline-offset-2 hover:no-underline"
              >
                See which items
              </button>
            </div>
          )}
          {shippingQuote && shippingQuote.estimatedDays > 0 && (
            <p className="text-xs text-muted-foreground">
              Estimated delivery: {shippingQuote.estimatedDays} day{shippingQuote.estimatedDays !== 1 ? "s" : ""}
            </p>
          )}
          <div className="flex items-center justify-between rounded-xl bg-muted px-4 py-3">
            <span className="font-heading font-bold text-primary">
              {hasShippingQuote ? "Estimated total" : "Cart total"}
            </span>
            <span className="font-heading text-xl font-extrabold text-accent">{formatPrice(estimatedPayableTotal)}</span>
          </div>
          {!hasShippingQuote && pincode?.length !== 6 && (
            <p className="text-xs text-muted-foreground">Enter a valid pincode to preview shipping cost.</p>
          )}
        </div>
      </div>

      {/* ── Place Order ───────────────────────────────────────────────── */}
      <button
        type="submit"
        className="h-14 w-full rounded-2xl bg-primary text-base font-extrabold text-white shadow-md transition-all hover:-translate-y-0.5 hover:bg-accent hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0"
        disabled={submitting || checkoutBlocked}
      >
        {submitting
          ? "Processing…"
          : !configAvailable
            ? "Store settings unavailable"
            : belowMinOrder
              ? "Minimum order not met"
              : blockedLocalDelivery
                ? "Remove undeliverable items to continue"
                : paymentMode === "COD"
                  ? "Place Order — Cash on Delivery"
                  : "Place Order — Pay Online"}
      </button>

      {deliverySplit && (
        <LocalDeliverySplitNotice
          open={splitNoticeOpen}
          onOpenChange={setSplitNoticeOpen}
          split={deliverySplit}
        />
      )}
      {blockedLocalDelivery && (
        <LocalDeliveryBlockedNotice
          open={blockedNoticeOpen}
          onOpenChange={setBlockedNoticeOpen}
          pincode={blockedLocalDelivery.pincode}
          products={blockedLocalDelivery.products}
          onGoToCart={() => router.push("/cart")}
        />
      )}

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
