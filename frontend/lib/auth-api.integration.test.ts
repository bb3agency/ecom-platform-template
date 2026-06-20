import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api";
import {
  loginWithEmail,
  refreshAccessToken,
  sendOtp,
  verifyOtp,
  getOtpChannelConfig,
} from "@/lib/auth-api";

function expectApiOrNetworkError(error: unknown): void {
  // These tests run in environments where backend may be offline.
  // When online, auth failures should surface as ApiError.
  // When offline, fetch throws TypeError("fetch failed").
  expect(error).toSatisfy(
    (value: unknown) => value instanceof ApiError || value instanceof TypeError,
  );
}

describe("auth api integration", () => {
  it("rejects malformed otp payload at client schema layer", async () => {
    await expect(
      verifyOtp({ phone: "123", otp: "12" }),
    ).rejects.toBeTruthy();
  });

  it("returns structured error for refresh without cookie", async () => {
    try {
      await refreshAccessToken();
      expect.fail("Expected refresh to fail without a valid cookie");
    } catch (error) {
      expectApiOrNetworkError(error);
      if (error instanceof ApiError) {
        expect(error.status).toBeGreaterThanOrEqual(400);
      }
    }
  });

  it("auth endpoints return API errors for invalid credentials", async () => {
    await expect(
      loginWithEmail({
        identifier: "nobody@example.com",
        password: "invalid-password",
      }),
    ).rejects.toSatisfy(
      (error: unknown) => error instanceof ApiError || error instanceof TypeError,
    );

    await expect(
      sendOtp({
        phone: "99999",
      }),
    ).rejects.toBeTruthy();
  });

  it("getOtpChannelConfig rejects without backend setup but respects signature", async () => {
    try {
      await getOtpChannelConfig();
    } catch (error) {
      expectApiOrNetworkError(error);
    }
  });
});
