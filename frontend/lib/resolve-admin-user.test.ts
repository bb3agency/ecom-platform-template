import { describe, expect, it } from "vitest";
import { resolveAdminUser } from "@/lib/resolve-admin-user";

function makeJwt(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = btoa(JSON.stringify(payload))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `${header}.${body}.sig`;
}

describe("resolveAdminUser", () => {
  const adminToken = makeJwt({
    sub: "admin_1",
    role: "ADMIN",
    permissions: ["orders:read"],
    exp: Math.floor(Date.now() / 1000) + 3600,
  });

  it("resolves admin from access token when zustand user is still null", () => {
    const resolved = resolveAdminUser(adminToken, null);
    expect(resolved?.id).toBe("admin_1");
  });

  it("returns null when token is expired and user is null", () => {
    const expired = makeJwt({
      sub: "admin_1",
      role: "ADMIN",
      exp: Math.floor(Date.now() / 1000) - 60,
    });
    expect(resolveAdminUser(expired, null)).toBeNull();
  });
});
