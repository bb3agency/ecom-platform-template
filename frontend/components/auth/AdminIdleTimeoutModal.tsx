"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuthStore } from "@/stores/auth";
import { redirectToAdminLogin } from "@/lib/admin-auth-navigation";
import { logoutSession } from "@/lib/auth-api";
import { refreshAccessTokenOnce } from "@/lib/restore-auth-session";
import { parseAccessTokenClaims } from "@/lib/jwt-utils";
import { LogOut, RefreshCw, Timer } from "lucide-react";
import { useIdleTimeout } from "@/hooks/use-idle-timeout";
import { useToastStore } from "@/stores/toast";

const WARNING_AFTER_MS = 25 * 60 * 1000; // 25 minutes
const LOGOUT_AFTER_WARNING_MS = 5 * 60 * 1000; // 5 minutes
const LOGOUT_COUNTDOWN_SEC = Math.ceil(LOGOUT_AFTER_WARNING_MS / 1000);

export function AdminIdleTimeoutModal() {
  const accessToken = useAuthStore((s) => s.accessToken);
  const setAccessToken = useAuthStore((s) => s.setAccessToken);
  const [visible, setVisible] = useState(false);
  const [remainingSec, setRemainingSec] = useState(LOGOUT_COUNTDOWN_SEC);
  const [extending, setExtending] = useState(false);

  const showWarning = useCallback(() => {
    setRemainingSec(LOGOUT_COUNTDOWN_SEC);
    setVisible(true);
  }, []);
  const hideWarning = useCallback(() => setVisible(false), []);

  const handleLogout = useCallback(() => {
    void (async () => {
      try {
        await logoutSession(accessToken);
      } finally {
        useAuthStore.getState().logoutLocalSession();
        redirectToAdminLogin();
      }
    })();
    setVisible(false);
  }, [accessToken]);

  const handleExtend = useCallback(async () => {
    setExtending(true);
    try {
      // Single-flight refresh guard (see refreshAccessTokenOnce) — avoids the
      // single-use-cookie consume race that logs the admin out mid-session.
      const refreshed = await refreshAccessTokenOnce();
      const claims = parseAccessTokenClaims(refreshed.accessToken);
      if (claims?.role === "ADMIN") {
        setAccessToken(refreshed.accessToken);
        setVisible(false);
        useToastStore.getState().push({ variant: "success", message: "Session extended." });
      } else {
        handleLogout();
      }
    } catch {
      handleLogout();
    } finally {
      setExtending(false);
    }
  }, [setAccessToken, handleLogout]);

  useIdleTimeout({
    warningAfterMs: WARNING_AFTER_MS,
    logoutAfterWarningMs: LOGOUT_AFTER_WARNING_MS,
    onWarning: showWarning,
    onActive: hideWarning,
    onLogout: handleLogout,
    enabled: !!accessToken,
  });

  // Countdown timer while warning is visible
  useEffect(() => {
    if (!visible) return;

    const interval = window.setInterval(() => {
      setRemainingSec((prev) => {
        if (prev <= 1) {
          window.clearInterval(interval);
          handleLogout();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => window.clearInterval(interval);
  }, [visible, handleLogout]);

  if (!visible) return null;

  const minutes = Math.floor(remainingSec / 60);
  const seconds = remainingSec % 60;
  const timeLabel = `${minutes}:${seconds.toString().padStart(2, "0")}`;
  const progressPct = Math.max(0, Math.min(100, (remainingSec / LOGOUT_COUNTDOWN_SEC) * 100));

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-[2px] animate-in fade-in-0 duration-200"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="idle-title"
      aria-describedby="idle-desc"
    >
      <div className="mx-4 w-full max-w-sm rounded-xl border border-border bg-card p-6 text-center shadow-lg animate-in fade-in-0 slide-in-from-bottom-2 duration-200">
        <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-full bg-amber-500/10">
          <Timer className="size-6 text-amber-600" />
        </div>

        <h2 id="idle-title" className="font-heading text-lg font-semibold text-foreground">
          Session Expiring Soon
        </h2>
        <p id="idle-desc" className="mt-2 text-sm text-muted-foreground">
          Your session will expire in{" "}
          <span className="font-semibold tabular-nums text-foreground">{timeLabel}</span> due to
          inactivity. You will be signed out automatically.
        </p>

        {/* Countdown progress bar. */}
        <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-amber-500 transition-[width] duration-1000 ease-linear"
            style={{ width: `${progressPct}%` }}
          />
        </div>

        <div className="mt-6 flex items-center justify-center gap-2">
          <button
            type="button"
            disabled={extending}
            onClick={() => void handleExtend()}
            className="inline-flex h-10 min-w-32 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
          >
            <RefreshCw className={`size-4 ${extending ? "animate-spin" : ""}`} />
            {extending ? "Extending…" : "Stay Signed In"}
          </button>
          <button
            type="button"
            onClick={handleLogout}
            className="inline-flex h-10 min-w-32 items-center justify-center gap-2 rounded-lg border border-border px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted"
          >
            <LogOut className="size-4" />
            Sign Out Now
          </button>
        </div>
      </div>
    </div>
  );
}
