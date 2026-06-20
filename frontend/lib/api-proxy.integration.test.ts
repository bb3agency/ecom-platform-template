import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import { getConfiguredPublicApiBaseUrl } from "@/lib/api-base";
import { refreshAccessToken } from "@/lib/auth-api";

const storefrontApiBase = getConfiguredPublicApiBaseUrl();
const isStorefrontProxyTarget =
  storefrontApiBase.includes(":3101") || storefrontApiBase.startsWith("/api/v1");

async function isNextDevProxyReachable(): Promise<boolean> {
  try {
    const response = await fetch(`${storefrontApiBase.replace(/\/$/, "")}/health`, {
      signal: AbortSignal.timeout(4000),
    });
    const body = (await response.json()) as { success?: boolean; data?: { status?: string } };
    return response.ok && body.data?.status === "ok";
  } catch {
    return false;
  }
}

const proxyReachable = isStorefrontProxyTarget && (await isNextDevProxyReachable());

describe.skipIf(!proxyReachable)(
  "Next.js /api/v1 rewrite (live dev server on storefront origin)",
  () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("proxies health through storefront origin", async () => {
      const response = await fetch(`${storefrontApiBase.replace(/\/$/, "")}/health`);
      expect(response.ok).toBe(true);
      const body = (await response.json()) as { data?: { database?: string; redis?: string } };
      expect(body.data?.database).toBe("connected");
      expect(body.data?.redis).toBe("connected");
    });

    it("proxies refresh for apiClient (same-origin cookie auth path)", async () => {
      vi.stubGlobal("window", {
        location: { href: "http://localhost:3101/admin" },
      } as Window & typeof globalThis);

      try {
        await refreshAccessToken();
        expect.fail("Expected refresh to fail without cookie");
      } catch (error) {
        expect(
          error instanceof ApiError || error instanceof TypeError,
        ).toBe(true);
        if (error instanceof ApiError) {
          expect(error.status).toBeGreaterThanOrEqual(400);
          expect(error.code).toBe("UNAUTHORISED");
        }
      }
    });
  },
);
