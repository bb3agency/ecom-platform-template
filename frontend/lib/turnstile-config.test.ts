import { afterEach, describe, expect, it, vi } from "vitest";
import { getTurnstileSiteKey, isTurnstileConfigured } from "@/lib/turnstile-config";

describe("turnstile-config", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns null when site key is unset", () => {
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "");
    expect(getTurnstileSiteKey()).toBeNull();
    expect(isTurnstileConfigured()).toBe(false);
  });

  it("returns trimmed site key when configured", () => {
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "  0x4AAAAAA_site_key  ");
    expect(getTurnstileSiteKey()).toBe("0x4AAAAAA_site_key");
  });

  it("does not enable UI during next dev unless enforce flag is set", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "0x4AAAAAA_site_key");
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_ENFORCE_IN_DEV", "");
    expect(isTurnstileConfigured()).toBe(false);
  });

  it("enables UI in next dev when enforce flag and site key are set", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "0x4AAAAAA_site_key");
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_ENFORCE_IN_DEV", "true");
    expect(isTurnstileConfigured()).toBe(true);
  });

  it("enables UI in production builds when site key is set", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "0x4AAAAAA_site_key");
    expect(isTurnstileConfigured()).toBe(true);
  });
});
