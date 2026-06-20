import { afterEach, describe, expect, it, vi } from "vitest";
import {
  absoluteUrl,
  getSiteUrl,
  isNoIndexPath,
  isProductionIndexableSite,
} from "@/lib/seo";

describe("seo", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("builds absolute URLs from storefront origin", () => {
    vi.stubEnv("NEXT_PUBLIC_STOREFRONT_URL", "https://raghavaorganics.com/");
    expect(getSiteUrl()).toBe("https://raghavaorganics.com");
    expect(absoluteUrl("/products/foo")).toBe(
      "https://raghavaorganics.com/products/foo",
    );
  });

  it("flags sensitive routes for noindex", () => {
    expect(isNoIndexPath("/admin/orders")).toBe(true);
    expect(isNoIndexPath("/ops/config")).toBe(true);
    expect(isNoIndexPath("/checkout/payment")).toBe(true);
    expect(isNoIndexPath("/products/organic-honey")).toBe(false);
  });

  it("blocks indexing on localhost even in production mode", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_STOREFRONT_URL", "http://localhost:3101");
    expect(isProductionIndexableSite()).toBe(false);
  });

  it("allows indexing on production storefront host", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_STOREFRONT_URL", "https://raghavaorganics.com");
    expect(isProductionIndexableSite()).toBe(true);
  });
});
