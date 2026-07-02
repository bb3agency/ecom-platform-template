"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { useAuthStore } from "@/stores/auth";
import {
  buildUserFromAccessToken,
  resetAuthSessionRestoreCache,
  restoreAuthSessionFromCookie,
  type AuthSessionRestoreResult,
} from "@/lib/restore-auth-session";
import { isAccessTokenUsable } from "@/lib/jwt-utils";
import { redirectToAdminLoginIfNeeded } from "@/lib/admin-auth-navigation";
import { mergeGuestCartAfterAuth } from "@/lib/post-auth-cart-merge";
import type { User } from "@/types/user";

export type AuthSessionRestoreStatus =
  | "checking"
  | "restoring"
  | "ready"
  | "failed";

/** `admin-guest` = /admin/login (must not share blocked/promise with protected `/admin`). */
export type AuthSessionRestoreAudience = "admin" | "admin-guest" | "customer";

interface UseAuthSessionRestoreOptions {
  /** Return true when the restored user may access this surface. */
  validateUser: (user: User) => boolean;
  /** Isolates admin vs customer restore blocked/in-progress flags. */
  audience?: AuthSessionRestoreAudience;
  /** Hard-redirect to /admin/login when admin restore fails (off on guest sign-in pages). */
  redirectOnFailure?: boolean;
}

interface UseAuthSessionRestoreResult {
  status: AuthSessionRestoreStatus;
  accessToken: string | null;
  user: User | null;
}

function hasValidSession(
  accessToken: string | null,
  user: User | null,
  validateUser: (user: User) => boolean,
): boolean {
  if (!accessToken || !isAccessTokenUsable(accessToken)) {
    return false;
  }
  if (user && validateUser(user)) {
    return true;
  }
  const fromToken = buildUserFromAccessToken(accessToken);
  return Boolean(fromToken && validateUser(fromToken));
}

type RestorePhase = "idle" | "restoring" | "failed";

type RestoreRuntime = {
  blocked: boolean;
  restorePromise: Promise<AuthSessionRestoreResult> | null;
};

// Deadline for the whole cookie-restore round-trip (refresh + optional profile fetch). Generous
// enough to cover slow mobile networks: an 8s cap spuriously logged out valid sessions on 3G/weak
// links (the request eventually succeeds, but the race already resolved "unauthorised") — the exact
// "works on desktop, drops on mobile" report. A genuinely offline/dead request fails fast on its
// own, so this only bites slow-but-working connections, where waiting is far better than logging out.
const RESTORE_DEADLINE_MS = 15_000;

/** Bumped on reset so in-flight restore promises cannot clear a fresh login session. */
let restoreGeneration = 0;

const restoreRuntimeByAudience: Record<
  AuthSessionRestoreAudience,
  RestoreRuntime
> = {
  admin: { blocked: false, restorePromise: null },
  "admin-guest": { blocked: false, restorePromise: null },
  customer: { blocked: false, restorePromise: null },
};

function getRuntime(audience: AuthSessionRestoreAudience): RestoreRuntime {
  return restoreRuntimeByAudience[audience];
}

function runRestoreWithDeadline(
  audience: AuthSessionRestoreAudience,
): Promise<AuthSessionRestoreResult> {
  const restore = () =>
    restoreAuthSessionFromCookie({
      hydrateProfile: audience !== "admin" && audience !== "admin-guest",
    });

  return Promise.race([
    restore(),
    new Promise<AuthSessionRestoreResult>((resolve) => {
      setTimeout(() => {
        resetAuthSessionRestoreCache();
        // "timeout" (not "unauthorised"): the request may still be valid, just slow. The handler
        // treats this as a soft, RETRYABLE failure — it does not permanently block restore, so a
        // remount / navigation / nonce bump can try again instead of stranding a valid session.
        resolve({ ok: false, reason: "timeout" });
      }, RESTORE_DEADLINE_MS);
    }),
  ]);
}

function getOrStartRestore(
  audience: AuthSessionRestoreAudience,
): Promise<AuthSessionRestoreResult> {
  const runtime = getRuntime(audience);
  if (!runtime.restorePromise) {
    runtime.restorePromise = runRestoreWithDeadline(audience).finally(() => {
      runtime.restorePromise = null;
    });
  }
  return runtime.restorePromise;
}

export function resetAuthSessionRestoreState(
  audience?: AuthSessionRestoreAudience,
): void {
  restoreGeneration += 1;
  resetAuthSessionRestoreCache();
  const resetRuntime = (key: AuthSessionRestoreAudience) => {
    restoreRuntimeByAudience[key] = { blocked: false, restorePromise: null };
  };
  if (audience) {
    resetRuntime(audience);
    return;
  }
  for (const key of Object.keys(
    restoreRuntimeByAudience,
  ) as AuthSessionRestoreAudience[]) {
    resetRuntime(key);
  }
}

export function useAuthSessionRestore(
  options: UseAuthSessionRestoreOptions,
): UseAuthSessionRestoreResult {
  const {
    validateUser,
    audience = "customer",
    redirectOnFailure = true,
  } = options;
  const accessToken = useAuthStore((s) => s.accessToken);
  const user = useAuthStore((s) => s.user);
  const sessionRestoreNonce = useAuthStore((s) => s.sessionRestoreNonce);
  const setSession = useAuthStore((s) => s.setSession);
  const clearSession = useAuthStore((s) => s.clearSession);
  const sessionValid = hasValidSession(accessToken, user, validateUser);

  const [restorePhase, setRestorePhase] = useState<RestorePhase>("restoring");
  const lastRestoreNonceRef = useRef(sessionRestoreNonce);

  const status: AuthSessionRestoreStatus = sessionValid
    ? "ready"
    : restorePhase === "restoring"
      ? "restoring"
      : restorePhase === "failed"
        ? "failed"
        : "checking";

  useLayoutEffect(() => {
    const runtime = getRuntime(audience);

    if (lastRestoreNonceRef.current !== sessionRestoreNonce) {
      lastRestoreNonceRef.current = sessionRestoreNonce;
      runtime.blocked = false;
      runtime.restorePromise = null;
    }

    if (sessionValid) {
      runtime.blocked = false;
      setRestorePhase("idle");
      if (accessToken && (!user || !validateUser(user))) {
        const fromToken = buildUserFromAccessToken(accessToken);
        if (fromToken && validateUser(fromToken)) {
          setSession(accessToken, fromToken);
        }
      }
      return;
    }

    if (runtime.blocked) {
      setRestorePhase("failed");
      return;
    }

    setRestorePhase("restoring");

    const generationAtStart = restoreGeneration;

    void getOrStartRestore(audience).then((result) => {
      if (generationAtStart !== restoreGeneration) {
        setRestorePhase((phase) => (phase === "restoring" ? "failed" : phase));
        return;
      }

      if (result.ok && validateUser(result.user)) {
        runtime.blocked = false;
        setSession(result.accessToken, result.user);
        if (audience === "customer") {
          void mergeGuestCartAfterAuth(result.accessToken);
        }
        setRestorePhase("idle");
        return;
      }

      // A slow-network TIMEOUT is a soft failure: leave `blocked` false so a later trigger retries,
      // and do not clear a (possibly still valid) session. Only a definitive auth failure
      // (unauthorised / invalid_token) permanently blocks + clears.
      const isTimeout = !result.ok && result.reason === "timeout";
      if (isTimeout) {
        runtime.blocked = false;
        setRestorePhase("failed");
        if (audience === "admin" && redirectOnFailure) {
          redirectToAdminLoginIfNeeded();
        }
        return;
      }

      runtime.blocked = true;
      clearSession();
      setRestorePhase("failed");
      if (audience === "admin" && redirectOnFailure) {
        redirectToAdminLoginIfNeeded();
      }
    });
  }, [
    sessionValid,
    accessToken,
    user,
    sessionRestoreNonce,
    setSession,
    clearSession,
    validateUser,
    audience,
    redirectOnFailure,
  ]);

  return { status, accessToken, user };
}
