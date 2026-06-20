import { describe, expect, it } from "vitest";
import { canViewAdminPath, resolveAdminRouteFromPathname } from "@/lib/permissions";

describe("admin route permissions", () => {
  const inventoryOnly = {
    role: "STAFF" as const,
    permissions: ["inventory:read"],
  };

  it("resolves inventory path", () => {
    expect(resolveAdminRouteFromPathname("/admin/inventory")).toBe("inventory");
  });

  it("denies orders path for inventory-only staff", () => {
    expect(canViewAdminPath(inventoryOnly, "/admin/orders")).toBe(false);
  });

  it("allows inventory path for inventory-only staff", () => {
    expect(canViewAdminPath(inventoryOnly, "/admin/inventory")).toBe(true);
  });

  it("allows dashboard for inventory staff via prefix rule", () => {
    expect(canViewAdminPath(inventoryOnly, "/admin")).toBe(true);
  });

  const categoriesOnly = {
    role: "STAFF" as const,
    permissions: ["categories:read"],
  };

  it("resolves categories path", () => {
    expect(resolveAdminRouteFromPathname("/admin/categories")).toBe("categories");
    expect(resolveAdminRouteFromPathname("/admin/categories/new")).toBe("categories");
  });

  it("allows categories path for categories-only staff", () => {
    expect(canViewAdminPath(categoriesOnly, "/admin/categories")).toBe(true);
  });

  it("denies products path for categories-only staff", () => {
    expect(canViewAdminPath(categoriesOnly, "/admin/products")).toBe(false);
  });

  it("allows dashboard for categories-only staff", () => {
    expect(canViewAdminPath(categoriesOnly, "/admin")).toBe(true);
  });

  it("treats categories-only staff as admin users", async () => {
    const { isAdminUser } = await import("@/lib/permissions");
    expect(isAdminUser(categoriesOnly)).toBe(true);
  });
});
