import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyCartCoupon, removeCartCoupon } from "@/lib/cart-api";

const apiClientMock = vi.fn();

vi.mock("@/lib/api", () => ({
  apiClient: (...args: unknown[]) => apiClientMock(...args),
}));

vi.mock("@/lib/idempotency", () => ({
  createIdempotencyKey: () => "test-idempotency-key",
}));

describe("cart-api coupon helpers", () => {
  beforeEach(() => {
    apiClientMock.mockReset();
    apiClientMock.mockResolvedValue({ id: "cart_1", items: [] });
  });

  it("applyCartCoupon posts trimmed coupon code", async () => {
    await applyCartCoupon("  save10  ", "token_1");

    expect(apiClientMock).toHaveBeenCalledWith("/cart/coupon", {
      method: "POST",
      accessToken: "token_1",
      idempotencyKey: "test-idempotency-key",
      body: JSON.stringify({ code: "save10" }),
    });
  });

  it("removeCartCoupon deletes applied coupon", async () => {
    await removeCartCoupon("token_1");

    expect(apiClientMock).toHaveBeenCalledWith("/cart/coupon", {
      method: "DELETE",
      accessToken: "token_1",
    });
  });
});
