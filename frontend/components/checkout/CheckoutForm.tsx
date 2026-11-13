"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import Link from "next/link";
import { useSafeRouter } from "@/lib/use-safe-router";
import { MapPin, AlertTriangle, ShoppingBag, Truck, Tag } from "lucide-react";
import {
  checkPincodeServiceability,
  getCart,
  getDeliveryRates,
  applyCartCoupon,
  removeCartCoupon,
} from "@/lib/cart-api";
import { getApiErrorMessage, getApiErrorMessageWithHint } from "@/lib/error-messages";
import { ApiError } from "@/lib/api";
import {
  LocalDeliveryBlockedNotice,
  type BlockedLocalDeliveryProduct,
} from "./LocalDeliveryNotices";
import {
  buildCheckoutFingerprint,
  confirmWithRetry,
  findMatchingSavedAddress,
  getCheckoutSubmitState,
  isOutcomeUnknownError,
  isPriceChangedError,
  refreshAfterPriceChange,
  resolveSubmitAttemptKeys,
  settleSubmitAttemptKeys,
  type SubmitAttemptKeys,
} from "@/lib/checkout-submit";
import { buildCheckoutOutcomeUrl } from "@/lib/checkout-outcome";
import { createIdempotencyKey } from "@/lib/idempotency";
import { useAuthStore } from "@/stores/auth";
import { useCartStore } from "@/stores/cart";
import { createMyAddress, getMyAddresses, type UserAddress } from "@/lib/users-api";
import {
  createOrder,
  prepareCheckout,
  confirmPrepaid,
  type ConfirmPrepaidInput,
  type CreateOrderInput,
  type PrepareCheckoutInput,
} from "@/lib/orders-api";
import { formatPrice } from "@/lib/format-price";
import { CartLineProductDetails } from "@/components/cart/CartLineProductDetails";
import { useCartSync } from "@/hooks/use-cart-sync";
import { getCartLineImageAlt, getCartLineImageUrl } from "@/lib/cart-line-display";
import { useStoreConfig } from "@/components/providers/StoreConfigProvider";
import { formatAppliedCouponLabel, isFreeShippingCoupon } from "@/lib/coupon-display";
import type { DeliveryTaxBreakup } from "@/types/cart";

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => {
      open: () => void;
      on: (event: string, handler: (response: Record<string, unknown>) => void) => void;
    };
  }
}

const schema = z.object({
  fullName: z
    .string()
    .trim()
    .min(2, "Enter the recipient's full name.")
    .max(100, "Name must be 100 characters or fewer."),
  phone: z
    .string()
    .trim()
    .min(10, "Enter a phone number with at least 10 digits.")
    .max(15, "Phone number must be 15 digits or fewer."),
  line1: z
    .string()
    .trim()
    .min(5, "Enter your house/flat number and street.")
    .max(200, "Address line 1 must be 200 characters or fewer."),
  line2: z.string().max(200, "Address line 2 must be 200 characters or fewer.").optional(),
  city: z.string().trim().min(2, "Enter your city."),
  state: z.string().trim().min(2, "Enter your state."),
  pincode: z.string().trim().regex(/^\d{6}$/, "Enter a 6-digit pincode."),
  paymentMode: z.enum(["PREPAID", "COD"]),
  notes: z.string().max(2000).optional(),
  saveAddress: z.boolean().optional(),
});

type CheckoutValues = z.infer<typeof schema>;

type AddressFieldName = Extract<
  keyof CheckoutValues,
  "fullName" | "phone" | "line1" | "line2" | "city" | "state" | "pincode"
>;

interface ShippingQuote {
  shippingCharge: number;
  estimatedDays: number;
  selectedShippingProvider?: "DELHIVERY" | "SHIPROCKET" | "LOCAL";
  courierCompanyId?: number;
  taxBreakup?: DeliveryTaxBreakup;
  /** The pincode + payment mode this quote was computed for. */
  pincode: string;
  paymentMode: CheckoutValues["paymentMode"];
}

/** A Razorpay payment that was captured but whose order is not confirmed yet. */
interface PendingPrepaidConfirmation {
  input: ConfirmPrepaidInput;
  confirmKey: string;
}

/** Error copy plus whether to offer the orders page (outcome may be unknown). */
interface CheckoutError {
  message: string;
  showOrdersLink: boolean;
}


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
  const [checkoutError, setCheckoutError] = useState<CheckoutError | null>(null);
  const setError = (message: string | null, showOrdersLink = false) =>
    setCheckoutError(message ? { message, showOrdersLink } : null);
  // Captured-but-unconfirmed payment: while set, no new order can be started
  // (a fresh prepare-checkout would charge the customer a second time).
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingPrepaidConfirmation | null>(null);
  const [confirmingPayment, setConfirmingPayment] = useState(false);
  // Idempotency keys survive an identical retry after a timeout/5xx (see resolveSubmitAttemptKeys).
  const submitKeysRef = useRef<SubmitAttemptKeys | null>(null);
  const [quoteRetryNonce, setQuoteRetryNonce] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [savedAddresses, setSavedAddresses] = useState<UserAddress[]>([]);
  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(null);
  const [shippingQuote, setShippingQuote] = useState<ShippingQuote | null>(null);
  const [shippingQuoteLoading, setShippingQuoteLoading] = useState(false);
  const [shippingQuoteError, setShippingQuoteError] = useState<string | null>(null);
  // Local-delivery-only items that cannot reach the entered pincode. Set when the backend
  // refuses the quote; blocks checkout until the customer removes them.
  const [blockedLocalDelivery, setBlockedLocalDelivery] = useState<{
    pincode: string;
    products: BlockedLocalDeliveryProduct[];
  } | null>(null);
  const [blockedNoticeOpen, setBlockedNoticeOpen] = useState(false);
  // Which pincode we have already auto-opened the blocking notice for, so switching payment
  // mode (or re-applying a coupon) does not re-open a modal the customer just dismissed.
  const announcedPincodeRef = useRef<string | null>(null);
  const [couponCode, setCouponCode] = useState("");
  const [couponLoading, setCouponLoading] = useState(false);
  const [couponError, setCouponError] = useState<string | null>(null);
  const { couponsEnabled, isCodEnabled, minOrderValuePaise, configAvailable } = useStoreConfig();
  // Bumped after the mount-time coupon reset so the cart re-syncs from the
  // server AFTER the removal — otherwise an in-flight initial getCart could
  // resolve later and restore the stale coupon it fetched pre-removal.
  const [couponResetDone, setCouponResetDone] = useState(false);
  useCartSync({ resyncKey: `${couponsEnabled}-${couponResetDone}` });
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
    // Validate when a field is left, then live while correcting it.
    mode: "onTouched",
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
      // Clear the blocking verdict too. Without this, editing a blocked pincode down to
      // 5 digits would leave checkoutBlocked stuck true (and a stale notice on screen) with no
      // way back.
      setBlockedLocalDelivery(null);
      setBlockedNoticeOpen(false);
      announcedPincodeRef.current = null;
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
            taxBreakup: rates.taxBreakup,
            pincode,
            paymentMode,
          });
          setShippingQuoteError(null);
          setBlockedLocalDelivery(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setShippingQuote(null);
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
            if (announcedPincodeRef.current !== pincode) {
              announcedPincodeRef.current = pincode;
              setBlockedNoticeOpen(true);
            }
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
              ? "Delivery estimate is temporarily unavailable. Try again, or choose Pay Online — you'll see the final amount before paying."
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
  }, [accessToken, pincode, paymentMode, cart?.coupon?.id, quoteRetryNonce]);

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
          <div className="h-6 w-1/3 rounded bg-muted" />
          <div className="h-12 rounded bg-muted" />
          <div className="h-12 rounded bg-muted" />
          <div className="h-12 w-2/3 rounded bg-muted" />
        </div>
      </div>
    );
  }

  // A captured-but-unconfirmed payment keeps the form (and its retry action)
  // on screen even if the session drops meanwhile.
  if (!accessToken && !pendingConfirmation) {
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
  const pincodeComplete = pincode?.length === 6;
  // A quote only counts for the pincode + payment mode it was computed for —
  // otherwise a tap right after switching to COD would use the prepaid quote.
  const hasShippingQuote =
    shippingQuote !== null &&
    !shippingQuoteError &&
    shippingQuote.pincode === pincode &&
    shippingQuote.paymentMode === paymentMode;
  const activeQuote = hasShippingQuote ? shippingQuote : null;
  const shippingCharge = activeQuote?.shippingCharge ?? 0;
  const taxBreakup = activeQuote?.taxBreakup ?? null;
  const estimatedPayableTotal = activeQuote
    ? Math.max(cartPayableTotal + shippingCharge, 0)
    : cartPayableTotal;
  const submitState = getCheckoutSubmitState({
    submitting,
    configAvailable,
    belowMinOrder,
    blockedLocalDelivery: blockedLocalDelivery !== null,
    pendingConfirmation: pendingConfirmation !== null,
    pincodeComplete,
    shippingQuoteLoading,
    hasShippingQuote,
    paymentMode,
  });
  const submitDisabled = submitState.disabled || checkoutBlocked;

  /**
   * The payment is settled either way: the backend has emptied the cart, so the
   * local cart is cleared too. A CANCELLED order (coupon or stock ran out after
   * payment; full refund queued) goes to the "not completed" outcome instead of
   * "Order placed", and is never tracked as a purchase.
   */
  const finishPrepaidOrder = (order: { id: string; status?: string | null }) => {
    submitKeysRef.current = null;
    setPendingConfirmation(null);
    clearPendingMerge();
    clearCart();
    router.push(buildCheckoutOutcomeUrl(order));
  };

  /**
   * Confirm a captured payment. Always the same payload + idempotency key, read
   * with the CURRENT token (the one captured at submit may have expired while
   * the customer was in the Razorpay modal; 401 refresh happens in the client).
   */
  const runPrepaidConfirmation = async (pending: PendingPrepaidConfirmation) => {
    setConfirmingPayment(true);
    setError(null);
    try {
      const confirmedOrder = await confirmWithRetry(() => {
        const token = useAuthStore.getState().accessToken ?? accessToken;
        if (!token) {
          throw new ApiError("UNAUTHORISED", "Session expired", 401);
        }
        return confirmPrepaid(pending.input, token, pending.confirmKey);
      });
      finishPrepaidOrder(confirmedOrder);
    } catch (confirmError) {
      // Keep the captured payment pending: the customer retries confirmation,
      // never a new checkout (that would charge them twice).
      setPendingConfirmation(pending);
      setError(
        `Your payment went through, but we couldn't confirm your order yet (${getApiErrorMessage(confirmError)}). Please retry confirmation and don't pay again.`,
        true,
      );
    } finally {
      setConfirmingPayment(false);
      setSubmitting(false);
    }
  };

  const reportSubmitError = (err: unknown) => {
    if (isPriceChangedError(err)) {
      // The backend already re-priced the cart: reload it and the delivery quote so
      // the new total shows, and keep the message up until the customer resubmits.
      setError(getApiErrorMessage(err));
      void refreshAfterPriceChange({
        loadCart: () => getCart(useAuthStore.getState().accessToken ?? accessToken),
        setCart,
        requote: () => setQuoteRetryNonce((n) => n + 1),
      });
    } else if (err instanceof ApiError && err.code === "LOCAL_DELIVERY_ONLY_UNAVAILABLE") {
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
    } else if (isOutcomeUnknownError(err)) {
      // The backend may have committed the order even though we got no answer.
      // Retrying the identical submit replays the same idempotency key (safe).
      setError(
        "We couldn't confirm whether your order went through. Check your orders before trying again. Retrying here will not place a duplicate.",
        true,
      );
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
  };

  const submit = form.handleSubmit(async (values) => {
    if (pendingConfirmation) {
      // A captured payment is awaiting confirmation — never start a second checkout.
      void runPrepaidConfirmation(pendingConfirmation);
      return;
    }
    const token = useAuthStore.getState().accessToken ?? accessToken;
    if (!token) {
      setError("Your session has ended. Please sign in again to place your order.");
      return;
    }
    setError(null);
    setSubmitting(true);
    let attemptKeys: SubmitAttemptKeys | null = null;
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
      if (values.paymentMode === "COD" && !activeQuote) {
        // COD commits to a total immediately — never before the delivery charge is shown.
        setError("We need to show your delivery charge before placing a COD order. Please wait or retry the estimate.");
        setSubmitting(false);
        return;
      }
      const pincodeResult = await checkPincodeServiceability(values.pincode);
      if (!pincodeResult.serviceable) {
        setError("Delivery is not available at this pincode.");
        setSubmitting(false);
        return;
      }

      const enteredAddress = {
        fullName: values.fullName,
        phone: values.phone,
        line1: values.line1,
        ...(values.line2?.trim() ? { line2: values.line2.trim() } : {}),
        city: values.city,
        state: values.state,
        pincode: values.pincode,
      };

      let addressId = selectedAddressId;

      if (!addressId && values.saveAddress) {
        // Reuse an identical saved entry (e.g. saved by an earlier attempt that was
        // dismissed or failed) instead of adding a duplicate on every retry.
        const existing = findMatchingSavedAddress(savedAddresses, enteredAddress);
        const saved =
          existing ??
          (await createMyAddress(token, {
            ...enteredAddress,
            isDefault: savedAddresses.length === 0,
          }));
        addressId = saved.id;
        if (!existing) setSavedAddresses((prev) => [...prev, saved]);
        setSelectedAddressId(saved.id);
        form.setValue("saveAddress", false);
      }

      const quoteFields = {
        notes: values.notes,
        selectedShippingProvider: activeQuote?.selectedShippingProvider,
        shippingChargePaise: activeQuote?.shippingCharge,
        courierCompanyId: activeQuote?.courierCompanyId,
      };
      const destination = addressId ? { addressId } : { shippingAddress: enteredAddress };

      // COD: create order directly (order confirmed immediately)
      if (values.paymentMode === "COD") {
        const orderInput: CreateOrderInput = { ...destination, paymentMode: "COD", ...quoteFields };
        attemptKeys = resolveSubmitAttemptKeys(
          submitKeysRef.current,
          buildCheckoutFingerprint({ paymentMode: "COD", payload: orderInput }),
        );
        submitKeysRef.current = attemptKeys;
        const order = await createOrder(orderInput, token, attemptKeys.orderKey);
        submitKeysRef.current = null;
        clearPendingMerge();
        clearCart();
        router.push(buildCheckoutOutcomeUrl(order));
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

      const prepareInput: PrepareCheckoutInput = { ...destination, ...quoteFields };
      attemptKeys = resolveSubmitAttemptKeys(
        submitKeysRef.current,
        buildCheckoutFingerprint({ paymentMode: "PREPAID", payload: prepareInput }),
      );
      submitKeysRef.current = attemptKeys;
      const checkout = await prepareCheckout(prepareInput, token, attemptKeys.prepareKey);
      // Prepared: a new attempt (after a dismissed modal) gets fresh keys.
      submitKeysRef.current = null;
      attemptKeys = null;

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
          // Money is captured from here on: hold the confirmation payload so it can
          // be retried with the same key and never trigger a fresh checkout.
          const pending: PendingPrepaidConfirmation = {
            input: {
              checkoutSessionId: checkout.checkoutSessionId,
              razorpayOrderId: response.razorpay_order_id,
              razorpayPaymentId: response.razorpay_payment_id,
              razorpaySignature: response.razorpay_signature,
            },
            confirmKey,
          };
          setPendingConfirmation(pending);
          await runPrepaidConfirmation(pending);
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
      if (attemptKeys) {
        // Identical retry after a timeout/5xx/network error replays the same keys.
        submitKeysRef.current = settleSubmitAttemptKeys(attemptKeys, err);
      }
      reportSubmitError(err);
      setSubmitting(false);
    }
  });

  // Inputs: white on the section surface, 16px text on phones (no iOS zoom-on-focus).
  const inputCls = "h-12 w-full rounded-lg border border-input bg-card px-3.5 text-base text-foreground placeholder:text-muted-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 sm:h-11 sm:text-sm";
  const labelCls = "block text-sm font-medium text-foreground";
  const fieldCls = "grid gap-1.5";
  const errorTextCls = "text-xs text-destructive";
  const { errors } = form.formState;
  /** aria wiring: invalid state + description pointing at the field's error text. */
  const fieldA11y = (name: AddressFieldName) =>
    errors[name]
      ? { "aria-invalid": true as const, "aria-describedby": `${name}-error` }
      : { "aria-invalid": false as const };
  const fieldError = (name: AddressFieldName) =>
    errors[name]?.message ? (
      <p id={`${name}-error`} className={errorTextCls}>
        {errors[name]?.message}
      </p>
    ) : null;

  return (
    <form
      id="checkout-form"
      onSubmit={submit}
      className="grid min-w-0 grid-cols-1 gap-5 lg:grid-cols-5 lg:items-start lg:gap-8"
    >
      {/* Details: what we need from the shopper. */}
      <div className="flex min-w-0 flex-col gap-5 lg:col-span-3">
        {/* ── Alerts ───────────────────────────────────────────────────── */}
        {!configAvailable ? (
          <div className="flex items-start gap-2 rounded-xl border border-warning-soft bg-warning-soft px-4 py-3 text-sm text-warning">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
            Store settings are temporarily unavailable. Please refresh the page before placing an order.
          </div>
        ) : null}
        {belowMinOrder ? (
          <div className="flex items-start gap-2 rounded-xl border border-warning-soft bg-warning-soft px-4 py-3">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
            <p className="text-xs font-medium text-warning">
              Add {formatPrice(effectiveMinOrderPaise - cartSubtotal)} more to reach the{" "}
              {formatPrice(effectiveMinOrderPaise)} minimum order value.
            </p>
          </div>
        ) : null}

        {/* ── Shipping Details ─────────────────────────────────────────── */}
        <div className="overflow-hidden rounded-xl border border-border bg-card">
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
                <p className="text-sm font-medium text-foreground">Saved addresses</p>
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
                <input
                  id="fullName"
                  className={inputCls}
                  placeholder="John Doe"
                  autoComplete="shipping name"
                  {...fieldA11y("fullName")}
                  {...registerAddressField("fullName")}
                />
                {fieldError("fullName")}
              </div>
              <div className={fieldCls}>
                <label className={labelCls} htmlFor="phone">Phone</label>
                <input
                  id="phone"
                  type="tel"
                  inputMode="tel"
                  className={inputCls}
                  placeholder="9876543210"
                  autoComplete="shipping tel"
                  {...fieldA11y("phone")}
                  {...registerAddressField("phone")}
                />
                {fieldError("phone")}
              </div>
            </div>

            <div className={fieldCls}>
              <label className={labelCls} htmlFor="line1">Address line 1</label>
              <input
                id="line1"
                className={inputCls}
                placeholder="House/Flat No., Street, Locality"
                autoComplete="shipping address-line1"
                {...fieldA11y("line1")}
                {...registerAddressField("line1")}
              />
              {fieldError("line1")}
            </div>

            <div className={fieldCls}>
              <label className={labelCls} htmlFor="line2">
                Address line 2 <span className="font-normal normal-case text-muted-foreground">(optional)</span>
              </label>
              <input
                id="line2"
                className={inputCls}
                placeholder="Landmark, apartment, etc."
                autoComplete="shipping address-line2"
                {...fieldA11y("line2")}
                {...registerAddressField("line2")}
              />
              {fieldError("line2")}
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
              <div className={fieldCls}>
                <label className={labelCls} htmlFor="city">City</label>
                <input
                  id="city"
                  className={inputCls}
                  autoComplete="shipping address-level2"
                  {...fieldA11y("city")}
                  {...registerAddressField("city")}
                />
                {fieldError("city")}
              </div>
              <div className={fieldCls}>
                <label className={labelCls} htmlFor="state">State</label>
                <input
                  id="state"
                  className={inputCls}
                  autoComplete="shipping address-level1"
                  {...fieldA11y("state")}
                  {...registerAddressField("state")}
                />
                {fieldError("state")}
              </div>
              <div className={fieldCls}>
                <label className={labelCls} htmlFor="pincode">Pincode</label>
                <input
                  id="pincode"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  className={inputCls}
                  autoComplete="shipping postal-code"
                  {...fieldA11y("pincode")}
                  {...registerAddressField("pincode")}
                />
                {fieldError("pincode")}
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
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="border-b border-border bg-muted px-5 py-3.5">
            <h2 className="flex items-center gap-2 text-sm font-bold text-primary">
              <span className="flex size-5 items-center justify-center rounded-full bg-accent text-xs font-extrabold text-white">2</span>
              Payment Method
            </h2>
          </div>

          <fieldset className="grid gap-3 p-5">
            <legend className="sr-only">Payment Method</legend>
            <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-border bg-muted px-4 py-3.5 text-sm font-bold text-primary transition-all has-[:checked]:border-primary has-[:checked]:bg-card has-[:checked]:shadow-sm">
              <input type="radio" value="PREPAID" className="size-4 accent-accent" {...form.register("paymentMode")} />
              <span>Pay Online</span>
              <span className="ml-auto rounded-full bg-secondary px-2 py-0.5 text-xs font-bold text-primary">UPI · Cards · Wallets</span>
            </label>
            {isCodEnabled ? (
              <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-border bg-muted px-4 py-3.5 text-sm font-bold text-primary transition-all has-[:checked]:border-primary has-[:checked]:bg-card has-[:checked]:shadow-sm">
                <input type="radio" value="COD" className="size-4 accent-accent" {...form.register("paymentMode")} />
                <span>Cash on Delivery</span>
                <span className="ml-auto rounded-full bg-secondary px-2 py-0.5 text-xs font-bold text-primary">Pay on arrival</span>
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
          <div className="overflow-hidden rounded-xl border border-border bg-card">
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
        <div className="overflow-hidden rounded-xl border border-border bg-card">
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

      </div>

      {/* Summary: sticky beside the form on desktop, after it on phones. */}
      <aside className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-24 lg:col-span-2">
        {/* ── Cart Item Cards ───────────────────────────────────────────── */}
        {cartItems.length > 0 && (
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="flex items-center gap-2 border-b border-border bg-muted px-5 py-3.5">
              <ShoppingBag className="size-4 text-primary" aria-hidden />
              <span className="text-sm font-bold text-primary">
                Your items ({cartItems.length})
              </span>
            </div>

            <div className="divide-y divide-border">
              {cartItems.map((item) => (
                <div key={item.id} className="flex items-center gap-3 px-5 py-3.5">
                  {/* Badge sits outside the clipped image box so it isn't cut off. */}
                  <div className="relative shrink-0">
                    <div className="relative size-14 overflow-hidden rounded-lg border border-border bg-muted">
                      <Image
                        src={getCartLineImageUrl(item)}
                        alt={getCartLineImageAlt(item)}
                        fill
                        className="object-cover"
                        sizes="56px"
                      />
                    </div>
                    <span
                      aria-label={`Quantity ${item.quantity}`}
                      className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground ring-2 ring-card"
                    >
                      {item.quantity}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <CartLineProductDetails
                      item={item}
                      nameClassName="truncate text-xs font-bold text-primary sm:text-sm"
                      descriptionClassName="text-xs text-muted-foreground line-clamp-1"
                      variantClassName="mt-0.5 text-xs font-semibold text-foreground"
                    />
                    {/* Quantity + unit price spelled out — the badge on the thumbnail
                        alone was easy to miss, and a line total gives no hint of how
                        many units it covers. */}
                    <p className="mt-1 text-xs font-medium text-muted-foreground">
                      Qty {item.quantity}
                      <span aria-hidden> · </span>
                      <span className="sr-only">at </span>
                      {formatPrice(item.priceSnapshot)} each
                    </p>
                  </div>
                  <span className="shrink-0 text-sm font-extrabold text-accent">
                    {formatPrice(item.priceSnapshot * item.quantity)}
                  </span>
                </div>
              ))}
            </div>

          </div>
        )}

        {/* ── Order Summary ─────────────────────────────────────────────── */}
        <div className="overflow-hidden rounded-xl border border-border bg-card">
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
              <div className="rounded-xl bg-warning-soft px-3 py-2 text-xs font-medium text-warning" role="status">
                <p>{shippingQuoteError}</p>
                {!blockedLocalDelivery && (
                  <button
                    type="button"
                    onClick={() => setQuoteRetryNonce((n) => n + 1)}
                    className="mt-1 font-bold underline underline-offset-2 hover:no-underline"
                  >
                    Retry delivery estimate
                  </button>
                )}
              </div>
            )}
            {activeQuote?.selectedShippingProvider === "LOCAL" && (
              <p className="rounded-xl bg-success/10 px-3 py-2 text-xs font-medium text-success">
                Local delivery — this order is delivered directly by the store.
              </p>
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
            {activeQuote && activeQuote.estimatedDays > 0 && (
              <p className="text-xs text-muted-foreground">
                Estimated delivery: {activeQuote.estimatedDays} day{activeQuote.estimatedDays !== 1 ? "s" : ""}
              </p>
            )}
            {/* Included-GST breakup — shown only when the merchant has GST billing on.
                Prices are GST-inclusive, so this is carved OUT of the goods total
                (which never changes): CGST+SGST within the store's state, IGST
                otherwise. Delivery/shipping is untaxed and not part of the breakup. */}
            {hasShippingQuote &&
              taxBreakup &&
              taxBreakup.cgstPaise + taxBreakup.sgstPaise + taxBreakup.igstPaise > 0 && (
                <div className="grid gap-1.5 rounded-xl border border-border bg-muted/50 px-3 py-2.5 text-xs">
                  <p className="font-bold text-muted-foreground">Tax breakup (included in total)</p>
                  <div className="flex justify-between text-muted-foreground">
                    <span>Taxable value</span>
                    <span>{formatPrice(taxBreakup.taxableAmountPaise)}</span>
                  </div>
                  {taxBreakup.isInterState ? (
                    <div className="flex justify-between text-muted-foreground">
                      <span>IGST</span>
                      <span>{formatPrice(taxBreakup.igstPaise)}</span>
                    </div>
                  ) : (
                    <>
                      <div className="flex justify-between text-muted-foreground">
                        <span>CGST</span>
                        <span>{formatPrice(taxBreakup.cgstPaise)}</span>
                      </div>
                      <div className="flex justify-between text-muted-foreground">
                        <span>SGST</span>
                        <span>{formatPrice(taxBreakup.sgstPaise)}</span>
                      </div>
                    </>
                  )}
                </div>
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
          className="hidden h-12 w-full rounded-xl bg-primary text-base font-bold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60 lg:block"
          disabled={submitDisabled}
          aria-busy={submitting || undefined}
        >
          {submitState.label}
        </button>

        {blockedLocalDelivery && (
          <LocalDeliveryBlockedNotice
            open={blockedNoticeOpen}
            onOpenChange={setBlockedNoticeOpen}
            pincode={blockedLocalDelivery.pincode}
            products={blockedLocalDelivery.products}
            onGoToCart={() => router.push("/cart")}
            onChangeAddress={() => form.setFocus("pincode")}
          />
        )}

        {pendingConfirmation ? (
          <div className="grid gap-3 rounded-xl border border-warning-soft bg-warning-soft px-4 py-3 text-sm text-warning">
            <p className="font-bold">Payment received, order not confirmed yet</p>
            <p className="text-xs">
              Payment reference{" "}
              <span className="font-mono font-bold">{pendingConfirmation.input.razorpayPaymentId}</span>.
              Keep this page open and retry. If it keeps failing, contact us with this reference.
            </p>
            <button
              type="button"
              onClick={() => void runPrepaidConfirmation(pendingConfirmation)}
              disabled={confirmingPayment}
              aria-busy={confirmingPayment || undefined}
              className="h-11 w-full rounded-xl bg-primary text-sm font-bold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {confirmingPayment ? "Confirming…" : "Retry confirmation"}
            </button>
          </div>
        ) : null}

        {/* Always-mounted live region so failures are announced, not just painted. */}
        <div role="alert" aria-live="assertive" aria-atomic="true">
          {checkoutError ? (
            <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                {checkoutError.message}
                {checkoutError.showOrdersLink && (
                  <Link href="/orders" className="ml-2 font-bold underline">Go to orders</Link>
                )}
              </span>
            </div>
          ) : null}
        </div>
      </aside>

      {/* Phones: total + place order always within thumb reach. */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-lg lg:hidden">
        {/* The full message lives in the summary (announced there); this line keeps
            the failure visible above the thumb-zone button on phones. */}
        {checkoutError ? (
          <p aria-hidden className="mx-auto mb-2 line-clamp-2 max-w-lg text-xs font-medium text-destructive">
            {checkoutError.message}
            {checkoutError.showOrdersLink ? " See your orders." : ""}
          </p>
        ) : null}
        <div className="mx-auto flex max-w-lg items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted-foreground">{hasShippingQuote ? "Total" : "Total before delivery"}</p>
            <p className="font-heading text-lg font-bold text-foreground tabular">{formatPrice(estimatedPayableTotal)}</p>
          </div>
          {pendingConfirmation ? (
            <button
              type="button"
              onClick={() => void runPrepaidConfirmation(pendingConfirmation)}
              disabled={confirmingPayment}
              aria-busy={confirmingPayment || undefined}
              className="h-12 shrink-0 rounded-xl bg-primary px-6 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {confirmingPayment ? "Confirming…" : "Retry confirmation"}
            </button>
          ) : (
            <button
              type="submit"
              form="checkout-form"
              className="h-12 shrink-0 rounded-xl bg-primary px-6 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={submitDisabled}
              aria-busy={submitting || undefined}
            >
              {submitState.shortLabel}
            </button>
          )}
        </div>
      </div>
    </form>
  );
}
