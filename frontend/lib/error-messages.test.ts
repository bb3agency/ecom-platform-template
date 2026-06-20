import { describe, it, expect } from "vitest";
import {
  getErrorMessage,
  getAdminLoginErrorMessage,
  getApiErrorMessageWithHint,
  getOpsLoginErrorMessage,
  isAuthFailureCode,
  isOpsOtpVerificationError,
  isOpsSessionAuthFailure,
  shouldAttemptTokenRefresh,
  shouldForceLogin,
} from "@/lib/error-messages";
import { ApiError } from "@/lib/api";

describe("error-messages", () => {
  it("maps known codes to copy", () => {
    expect(getErrorMessage("PINCODE_NOT_SERVICEABLE")).toContain("pincode");
  });

  it("includes missing keys hint for CONFIG_NOT_READY", () => {
    const err = new ApiError("CONFIG_NOT_READY", "missing runtime config", 503, {
      fields: [
        { field: "PAYMENT_PROVIDER" },
        { field: "RAZORPAY_KEY_ID" },
      ],
    });
    expect(getApiErrorMessageWithHint(err)).toContain("Missing keys");
    expect(getApiErrorMessageWithHint(err)).toContain("PAYMENT_PROVIDER");
  });

  it("identifies auth failure codes", () => {
    expect(isAuthFailureCode("UNAUTHORISED")).toBe(true);
    expect(isAuthFailureCode("CONFLICT")).toBe(false);
  });

  it("detects token refresh eligibility", () => {
    const err = new ApiError("TOKEN_EXPIRED", "expired", 401);
    expect(shouldAttemptTokenRefresh(err)).toBe(true);
  });

  it("maps admin login INVALID_CREDENTIALS to password-specific copy", () => {
    const err = new ApiError("INVALID_CREDENTIALS", "Incorrect password", 401);
    expect(getAdminLoginErrorMessage(err)).toBe("Incorrect password.");
  });

  it("maps invalid ops OTP to verification copy instead of sign-in copy", () => {
    const err = new ApiError("INVALID_CREDENTIALS", "Invalid OTP code", 401, {
      hintKey: "ops_otp_invalid",
      attemptsRemaining: 2,
    });
    expect(getApiErrorMessageWithHint(err)).toContain("verification code is incorrect");
    expect(getApiErrorMessageWithHint(err)).toContain("2 attempts");
  });

  it("does not treat invalid ops OTP as session auth failure", () => {
    const err = new ApiError("INVALID_CREDENTIALS", "Invalid OTP code", 401, {
      hintKey: "ops_otp_invalid",
      attemptsRemaining: 2,
    });
    expect(isOpsSessionAuthFailure(err)).toBe(false);
    expect(isOpsOtpVerificationError(err)).toBe(true);
  });

  it("treats missing ops session as auth failure", () => {
    const err = new ApiError("UNAUTHORISED", "Ops authentication required", 401);
    expect(isOpsSessionAuthFailure(err)).toBe(true);
    expect(isOpsOtpVerificationError(err)).toBe(false);
  });

  it("does not force login on invalid OTP credentials", () => {
    const err = new ApiError("INVALID_CREDENTIALS", "Invalid or expired OTP", 401, {
      hintKey: "otp_invalid",
    });
    expect(shouldForceLogin(err)).toBe(false);
  });

  it("forces login on missing session", () => {
    const err = new ApiError("UNAUTHORISED", "Ops authentication required", 401);
    expect(shouldForceLogin(err)).toBe(true);
  });

  it("maps ops login OTP errors to login-specific copy", () => {
    const err = new ApiError("INVALID_CREDENTIALS", "Invalid or expired login OTP", 401, {
      hintKey: "ops_login_otp_invalid",
      attemptsRemaining: 1,
    });
    expect(getOpsLoginErrorMessage(err)).toContain("login code");
  });

  it("maps legacy invalid OTP UNAUTHORISED to verification copy", () => {
    const err = new ApiError("UNAUTHORISED", "Invalid OTP code", 401);
    expect(getApiErrorMessageWithHint(err)).toContain("verification code is incorrect");
    expect(getApiErrorMessageWithHint(err)).not.toContain("sign in to continue");
  });

  it("prefers specific backend message for CONFLICT in getApiErrorMessageWithHint", () => {
    const err = new ApiError(
      "CONFLICT",
      "Email belongs to a deactivated merchant admin. Use a merchant admin invite (below) to restore access.",
      409,
    );
    expect(getApiErrorMessageWithHint(err)).toContain("merchant admin invite");
  });
});
