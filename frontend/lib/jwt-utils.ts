export interface AccessTokenClaims {
  sub?: string;
  role?: string;
  permissions?: string[];
  exp?: number;
}

export function parseAccessTokenClaims(token: string): AccessTokenClaims | null {
  const parts = token.split(".");
  if (parts.length < 2) {
    return null;
  }

  try {
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = payload.padEnd(payload.length + ((4 - (payload.length % 4)) % 4), "=");
    return JSON.parse(atob(padded)) as AccessTokenClaims;
  } catch {
    return null;
  }
}

export function getAccessTokenExpiryMs(token: string): number | null {
  const claims = parseAccessTokenClaims(token);
  if (typeof claims?.exp !== "number") {
    return null;
  }
  return claims.exp * 1000;
}

/** True when the JWT is not expired (small clock skew for refresh timing). */
export function isAccessTokenUsable(
  token: string,
  nowMs: number = Date.now(),
): boolean {
  const expMs = getAccessTokenExpiryMs(token);
  if (expMs === null) {
    return false;
  }
  return expMs > nowMs + 5_000;
}
