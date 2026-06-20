import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refreshAccessToken = vi.fn();

vi.mock("@/lib/auth-api", () => ({
  refreshAccessToken: () => refreshAccessToken(),
}));

import {
  buildUserFromAccessToken,
  resetAuthSessionRestoreCache,
  restoreAuthSessionFromCookie,
} from "@/lib/restore-auth-session";

function makeJwt(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = btoa(JSON.stringify(payload))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `${header}.${body}.sig`;
}

describe("restoreAuthSessionFromCookie", () => {
  beforeEach(() => {
    refreshAccessToken.mockReset();
    resetAuthSessionRestoreCache();
  });

  afterEach(() => {
    resetAuthSessionRestoreCache();
  });

  it("returns user when refresh succeeds", async () => {
    const token = makeJwt({
      sub: "user_1",
      role: "CUSTOMER",
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    refreshAccessToken.mockResolvedValue({ accessToken: token });

    const result = await restoreAuthSessionFromCookie();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.user.id).toBe("user_1");
    }
  });

  it("dedupes concurrent refresh calls", async () => {
    const token = makeJwt({
      sub: "user_1",
      role: "CUSTOMER",
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    refreshAccessToken.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve({ accessToken: token }), 10);
        }),
    );

    await Promise.all([
      restoreAuthSessionFromCookie(),
      restoreAuthSessionFromCookie(),
    ]);

    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
  });
});

describe("buildUserFromAccessToken", () => {
  it("returns null when sub is missing", () => {
    const token = makeJwt({ role: "CUSTOMER", exp: 9999999999 });
    expect(buildUserFromAccessToken(token)).toBeNull();
  });
});
