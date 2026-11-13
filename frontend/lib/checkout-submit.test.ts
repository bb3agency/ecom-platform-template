import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import {
  buildCheckoutFingerprint,
  confirmWithRetry,
  findMatchingSavedAddress,
  getCheckoutSubmitState,
  getPriceChangedItems,
  isOutcomeUnknownError,
  isPriceChangedError,
  isRetryableCheckoutError,
  refreshAfterPriceChange,
  resolveSubmitAttemptKeys,
  settleSubmitAttemptKeys,
  shouldRedirectPaymentToLogin,
  type CheckoutSubmitStateInput,
} from "@/lib/checkout-submit";
import { getApiErrorMessage } from "@/lib/error-messages";

const timeout = () => new ApiError("REQUEST_TIMEOUT", "Request timed out", 408);
const validation = () => new ApiError("VALIDATION_ERROR", "Cart is empty", 400);

describe("isRetryableCheckoutError", () => {
  it("retries timeouts, network failures, 5xx and 409 in-flight conflicts", () => {
    expect(isRetryableCheckoutError(timeout())).toBe(true);
    expect(isRetryableCheckoutError(new TypeError("Failed to fetch"))).toBe(true);
    expect(isRetryableCheckoutError(new ApiError("INTERNAL_ERROR", "x", 500))).toBe(true);
    expect(isRetryableCheckoutError(new ApiError("SERVICE_UNAVAILABLE", "x", 503))).toBe(true);
    expect(isRetryableCheckoutError(new ApiError("CONFLICT", "processing", 409))).toBe(true);
  });

  it("treats 4xx answers as final", () => {
    expect(isRetryableCheckoutError(validation())).toBe(false);
    expect(isRetryableCheckoutError(new ApiError("UNAUTHORISED", "x", 401))).toBe(false);
    expect(isRetryableCheckoutError(new Error("boom"))).toBe(false);
  });

  it("flags unknown outcomes (order may exist) only for timeouts/network/504", () => {
    expect(isOutcomeUnknownError(timeout())).toBe(true);
    expect(isOutcomeUnknownError(new TypeError("Failed to fetch"))).toBe(true);
    expect(isOutcomeUnknownError(new ApiError("GATEWAY_TIMEOUT", "x", 504))).toBe(true);
    expect(isOutcomeUnknownError(new ApiError("INTERNAL_ERROR", "x", 500))).toBe(false);
  });
});

describe("submit idempotency keys", () => {
  const counter = () => {
    let n = 0;
    return () => `key-${++n}`;
  };
  const fp = buildCheckoutFingerprint({ paymentMode: "COD", payload: { addressId: "addr_1" } });

  it("replays the same keys after a timeout for an identical submit", () => {
    const createKey = counter();
    const first = resolveSubmitAttemptKeys(null, fp, createKey);
    const afterTimeout = settleSubmitAttemptKeys(first, timeout());
    const retry = resolveSubmitAttemptKeys(afterTimeout, fp, createKey);
    expect(retry.orderKey).toBe(first.orderKey);
    expect(retry.prepareKey).toBe(first.prepareKey);
  });

  it("issues fresh keys after a final (4xx) error", () => {
    const createKey = counter();
    const first = resolveSubmitAttemptKeys(null, fp, createKey);
    const settled = settleSubmitAttemptKeys(first, validation());
    expect(resolveSubmitAttemptKeys(settled, fp, createKey).orderKey).not.toBe(first.orderKey);
  });

  it("issues fresh keys when the payload changed", () => {
    const createKey = counter();
    const first = settleSubmitAttemptKeys(resolveSubmitAttemptKeys(null, fp, createKey), timeout());
    const otherFp = buildCheckoutFingerprint({ paymentMode: "COD", payload: { addressId: "addr_2" } });
    expect(resolveSubmitAttemptKeys(first, otherFp, createKey).orderKey).not.toBe(first.orderKey);
  });

  it("fingerprints differ by payment mode", () => {
    const prepaid = buildCheckoutFingerprint({ paymentMode: "PREPAID", payload: { addressId: "addr_1" } });
    expect(prepaid).not.toBe(fp);
  });
});

describe("confirmWithRetry", () => {
  const noSleep = { sleep: () => Promise.resolve() };

  it("retries a captured-payment confirmation on timeout/5xx and returns the order", async () => {
    const confirm = vi
      .fn<() => Promise<{ id: string }>>()
      .mockRejectedValueOnce(timeout())
      .mockRejectedValueOnce(new ApiError("SERVICE_UNAVAILABLE", "x", 503))
      .mockResolvedValueOnce({ id: "ord_1" });
    await expect(confirmWithRetry(confirm, noSleep)).resolves.toEqual({ id: "ord_1" });
    expect(confirm).toHaveBeenCalledTimes(3);
  });

  it("is bounded — gives up after the configured attempts", async () => {
    const confirm = vi.fn<() => Promise<unknown>>().mockRejectedValue(timeout());
    await expect(confirmWithRetry(confirm, { ...noSleep, delaysMs: [1, 1] })).rejects.toMatchObject({
      code: "REQUEST_TIMEOUT",
    });
    expect(confirm).toHaveBeenCalledTimes(3);
  });

  it("does not retry final errors", async () => {
    const confirm = vi.fn<() => Promise<unknown>>().mockRejectedValue(validation());
    await expect(confirmWithRetry(confirm, noSleep)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(confirm).toHaveBeenCalledTimes(1);
  });
});

describe("getCheckoutSubmitState", () => {
  const base: CheckoutSubmitStateInput = {
    submitting: false,
    configAvailable: true,
    belowMinOrder: false,
    blockedLocalDelivery: false,
    pendingConfirmation: false,
    pincodeComplete: true,
    shippingQuoteLoading: false,
    hasShippingQuote: true,
    paymentMode: "COD",
  };

  it("enables submit with a quote", () => {
    expect(getCheckoutSubmitState(base)).toMatchObject({
      disabled: false,
      label: "Place Order — Cash on Delivery",
    });
  });

  it("blocks while the delivery quote is loading", () => {
    expect(getCheckoutSubmitState({ ...base, shippingQuoteLoading: true }).disabled).toBe(true);
    expect(
      getCheckoutSubmitState({ ...base, paymentMode: "PREPAID", shippingQuoteLoading: true }).disabled,
    ).toBe(true);
  });

  it("blocks COD without a delivery quote but lets prepaid continue", () => {
    expect(getCheckoutSubmitState({ ...base, hasShippingQuote: false }).disabled).toBe(true);
    expect(
      getCheckoutSubmitState({ ...base, hasShippingQuote: false, paymentMode: "PREPAID" }).disabled,
    ).toBe(false);
  });

  it("blocks a new checkout while a captured payment awaits confirmation", () => {
    expect(getCheckoutSubmitState({ ...base, pendingConfirmation: true }).disabled).toBe(true);
  });

  it("leaves an incomplete pincode to field validation", () => {
    expect(
      getCheckoutSubmitState({ ...base, pincodeComplete: false, hasShippingQuote: false }).disabled,
    ).toBe(false);
  });
});

describe("findMatchingSavedAddress", () => {
  const saved = [
    {
      id: "addr_1",
      fullName: "Asha Rao",
      phone: "9876543210",
      line1: "12 MG Road",
      line2: null,
      city: "Bengaluru",
      state: "Karnataka",
      pincode: "560001",
    },
  ];

  it("reuses an identical saved address instead of creating a duplicate", () => {
    expect(
      findMatchingSavedAddress(saved, {
        fullName: " asha  rao ",
        phone: "9876543210",
        line1: "12 MG Road",
        city: "Bengaluru",
        state: "Karnataka",
        pincode: "560001",
      })?.id,
    ).toBe("addr_1");
  });

  it("returns undefined for a different address", () => {
    expect(
      findMatchingSavedAddress(saved, {
        fullName: "Asha Rao",
        phone: "9876543210",
        line1: "14 MG Road",
        city: "Bengaluru",
        state: "Karnataka",
        pincode: "560001",
      }),
    ).toBeUndefined();
  });
});

describe("shouldRedirectPaymentToLogin", () => {
  const base = { isReady: true, orderId: "ord_1" };

  it("does NOT redirect a signed-in customer (regression: inverted guard)", () => {
    expect(
      shouldRedirectPaymentToLogin({ ...base, accessToken: "tok", sessionStatus: "authenticated" }),
    ).toBe(false);
  });

  it("redirects a guest once the session check has finished", () => {
    expect(shouldRedirectPaymentToLogin({ ...base, accessToken: null, sessionStatus: "guest" })).toBe(true);
  });

  it("waits while the session is still being restored", () => {
    expect(shouldRedirectPaymentToLogin({ ...base, accessToken: null, sessionStatus: "checking" })).toBe(false);
  });

  it("does nothing without an order id or router", () => {
    expect(
      shouldRedirectPaymentToLogin({ isReady: true, orderId: null, accessToken: null, sessionStatus: "guest" }),
    ).toBe(false);
    expect(
      shouldRedirectPaymentToLogin({ isReady: false, orderId: "o", accessToken: null, sessionStatus: "guest" }),
    ).toBe(false);
  });
});

describe("PRICE_CHANGED handling", () => {
  const priceChanged = () =>
    new ApiError("PRICE_CHANGED", "Prices changed", 409, {
      items: [
        { variantId: "var_1", previousPricePaise: 10000, currentPricePaise: 12000 },
        { variantId: 42, previousPricePaise: "x" },
      ],
    });

  it("is recognised by code, shows the customer copy and is not retried with the same keys", () => {
    const err = priceChanged();
    expect(isPriceChangedError(err)).toBe(true);
    expect(isPriceChangedError(new ApiError("CONFLICT", "x", 409))).toBe(false);
    expect(getApiErrorMessage(err)).toBe(
      "Some prices in your cart changed. Please review the updated total.",
    );
    expect(isRetryableCheckoutError(err)).toBe(false);
  });

  it("reads well-formed details.items only", () => {
    expect(getPriceChangedItems(priceChanged())).toEqual([
      { variantId: "var_1", previousPricePaise: 10000, currentPricePaise: 12000 },
    ]);
    expect(getPriceChangedItems(new ApiError("PRICE_CHANGED", "x", 409))).toEqual([]);
    expect(getPriceChangedItems(validation())).toEqual([]);
  });

  it("reloads the re-priced cart and re-requests the quote", async () => {
    const repriced = { id: "cart_1", subtotal: 12000 };
    const setCart = vi.fn();
    const requote = vi.fn();
    await expect(
      refreshAfterPriceChange({ loadCart: async () => repriced, setCart, requote }),
    ).resolves.toBe(true);
    expect(setCart).toHaveBeenCalledWith(repriced);
    expect(requote).toHaveBeenCalledOnce();
  });

  it("never throws when the cart reload fails, and still re-quotes", async () => {
    const setCart = vi.fn();
    const requote = vi.fn();
    await expect(
      refreshAfterPriceChange({
        loadCart: () => Promise.reject(new TypeError("Failed to fetch")),
        setCart,
        requote,
      }),
    ).resolves.toBe(false);
    expect(setCart).not.toHaveBeenCalled();
    expect(requote).toHaveBeenCalledOnce();
  });
});
