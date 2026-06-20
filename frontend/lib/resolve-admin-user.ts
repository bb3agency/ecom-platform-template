import { buildUserFromAccessToken } from "@/lib/restore-admin-session";
import { isAccessTokenUsable } from "@/lib/jwt-utils";
import { canAccessAdmin } from "@/lib/permissions";
import type { User } from "@/types/user";

/** Admin user from store and/or JWT when access token is still valid. */
export function resolveAdminUser(
  accessToken: string | null,
  user: User | null,
): User | null {
  if (user && canAccessAdmin(user)) {
    return user;
  }
  if (!accessToken || !isAccessTokenUsable(accessToken)) {
    return null;
  }
  const fromToken = buildUserFromAccessToken(accessToken);
  return fromToken && canAccessAdmin(fromToken) ? fromToken : null;
}
