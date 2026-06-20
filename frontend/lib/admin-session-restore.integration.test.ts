import { afterEach, describe, expect, it } from "vitest";
import { getInternalApiBaseUrl } from "@/lib/api-base";
import { restoreAdminSessionFromCookie } from "@/lib/restore-admin-session";
import {
  resetAuthSessionRestoreCache,
  restoreAuthSessionFromCookie,
} from "@/lib/restore-auth-session";
import { isBackendHealthy } from "@/lib/test/backend-health";

const backendHealthy = await isBackendHealthy(getInternalApiBaseUrl());

describe.skipIf(!backendHealthy)("admin session restore (live backend)", () => {
  afterEach(() => {
    resetAuthSessionRestoreCache();
  });

  it("restoreAuthSessionFromCookie returns unauthorised without refresh cookie", async () => {
    const result = await restoreAuthSessionFromCookie();
    expect(result).toEqual({ ok: false, reason: "unauthorised" });
  });

  it("restoreAdminSessionFromCookie returns unauthorised without refresh cookie", async () => {
    const result = await restoreAdminSessionFromCookie();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("unauthorised");
    }
  });

  it("dedupes parallel restore calls against live backend", async () => {
    const [a, b] = await Promise.all([
      restoreAuthSessionFromCookie(),
      restoreAuthSessionFromCookie(),
    ]);
    expect(a).toEqual(b);
    expect(a.ok).toBe(false);
  });
});
