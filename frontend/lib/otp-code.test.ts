import { describe, expect, it } from "vitest";
import { isCompleteOtpCode, normalizeOtpCodeInput } from "@/lib/otp-code";

describe("otp-code", () => {
  it("normalizes spaced OTP input", () => {
    expect(normalizeOtpCodeInput("5 2 1 6 7 6")).toBe("521676");
    expect(isCompleteOtpCode("5 2 1 6 7 6")).toBe(true);
  });
});
