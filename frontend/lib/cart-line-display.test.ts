import { describe, expect, it } from "vitest";
import type { CartLineItem } from "@/types/cart";
import {
  getCartLineImageAlt,
  getCartLineImageUrl,
  getCartLineProductName,
  getCartLineShortDescription,
  getCartLineVariantLabel,
} from "@/lib/cart-line-display";

const baseItem: CartLineItem = {
  id: "item_1",
  variantId: "variant_1",
  lineTotal: 10000,
  priceSnapshot: 5000,
  quantity: 2,
  product: {
    name: "Organic Tomatoes",
    slug: "organic-tomatoes",
    metaDescription: "Farm-fresh chemical-free tomatoes.",
    imageUrl: "/api/v1/media/products/p1/hero.webp",
    imageAlt: "Organic tomatoes",
  },
  variant: {
    id: "variant_1",
    name: "500g",
    sku: "TOM-500",
    price: 5000,
  },
};

describe("cart line display helpers", () => {
  it("prefers product name over variant label", () => {
    expect(getCartLineProductName(baseItem)).toBe("Organic Tomatoes");
  });

  it("returns short description from product metaDescription", () => {
    expect(getCartLineShortDescription(baseItem)).toBe("Farm-fresh chemical-free tomatoes.");
  });

  it("shows variant label when it differs from product name", () => {
    expect(getCartLineVariantLabel(baseItem)).toBe("500g");
  });

  it("falls back to variant or sku when product is missing", () => {
    const withoutProduct: CartLineItem = {
      ...baseItem,
      product: undefined,
      variant: { ...baseItem.variant, name: "Default", sku: "SKU-FALLBACK" },
    };
    expect(getCartLineProductName(withoutProduct)).toBe("SKU-FALLBACK");
    expect(getCartLineShortDescription(withoutProduct)).toBeNull();
  });

  it("resolves product image url and alt text", () => {
    expect(getCartLineImageUrl(baseItem)).toContain("/api/v1/media/products/p1/hero.webp");
    expect(getCartLineImageAlt(baseItem)).toBe("Organic tomatoes");
  });
});
