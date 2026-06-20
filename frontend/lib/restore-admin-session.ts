import { isAdminUser } from "@/lib/permissions";
import type { User } from "@/types/user";
import {
  buildUserFromAccessToken,
  restoreAuthSessionFromCookie,
  resetAuthSessionRestoreCache,
} from "@/lib/restore-auth-session";

export type AdminSessionRestoreResult =
  | { ok: true; accessToken: string; user: User }
  | { ok: false; reason: "unauthorised" | "not_admin" };

export { buildUserFromAccessToken };

/**
 * Restores merchant admin session from the httpOnly refresh_token cookie.
 * Shares the same deduped refresh call as customer session restore.
 */
export async function restoreAdminSessionFromCookie(): Promise<AdminSessionRestoreResult> {
  const result = await restoreAuthSessionFromCookie();
  if (!result.ok) {
    return {
      ok: false,
      reason: result.reason === "invalid_token" ? "unauthorised" : "unauthorised",
    };
  }
  if (!isAdminUser(result.user)) {
    return { ok: false, reason: "not_admin" };
  }
  return result;
}

/** @deprecated Use resetAuthSessionRestoreCache */
export function resetAdminSessionRestoreCache(): void {
  resetAuthSessionRestoreCache();
}
