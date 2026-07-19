import { refreshAccessToken } from "@/lib/auth-api";
import { getCurrentUser } from "@/lib/users-api";
import { parseAccessTokenClaims } from "@/lib/jwt-utils";
import type { User } from "@/types/user";

export type AuthSessionRestoreResult =
  | { ok: true; accessToken: string; user: User }
  | { ok: false; reason: "unauthorised" | "invalid_token" | "timeout" };

/**
 * Builds a minimal user from the JWT claims when the API is not yet reachable.
 * Profile fields (name, email, phone) are null — callers should hydrate from
 * GET /users/me whenever possible.
 */
export function buildUserFromAccessToken(accessToken: string): User | null {
  const claims = parseAccessTokenClaims(accessToken);
  if (!claims?.sub) {
    return null;
  }

  return {
    id: claims.sub,
    email: null,
    phone: null,
    firstName: null,
    lastName: null,
    isVerified: true,
    role: claims.role ?? undefined,
    permissions: claims.permissions ?? [],
  };
}

let refreshInFlight: Promise<{ accessToken: string }> | null = null;

/** Brief cache so React Strict Mode remount does not rotate the refresh token twice. */
let recentRefresh: { accessToken: string; expiresAt: number } | null = null;

const REFRESH_RESULT_CACHE_MS = 3_000;

/**
 * Single-flight token refresh — ALL refresh callers (session restore AND the
 * authenticated API client's 401 retry) must funnel through this. Refresh tokens
 * are single-use + rotated: two concurrent raw `refreshAccessToken()` calls send
 * the SAME cookie, the first rotates it, and the second gets "already consumed"
 * → hard logout. That was the "randomly logged out mid-session on desktop" bug
 * (admin pages burst parallel GETs that all 401 together when the access token
 * expires). The in-flight promise + 3s result cache collapse those into one
 * network refresh.
 */
export function refreshAccessTokenOnce(): Promise<{ accessToken: string }> {
  const now = Date.now();
  if (recentRefresh && recentRefresh.expiresAt > now) {
    return Promise.resolve({ accessToken: recentRefresh.accessToken });
  }

  if (!refreshInFlight) {
    refreshInFlight = refreshAccessToken()
      .then((response) => {
        recentRefresh = {
          accessToken: response.accessToken,
          expiresAt: Date.now() + REFRESH_RESULT_CACHE_MS,
        };
        return response;
      })
      .finally(() => {
        refreshInFlight = null;
      });
  }

  return refreshInFlight;
}

/**
 * Restores an authenticated session from the httpOnly refresh_token cookie.
 *
 * After a successful token refresh, this fetches the full user profile from
 * GET /users/me so the restored User has real name/email/phone (not null stubs).
 * Single in-flight refresh prevents double-consumption in React Strict Mode.
 */
export interface RestoreAuthSessionOptions {
  /**
   * When false, uses JWT claims only (faster; avoids blocking admin shell on GET /users/me).
   * Admin console only needs role/permissions from the access token.
   */
  hydrateProfile?: boolean;
}

export async function restoreAuthSessionFromCookie(
  options: RestoreAuthSessionOptions = {},
): Promise<AuthSessionRestoreResult> {
  const hydrateProfile = options.hydrateProfile ?? true;

  try {
    const refreshed = await refreshAccessTokenOnce();
    const minimal = buildUserFromAccessToken(refreshed.accessToken);
    if (!minimal) {
      return { ok: false, reason: "invalid_token" };
    }

    let user: User = minimal;
    if (hydrateProfile) {
      try {
        user = await getCurrentUser(refreshed.accessToken);
      } catch {
        // Use sparse user — profile will be hydrated on next navigation or component mount.
      }
    }

    return { ok: true, accessToken: refreshed.accessToken, user };
  } catch {
    return { ok: false, reason: "unauthorised" };
  }
}

/** Clears the in-flight refresh cache (e.g. on logout). */
export function resetAuthSessionRestoreCache(): void {
  refreshInFlight = null;
  recentRefresh = null;
}
