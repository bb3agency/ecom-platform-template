import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiClientMock = vi.fn();
const refreshMock = vi.fn();

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, apiClient: (...args: unknown[]) => apiClientMock(...args) };
});

vi.mock("@/lib/restore-auth-session", () => ({
  refreshAccessTokenOnce: () => refreshMock(),
}));

import { ApiError } from "@/lib/api";
import { registerStorefrontAuth, storefrontApiClient } from "@/lib/storefront-api-client";
import { confirmPrepaid, createOrder } from "@/lib/orders-api";

describe("storefrontApiClient (refresh-on-401 for customer calls)", () => {
  let token: string | null;
  const onAuthFailure = vi.fn();

  beforeEach(() => {
    apiClientMock.mockReset();
    refreshMock.mockReset();
    onAuthFailure.mockReset();
    token = "expired-token";
    registerStorefrontAuth({
      getAccessToken: () => token,
      setAccessToken: (next) => {
        token = next;
      },
      onAuthFailure,
    });
  });

  afterEach(() => {
    registerStorefrontAuth(null);
  });

  it("refreshes on 401 TOKEN_EXPIRED and retries once with the SAME idempotency key", async () => {
    apiClientMock
      .mockRejectedValueOnce(new ApiError("TOKEN_EXPIRED", "expired", 401))
      .mockResolvedValueOnce({ id: "ord_1" });
    refreshMock.mockResolvedValueOnce({ accessToken: "fresh-token" });

    const order = await confirmPrepaid(
      {
        checkoutSessionId: "cs_1",
        razorpayOrderId: "rzp_o",
        razorpayPaymentId: "rzp_p",
        razorpaySignature: "sig",
      },
      "expired-token",
      "confirm-key-1",
    );

    expect(order).toEqual({ id: "ord_1" });
    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(apiClientMock).toHaveBeenCalledTimes(2);
    const [, firstOpts] = apiClientMock.mock.calls[0] as [string, Record<string, unknown>];
    const [, retryOpts] = apiClientMock.mock.calls[1] as [string, Record<string, unknown>];
    expect(firstOpts.accessToken).toBe("expired-token");
    expect(retryOpts.accessToken).toBe("fresh-token");
    expect(retryOpts.idempotencyKey).toBe("confirm-key-1");
    expect(retryOpts.body).toBe(firstOpts.body);
    expect(token).toBe("fresh-token");
    expect(onAuthFailure).not.toHaveBeenCalled();
  });

  it("clears the session (onAuthFailure) when the refresh itself fails", async () => {
    apiClientMock.mockRejectedValueOnce(new ApiError("UNAUTHORISED", "no", 401));
    refreshMock.mockRejectedValueOnce(new ApiError("UNAUTHORISED", "refresh failed", 401));

    await expect(createOrder({ paymentMode: "COD" }, "expired-token", "k")).rejects.toMatchObject({
      status: 401,
    });
    expect(onAuthFailure).toHaveBeenCalledTimes(1);
    expect(apiClientMock).toHaveBeenCalledTimes(1);
  });

  it("does not refresh for non-auth errors", async () => {
    apiClientMock.mockRejectedValueOnce(new ApiError("VALIDATION_ERROR", "bad", 400));
    await expect(createOrder({ paymentMode: "COD" }, "tok", "k")).rejects.toMatchObject({ status: 400 });
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("is a plain call for guest (token-less) requests", async () => {
    apiClientMock.mockResolvedValueOnce({ ok: true });
    await storefrontApiClient("/cart", { method: "GET", accessToken: null });
    expect(apiClientMock).toHaveBeenCalledTimes(1);
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("is a plain call when no session is registered (server code)", async () => {
    registerStorefrontAuth(null);
    apiClientMock.mockRejectedValueOnce(new ApiError("TOKEN_EXPIRED", "expired", 401));
    await expect(storefrontApiClient("/orders", { accessToken: "t" })).rejects.toMatchObject({
      status: 401,
    });
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
