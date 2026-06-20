import { describe, expect, it } from "vitest";
import { getAdminNavItems } from "@/components/admin/admin-nav-config";

describe("getAdminNavItems", () => {
  it("always includes coupons and reviews routes for admin moderation", () => {
    const hrefs = getAdminNavItems().map((item) => item.href);
    expect(hrefs.some((href) => href.startsWith("/admin/coupons"))).toBe(true);
    expect(hrefs.some((href) => href.startsWith("/admin/reviews"))).toBe(true);
  });
});
