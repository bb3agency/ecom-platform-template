import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  redirectToAdminHome,
  redirectToAdminLogin,
  redirectToAdminLoginIfNeeded,
} from "@/lib/admin-auth-navigation";

describe("admin-auth-navigation", () => {
  const assign = vi.fn();

  beforeEach(() => {
    assign.mockClear();
    vi.stubGlobal("window", {
      location: { assign, pathname: "/admin/orders" },
    } as unknown as Window);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("redirects to admin login", () => {
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
    expect(assign).toHaveBeenCalledWith("/admin/login");
  });
});
