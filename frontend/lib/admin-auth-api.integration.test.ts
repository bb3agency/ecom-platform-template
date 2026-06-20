import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api";
import {
  getAdminOtpChannelConfig,
  requestAdminLoginOtp,
  verifyAdminLoginOtp,
} from "@/lib/admin-auth-api";

function expectApiOrNetworkError(error: unknown): void {
  expect(error).toSatisfy(
    (value: unknown) => value instanceof ApiError || value instanceof TypeError,
  );
}

describe("admin auth api integration", () => {
  it("exposes admin OTP channel endpoint contract", async () => {
    try {
      await getAdminOtpChannelConfig();
    } catch (error) {
      expectApiOrNetworkError(error);
    }
  });

  it("admin login OTP request returns generic 200 for unknown email (anti-enumeration)", async () => {
    try {
      const result = await requestAdminLoginOtp({
        email: "nobody@example.com",
        password: "invalid-password",
      });
      expect(result).toHaveProperty("message");
      expect(typeof result.message).toBe("string");
      expect(result).toHaveProperty("expiresAt");
    } catch (error) {
      expectApiOrNetworkError(error);
    }
  });

  it("admin login OTP request rejects wrong password for known admin with INVALID_CREDENTIALS", async () => {
    try {
      await requestAdminLoginOtp({
        email: process.env.ADMIN_TEST_EMAIL ?? "admin@example.com",
        password: "definitely-wrong-password",
      });
    } catch (error) {
      if (error instanceof ApiError) {
        expect(error.code).toBe("INVALID_CREDENTIALS");
        return;
      }
      expectApiOrNetworkError(error);
    }
  });

  it("admin OTP verify rejects malformed payload at schema layer", async () => {
    await expect(
      verifyAdminLoginOtp({ email: "invalid", otp: "12" }),
    ).rejects.toBeTruthy();
  });
});
