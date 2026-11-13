import { describe, expect, it } from "vitest";
import { safeStorefrontRedirect, STOREFRONT_DEFAULT_REDIRECT } from "@/lib/storefront-redirect";

describe("safeStorefrontRedirect", () => {
  it("keeps same-origin paths with query and hash", () => {
    expect(safeStorefrontRedirect("/checkout")).toBe("/checkout");
    expect(safeStorefrontRedirect("/checkout/payment?orderId=ord_1")).toBe(
      "/checkout/payment?orderId=ord_1",
    );
    expect(safeStorefrontRedirect("/orders/1#invoice")).toBe("/orders/1#invoice");
  });

  it("falls back for empty or relative values", () => {
    expect(safeStorefrontRedirect(null)).toBe(STOREFRONT_DEFAULT_REDIRECT);
    expect(safeStorefrontRedirect("")).toBe(STOREFRONT_DEFAULT_REDIRECT);
    expect(safeStorefrontRedirect("checkout")).toBe(STOREFRONT_DEFAULT_REDIRECT);
  });

  it.each([
    ["protocol-relative", "//evil.com"],
    ["backslash host (decoded %5C)", "/\\evil.com"],
    ["tab before host", "/\t/evil.com"],
    ["newline before host", "/\n/evil.com"],
    ["absolute URL", "https://evil.com/"],
    ["javascript scheme", "javascript:alert(1)"],
    ["embedded space", "/ /evil.com"],
  ])("rejects %s", (_label, raw) => {
    expect(safeStorefrontRedirect(raw)).toBe(STOREFRONT_DEFAULT_REDIRECT);
  });

  it("never returns a value that resolves off-origin", () => {
    const attacks = ["/\\evil.com", "/\t/evil.com", "/%09/evil.com", "/.//evil.com"];
    for (const raw of attacks) {
      const out = safeStorefrontRedirect(raw);
      expect(new URL(out, "https://shop.example").origin).toBe("https://shop.example");
    }
  });

  it("does not bounce back into the auth pages", () => {
    expect(safeStorefrontRedirect("/login?redirect=/checkout")).toBe(STOREFRONT_DEFAULT_REDIRECT);
    expect(safeStorefrontRedirect("/register")).toBe(STOREFRONT_DEFAULT_REDIRECT);
  });
});
