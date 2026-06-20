import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/error-messages";

describe("getApiErrorMessage — Turnstile challenge", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("explains missing site key when API requires a challenge token", () => {
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "");
    const error = new ApiError(
      "VALIDATION_ERROR",
      "Challenge token is required",
      400,
    );
    const message = getApiErrorMessage(error);
    expect(message).toContain("NEXT_PUBLIC_TURNSTILE_SITE_KEY");
  });

  it("prompts user to complete widget when site key is configured", () => {
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "0x4AAAAAA_test");
    const error = new ApiError(
      "VALIDATION_ERROR",
      "Challenge token is required",
      400,
    );
    expect(getApiErrorMessage(error)).toContain("security check");
  });
});
