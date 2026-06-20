import { afterEach, describe, expect, it, vi } from "vitest";

describe("feature-flags", () => {
  const originalGst = process.env.NEXT_PUBLIC_FEATURE_GST_INVOICING_ENABLED;
  const originalWishlist = process.env.NEXT_PUBLIC_FEATURE_WISHLIST_ENABLED;
  const originalCoupons = process.env.NEXT_PUBLIC_FEATURE_COUPONS_ENABLED;
  const originalReviews = process.env.NEXT_PUBLIC_FEATURE_REVIEWS_ENABLED;

  afterEach(() => {
    if (originalGst === undefined) {
      delete process.env.NEXT_PUBLIC_FEATURE_GST_INVOICING_ENABLED;
    } else {
      process.env.NEXT_PUBLIC_FEATURE_GST_INVOICING_ENABLED = originalGst;
    }
    if (originalWishlist === undefined) {
      delete process.env.NEXT_PUBLIC_FEATURE_WISHLIST_ENABLED;
    } else {
      process.env.NEXT_PUBLIC_FEATURE_WISHLIST_ENABLED = originalWishlist;
    }
    if (originalCoupons === undefined) {
      delete process.env.NEXT_PUBLIC_FEATURE_COUPONS_ENABLED;
    } else {
      process.env.NEXT_PUBLIC_FEATURE_COUPONS_ENABLED = originalCoupons;
    }
    if (originalReviews === undefined) {
      delete process.env.NEXT_PUBLIC_FEATURE_REVIEWS_ENABLED;
    } else {
      process.env.NEXT_PUBLIC_FEATURE_REVIEWS_ENABLED = originalReviews;
    }
    vi.resetModules();
  });

  it("defaults GST invoicing UI to enabled unless explicitly false", async () => {
    delete process.env.NEXT_PUBLIC_FEATURE_GST_INVOICING_ENABLED;
    vi.resetModules();
    const flags = await import("@/lib/feature-flags");
    expect(flags.GST_INVOICING_ENABLED).toBe(true);
  });

  it("defaults wishlist UI to disabled unless explicitly true", async () => {
    delete process.env.NEXT_PUBLIC_FEATURE_WISHLIST_ENABLED;
    vi.resetModules();
    const flags = await import("@/lib/feature-flags");
    expect(flags.WISHLIST_ENABLED).toBe(false);
  });

  it("reads explicit env overrides", async () => {
    process.env.NEXT_PUBLIC_FEATURE_GST_INVOICING_ENABLED = "false";
    process.env.NEXT_PUBLIC_FEATURE_WISHLIST_ENABLED = "true";
    process.env.NEXT_PUBLIC_FEATURE_COUPONS_ENABLED = "true";
    process.env.NEXT_PUBLIC_FEATURE_REVIEWS_ENABLED = "true";
    vi.resetModules();
    const flags = await import("@/lib/feature-flags");
    expect(flags.GST_INVOICING_ENABLED).toBe(false);
    expect(flags.WISHLIST_ENABLED).toBe(true);
    expect(flags.COUPONS_ENABLED).toBe(true);
    expect(flags.REVIEWS_ENABLED).toBe(true);
  });

  it("treats opt-in feature env values case-insensitively", async () => {
    process.env.NEXT_PUBLIC_FEATURE_WISHLIST_ENABLED = "True";
    process.env.NEXT_PUBLIC_FEATURE_COUPONS_ENABLED = "TRUE";
    vi.resetModules();
    const flags = await import("@/lib/feature-flags");
    expect(flags.WISHLIST_ENABLED).toBe(true);
    expect(flags.COUPONS_ENABLED).toBe(true);
  });
});
