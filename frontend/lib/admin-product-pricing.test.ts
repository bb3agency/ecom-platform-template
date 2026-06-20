import { describe, expect, it } from "vitest";
import type { AdminProductDetail } from "@/lib/admin-api";
import {
  buildPrimaryVariantPricePatch,
  formatVariantCompareAtPriceInput,
  formatVariantPriceInput,
  mergePrimaryVariantPrices,
  parseRupeesToPaise,
  primaryVariantPricingFromApi,
} from "@/lib/admin-product-pricing";

const sampleProduct = {
  id: "prod_1",
  name: "Organic Honey",
  slug: "organic-honey",
  description: "Pure honey",
  tags: [],
  isFeatured: false,
  isActive: true,
  metaDescription: null,
  category: { id: "cat_1", name: "Honey", slug: "honey" },
  images: [],
  variants: [
    {
      id: "var_1",
      sku: "HNY-500",
      name: "Default",
      price: 5000,
      compareAtPrice: 50000,
      weight: 500,
      isActive: true,
    },
  ],
} satisfies AdminProductDetail;

describe("admin-product-pricing", () => {
  it("converts rupee inputs to paise", () => {
    expect(parseRupeesToPaise("50")).toBe(5000);
    expect(parseRupeesToPaise("500")).toBe(50000);
    expect(parseRupeesToPaise("49.99")).toBe(4999);
  });

  it("rejects invalid rupee inputs", () => {
    expect(parseRupeesToPaise("")).toBeUndefined();
    expect(parseRupeesToPaise("abc")).toBeUndefined();
    expect(parseRupeesToPaise("-1")).toBeUndefined();
  });

  it("formats API paise values for editable rupee inputs", () => {
    expect(formatVariantPriceInput(5000)).toBe("50");
    expect(formatVariantCompareAtPriceInput(50000)).toBe("500");
    expect(formatVariantCompareAtPriceInput(null)).toBe("");
  });

  it("hydrates primary variant pricing from API data", () => {
    expect(primaryVariantPricingFromApi(sampleProduct.variants[0])).toEqual({
      priceRupees: "50",
      compareAtPriceRupees: "500",
    });
  });

  it("builds the variant PATCH body for edit-mode save", () => {
    expect(buildPrimaryVariantPricePatch("75", "120")).toEqual({
      ok: true,
      price: 7500,
      compareAtPrice: 12000,
    });
  });

  it("clears compare-at price when the input is blank", () => {
    expect(buildPrimaryVariantPricePatch("50", "")).toEqual({
      ok: true,
      price: 5000,
      compareAtPrice: null,
    });
  });

  it("returns a field error when price is invalid", () => {
    expect(buildPrimaryVariantPricePatch("", "500")).toEqual({
      ok: false,
      field: "price",
      message: "Price must be a non-negative number (rupees).",
    });
  });

  it("merges updated primary variant prices into product detail", () => {
    expect(
      mergePrimaryVariantPrices(sampleProduct, "var_1", 7500, 12000),
    ).toEqual({
      ...sampleProduct,
      variants: [
        {
          ...sampleProduct.variants[0],
          price: 7500,
          compareAtPrice: 12000,
        },
      ],
    });
  });
});
