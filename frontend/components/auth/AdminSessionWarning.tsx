"use client";

import { useEffect, useState, useCallback } from "react";
import { redirectToAdminLogin } from "@/lib/admin-auth-navigation";
import { getAccessTokenExpiryMs, parseAccessTokenClaims } from "@/lib/jwt-utils";
import { useAuthStore } from "@/stores/auth";
import { refreshAccessTokenOnce } from "@/lib/restore-auth-session";
import { Loader2 } from "lucide-react";

const WARNING_LEAD_MS = 2 * 60 * 1000;

export function AdminSessionWarning() {
  const accessToken = useAuthStore((state) => state.accessToken);
  const setAccessToken = useAuthStore((state) => state.setAccessToken);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [extending, setExtending] = useState(false);
  const [extendError, setExtendError] = useState<string | null>(null);

  const expiryMs = accessToken ? getAccessTokenExpiryMs(accessToken) : null;

  useEffect(() => {
    if (!accessToken || !expiryMs) {
      return;
    }

    const warnAt = expiryMs - WARNING_LEAD_MS;
    const scheduleRefresh = (targetMs: number) => {
      const delay = Math.max(0, targetMs - Date.now());
      return window.setTimeout(() => setNowMs(Date.now()), delay);
    };

    const warnTimer = scheduleRefresh(warnAt);
    const expiryTimer = scheduleRefresh(expiryMs);

    return () => {
      window.clearTimeout(warnTimer);
      window.clearTimeout(expiryTimer);
    };
  }, [accessToken, expiryMs]);

  const handleExtend = useCallback(async () => {
    setExtending(true);
    setExtendError(null);
    try {
      // Single-flight: routes through the shared refresh guard so a burst of
      // parallel 401 retries + this "Extend" click cannot consume-race the
      // single-use refresh cookie into a mid-session logout.
      const refreshed = await refreshAccessTokenOnce();
      const claims = parseAccessTokenClaims(refreshed.accessToken);
      if (claims?.role === "ADMIN") {
        setAccessToken(refreshed.accessToken);
        setNowMs(Date.now());
      } else {
        setExtendError("Session is no longer valid for admin access.");
      }
    } catch {
      setExtendError("Could not extend session. Please sign in again.");
    } finally {
      setExtending(false);
    }
  }, [setAccessToken]);

  const handleSignInAgain = useCallback(() => {
    useAuthStore.getState().logoutLocalSession();
    redirectToAdminLogin();
  }, []);

  const visible =
    expiryMs !== null && nowMs >= expiryMs - WARNING_LEAD_MS && nowMs < expiryMs;

  if (!visible) {
    return null;
  }

  return (
    <div
      className="mb-6 rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm"
      role="status"
      aria-live="polite"
    >
      <p className="font-medium text-foreground">Admin session expiring soon</p>
      <p className="mt-1 text-muted-foreground">
        Your access token expires in about two minutes. Extend your session or sign in again.
      </p>
      {extendError ? (
        <p className="mt-2 text-xs text-red-600">{extendError}</p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={extending}
          className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-60"
          onClick={() => void handleExtend()}
        >
          {extending ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Extending…
            </>
          ) : (
            "Extend session"
          )}
        </button>
        <button
          type="button"
          className="h-9 rounded-md border border-border px-3 text-xs font-medium"
          onClick={handleSignInAgain}
        >
          Sign in again
        </button>
      </div>
    </div>
  );
}
