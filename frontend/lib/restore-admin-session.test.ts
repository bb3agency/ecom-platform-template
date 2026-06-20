import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refreshAccessToken = vi.fn();

vi.mock("@/lib/auth-api", () => ({
  refreshAccessToken: () => refreshAccessToken(),
}));

import {
  buildUserFromAccessToken,
  resetAdminSessionRestoreCache,
  restoreAdminSessionFromCookie,
} from "@/lib/restore-admin-session";

function makeAdminJwt(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = btoa(JSON.stringify(payload))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `${header}.${body}.sig`;
}

describe("restoreAdminSessionFromCookie", () => {
  beforeEach(() => {
    refreshAccessToken.mockReset();
    resetAdminSessionRestoreCache();
  });

  afterEach(() => {
    resetAdminSessionRestoreCache();
  });

  it("returns admin user when refresh succeeds with ADMIN role", async () => {
    const token = makeAdminJwt({
      sub: "admin_1",
      role: "ADMIN",
      permissions: ["orders:read"],
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    refreshAccessToken.mockResolvedValue({ accessToken: token });

    const result = await restoreAdminSessionFromCookie();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.user.id).toBe("admin_1");
      expect(result.user.role).toBe("ADMIN");
      expect(result.accessToken).toBe(token);
    }
  });

  it("returns not_admin when token has no admin permissions", async () => {
    const token = makeAdminJwt({
      sub: "user_1",
      role: "CUSTOMER",
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    refreshAccessToken.mockResolvedValue({ accessToken: token });

    const result = await restoreAdminSessionFromCookie();
    expect(result).toEqual({ ok: false, reason: "not_admin" });
  });

  it("returns unauthorised when refresh throws", async () => {
    refreshAccessToken.mockRejectedValue(new Error("no cookie"));

    const result = await restoreAdminSessionFromCookie();
    expect(result).toEqual({ ok: false, reason: "unauthorised" });
  });

  it("dedupes concurrent restore calls (single refresh)", async () => {
    const token = makeAdminJwt({
      sub: "admin_1",
      role: "ADMIN",
      permissions: ["products:read"],
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    refreshAccessToken.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve({ accessToken: token }), 10);
        }),
    );

    const [a, b] = await Promise.all([
      restoreAdminSessionFromCookie(),
      restoreAdminSessionFromCookie(),
    ]);

    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
    expect(a.ok).toBe(true);
  });
});

describe("buildUserFromAccessToken", () => {
  it("parses permissions from JWT payload", () => {
    const token = makeAdminJwt({
      sub: "a1",
      role: "ADMIN",
      permissions: ["orders:read", "products:write"],
      exp: 9999999999,
    });
    const user = buildUserFromAccessToken(token);
    expect(user?.permissions).toEqual(["orders:read", "products:write"]);
  });
});
