import { afterEach, describe, expect, it, vi } from "vitest";
import { getAuthDevOtpHint, isAuthDevBypassUiEnabled } from "@/lib/dev-auth";

describe("dev-auth UI helpers", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is disabled in production builds even when public flag is set", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_AUTH_DEV_BYPASS", "true");
    vi.stubEnv("NEXT_PUBLIC_AUTH_DEV_OTP", "424242");

    expect(isAuthDevBypassUiEnabled()).toBe(false);
    expect(getAuthDevOtpHint()).toBe("000000");
  });

  it("is enabled only in development with explicit public flag", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_AUTH_DEV_BYPASS", "true");
    vi.stubEnv("NEXT_PUBLIC_AUTH_DEV_OTP", "424242");

    expect(isAuthDevBypassUiEnabled()).toBe(true);
    expect(getAuthDevOtpHint()).toBe("424242");
  });

  it("uses default OTP hint when NEXT_PUBLIC_AUTH_DEV_OTP is unset", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_AUTH_DEV_BYPASS", "true");
    vi.stubEnv("NEXT_PUBLIC_AUTH_DEV_OTP", "");

    expect(getAuthDevOtpHint()).toBe("000000");
  });
});
