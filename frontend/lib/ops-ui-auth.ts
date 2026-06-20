import { headers } from "next/headers";
import type { NextRequest } from "next/server";

export function isProductionLikeRuntime(): boolean {
  return process.env.NODE_ENV === "production";
}

export function parseBasicAuthHeader(
  authorizationHeader: string | null,
): { username: string; password: string } | null {
  if (!authorizationHeader || !authorizationHeader.startsWith("Basic ")) {
    return null;
  }

  const encoded = authorizationHeader.slice(6).trim();
  if (!encoded) {
    return null;
  }

  try {
    const decoded = atob(encoded);
    const separatorIndex = decoded.indexOf(":");
    if (separatorIndex < 0) {
      return null;
    }

    return {
      username: decoded.slice(0, separatorIndex),
      password: decoded.slice(separatorIndex + 1),
    };
  } catch {
    return null;
  }
}

function getOpsUiBasicAuthCredentials(): { username: string; password: string } | null {
  const username = process.env.OPS_UI_BASIC_AUTH_USERNAME?.trim();
  const password = process.env.OPS_UI_BASIC_AUTH_PASSWORD?.trim();
  if (!username || !password) {
    return null;
  }
  return { username, password };
}

export function isOpsUiBasicAuthConfigured(): boolean {
  return getOpsUiBasicAuthCredentials() !== null;
}

export function verifyOpsUiBasicAuth(
  authorizationHeader: string | null,
): boolean {
  const expected = getOpsUiBasicAuthCredentials();
  if (!expected) {
    return false;
  }
  const { username, password } = expected;

  const credentials = parseBasicAuthHeader(authorizationHeader);
  if (!credentials) {
    return false;
  }

  return (
    credentials.username === username &&
    credentials.password === password
  );
}

export function assertOpsUiAccessFromRequest(request: NextRequest): void {
  if (isProductionLikeRuntime() && !isOpsUiBasicAuthConfigured()) {
    throw new Error(
      "Ops UI is disabled until OPS_UI_BASIC_AUTH_USERNAME and OPS_UI_BASIC_AUTH_PASSWORD are configured.",
    );
  }

  if (!isOpsUiBasicAuthConfigured()) {
    return;
  }

  if (!verifyOpsUiBasicAuth(request.headers.get("authorization"))) {
    throw new Error("Ops UI authentication required.");
  }
}

export async function assertOpsUiAccessFromServerAction(): Promise<void> {
  if (isProductionLikeRuntime() && !isOpsUiBasicAuthConfigured()) {
    throw new Error(
      "Ops UI is disabled until OPS_UI_BASIC_AUTH_USERNAME and OPS_UI_BASIC_AUTH_PASSWORD are configured.",
    );
  }

  if (!isOpsUiBasicAuthConfigured()) {
    return;
  }

  const headerStore = await headers();
  const authorization = headerStore.get("authorization");

  if (!verifyOpsUiBasicAuth(authorization)) {
    throw new Error("Ops UI authentication required.");
  }
}
