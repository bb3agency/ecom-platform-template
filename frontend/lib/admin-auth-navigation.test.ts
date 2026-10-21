import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  redirectToAdminHome,
  redirectToAdminLogin,
  redirectToAdminLoginIfNeeded,
  safeAdminNextPath,
} from "@/lib/admin-auth-navigation";

describe("admin-auth-navigation", () => {
  const assign = vi.fn();

  beforeEach(() => {
    assign.mockClear();
    vi.stubGlobal("window", {
      location: { assign, pathname: "/admin/orders", search: "?status=CONFIRMED" },
    } as unknown as Window);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("redirects to admin login, remembering the page to come back to", () => {
    redirectToAdminLogin();
    expect(assign).toHaveBeenCalledWith(`/admin/login?next=${encodeURIComponent("/admin/orders?status=CONFIRMED")}`);
  });

  it("omits next when leaving the dashboard itself", () => {
    vi.stubGlobal("window", { location: { assign, pathname: "/admin", search: "" } } as unknown as Window);
    redirectToAdminLogin();
    expect(assign).toHaveBeenCalledWith("/admin/login");
  });

  it("redirects to admin home", () => {
    redirectToAdminHome();
    expect(assign).toHaveBeenCalledWith("/admin");
  });

  it("skips redirect when already on admin login", () => {
    vi.stubGlobal("window", {
      location: { assign, pathname: "/admin/login" },
    } as unknown as Window);
    redirectToAdminLoginIfNeeded();
    expect(assign).not.toHaveBeenCalled();
  });

  it("redirects from protected admin routes", () => {
    redirectToAdminLoginIfNeeded();
    expect(assign).toHaveBeenCalledWith(`/admin/login?next=${encodeURIComponent("/admin/orders?status=CONFIRMED")}`);
  });
});

describe("safeAdminNextPath", () => {
  it("returns to the admin page you were on", () => {
    expect(safeAdminNextPath("/admin/orders/abc-123")).toBe("/admin/orders/abc-123");
    expect(safeAdminNextPath("/admin/orders?status=CONFIRMED&range=all")).toBe("/admin/orders?status=CONFIRMED&range=all");
  });

  it("falls back to the dashboard for empty, auth or non-admin paths", () => {
    expect(safeAdminNextPath(null)).toBe("/admin");
    expect(safeAdminNextPath("/admin/login")).toBe("/admin");
    expect(safeAdminNextPath("/admin/setup?token=x")).toBe("/admin");
    expect(safeAdminNextPath("/account/orders")).toBe("/admin");
    expect(safeAdminNextPath("/administrator")).toBe("/admin");
  });

  it("never allows an open redirect", () => {
    expect(safeAdminNextPath("https://evil.example/admin")).toBe("/admin");
    expect(safeAdminNextPath("//evil.example/admin")).toBe("/admin");
    expect(safeAdminNextPath("/admin\..\evil")).toBe("/admin");
    expect(safeAdminNextPath("/admin/orders\u0000")).toBe("/admin");
  });
});
