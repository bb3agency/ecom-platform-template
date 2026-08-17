import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/error-messages";

describe("getApiErrorMessage — Turnstile challenge", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("gives customers a plain message when no site key is configured", () => {
    // Production. Naming our env vars here would tell a shopper nothing actionable
    // and leak deployment detail — the dev-only branch below carries the remedy.
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "");
    vi.stubEnv("NODE_ENV", "production");
    const error = new ApiError(
      "VALIDATION_ERROR",
      "Challenge token is required",
      400,
    );
    const message = getApiErrorMessage(error);
    expect(message).toContain("temporarily unavailable");
    expect(message).not.toContain("TURNSTILE");
  });

  it("explains the remedy to developers in dev builds", () => {
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "");
    vi.stubEnv("NODE_ENV", "development");
    const error = new ApiError(
      "VALIDATION_ERROR",
      "Challenge token is required",
      400,
    );
    expect(getApiErrorMessage(error)).toContain("TURNSTILE_SITE_KEY");
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
