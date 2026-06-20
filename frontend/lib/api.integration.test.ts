import { describe, expect, it } from "vitest";
import { apiClient, ApiError } from "@/lib/api";
import { isBackendHealthy } from "@/lib/test/backend-health";
import type { HealthStatus } from "@/types/api";

const backendHealthy = await isBackendHealthy();

describe.skipIf(!backendHealthy)("API client integration (live backend)", () => {

  it("parses health response", async () => {
    const health = await apiClient<HealthStatus>("/health");
    expect(health.status).toBe("ok");
    expect(health.db ?? health.database).toBe("connected");
    expect(health.redis).toBe("connected");
  });

  it("parses product list payload", async () => {
    const result = await apiClient<{ items?: unknown[] } | unknown[]>(
      "/products?page=1&limit=4",
    );
    if (Array.isArray(result)) {
      expect(Array.isArray(result)).toBe(true);
      return;
    }
    expect(Array.isArray(result.items)).toBe(true);
  });

  it("branches errors by code", async () => {
    try {
      await apiClient("/orders/not-a-real-id", {
        accessToken: "invalid-token-for-test",
      });
      expect.fail("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      if (error instanceof ApiError) {
        expect(error.code).toBeTruthy();
      }
    }
  });
});
