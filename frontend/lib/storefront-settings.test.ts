import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchPublicStoreConfigClient,
  getPublicStoreConfig,
  parsePublicStoreConfig,
} from "@/lib/storefront-settings";

const STORE_FIELDS = {
  storeName: null,
  storeAddress: null,
  storeState: null,
  contactEmail: null,
  contactPhone: null,
  facebookUrl: null,
  instagramUrl: null,
};

const FAIL_CLOSED_EXPECTED = {
  isCodEnabled: false,
  minOrderValuePaise: 0,
  mobileOtpSignupEnabled: false,
  couponsEnabled: false,
  reviewsEnabled: false,
  galleryEnabled: false,
  returnsEnabled: false,
  wishlistEnabled: false,
  gstInvoicingEnabled: false,
  ...STORE_FIELDS,
  configAvailable: false,
};

describe("storefront-settings", () => {
  const originalFetch = global.fetch;
  const originalApiBase = process.env.NEXT_PUBLIC_API_BASE_URL;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_API_BASE_URL = "http://localhost:3101/api/v1";
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalApiBase === undefined) {
      delete process.env.NEXT_PUBLIC_API_BASE_URL;
    } else {
      process.env.NEXT_PUBLIC_API_BASE_URL = originalApiBase;
    }
    vi.restoreAllMocks();
  });

  it("returns fail-closed defaults when fetch fails", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("network down")) as typeof fetch;
    await expect(getPublicStoreConfig()).resolves.toEqual(FAIL_CLOSED_EXPECTED);
  });

  it("parses enveloped store config responses", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          isCodEnabled: true,
          minOrderValuePaise: 50000,
          mobileOtpSignupEnabled: true,
          couponsEnabled: true,
          reviewsEnabled: false,
          galleryEnabled: false,
          returnsEnabled: false,
          wishlistEnabled: true,
          gstInvoicingEnabled: true,
        },
      }),
    }) as typeof fetch;

    await expect(getPublicStoreConfig()).resolves.toEqual({
      isCodEnabled: true,
      minOrderValuePaise: 50000,
      mobileOtpSignupEnabled: true,
      couponsEnabled: true,
      reviewsEnabled: false,
      galleryEnabled: false,
      returnsEnabled: false,
      wishlistEnabled: true,
      gstInvoicingEnabled: true,
      ...STORE_FIELDS,
      configAvailable: true,
    });
  });

  it("returns fail-closed defaults for non-OK responses", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: "down" }),
    }) as typeof fetch;

    await expect(getPublicStoreConfig()).resolves.toEqual(FAIL_CLOSED_EXPECTED);
  });

  it("parsePublicStoreConfig handles raw responses", () => {
    expect(
      parsePublicStoreConfig({
        isCodEnabled: true,
        minOrderValuePaise: 25000,
        mobileOtpSignupEnabled: false,
        couponsEnabled: true,
        reviewsEnabled: true,
        galleryEnabled: false,
        returnsEnabled: false,
        wishlistEnabled: false,
        gstInvoicingEnabled: false,
      }),
    ).toEqual({
      isCodEnabled: true,
      minOrderValuePaise: 25000,
      mobileOtpSignupEnabled: false,
      couponsEnabled: true,
      reviewsEnabled: true,
      galleryEnabled: false,
      returnsEnabled: false,
      wishlistEnabled: false,
      gstInvoicingEnabled: false,
      ...STORE_FIELDS,
      configAvailable: true,
    });
  });

  it("fetchPublicStoreConfigClient uses browser API base", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          isCodEnabled: false,
          minOrderValuePaise: 0,
          mobileOtpSignupEnabled: true,
          couponsEnabled: false,
          reviewsEnabled: false,
          galleryEnabled: false,
          returnsEnabled: false,
          wishlistEnabled: false,
          gstInvoicingEnabled: false,
        },
      }),
    }) as typeof fetch;

    await expect(fetchPublicStoreConfigClient()).resolves.toEqual({
      isCodEnabled: false,
      minOrderValuePaise: 0,
      mobileOtpSignupEnabled: true,
      couponsEnabled: false,
      reviewsEnabled: false,
      galleryEnabled: false,
      returnsEnabled: false,
      wishlistEnabled: false,
      gstInvoicingEnabled: false,
      ...STORE_FIELDS,
      configAvailable: true,
    });
    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:3101/api/v1/store/config",
      { cache: "no-store" },
    );
  });
});
