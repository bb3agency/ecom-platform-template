import { describe, expect, it } from "vitest";
import { formatPrice } from "@/lib/format-price";

describe("formatPrice", () => {
  it("renders whole-rupee amounts without decimals", () => {
    expect(formatPrice(45000)).toBe("₹450");
    expect(formatPrice(0)).toBe("₹0");
    expect(formatPrice(100)).toBe("₹1");
  });

  it("keeps two decimals for fractional amounts", () => {
    expect(formatPrice(45050)).toBe("₹450.50");
    expect(formatPrice(99)).toBe("₹0.99");
    expect(formatPrice(12345)).toBe("₹123.45");
  });

  it("groups in the en-IN (lakh/crore) system", () => {
    expect(formatPrice(100000000)).toBe("₹10,00,000");
  });

  it("honours an explicit currency and still drops .00 on whole amounts", () => {
    const usd = formatPrice(45000, "USD");
    expect(usd).toContain("450");
    expect(usd).not.toContain(".00");
  });
});
