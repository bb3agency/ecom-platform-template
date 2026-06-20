import { describe, expect, it } from "vitest";
import { getAccessTokenExpiryMs, isAccessTokenUsable } from "@/lib/jwt-utils";

function makeJwt(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = btoa(JSON.stringify(payload))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `${header}.${body}.sig`;
}

describe("isAccessTokenUsable", () => {
  const now = 1_700_000_000_000;

  it("returns true before expiry with skew buffer", () => {
    const token = makeJwt({ sub: "u1", exp: Math.floor((now + 60_000) / 1000) });
    expect(isAccessTokenUsable(token, now)).toBe(true);
  });

  it("returns false when expired", () => {
    const token = makeJwt({ sub: "u1", exp: Math.floor((now - 1_000) / 1000) });
    expect(isAccessTokenUsable(token, now)).toBe(false);
  });

  it("returns false when exp claim is missing", () => {
    const token = makeJwt({ sub: "u1" });
    expect(getAccessTokenExpiryMs(token)).toBeNull();
    expect(isAccessTokenUsable(token, now)).toBe(false);
  });
});
