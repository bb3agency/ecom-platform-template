"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuthStore } from "@/stores/auth";
import { redirectToAdminLogin } from "@/lib/admin-auth-navigation";
import { logoutSession, refreshAccessToken } from "@/lib/auth-api";
import { parseAccessTokenClaims } from "@/lib/jwt-utils";
import { LogOut, RefreshCw, Timer } from "lucide-react";
import { useIdleTimeout } from "@/hooks/use-idle-timeout";

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
      const refreshed = await refreshAccessToken();
      const claims = parseAccessTokenClaims(refreshed.accessToken);
      if (claims?.role === "ADMIN") {
        setAccessToken(refreshed.accessToken);
        setVisible(false);
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

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-[#23403d]/60 backdrop-blur-sm"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="idle-title"
      aria-describedby="idle-desc"
    >
      <div className="mx-4 w-full max-w-sm rounded-xl border border-[#efe8e4] bg-white p-6 shadow-2xl">
        <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-amber-100">
          <Timer className="h-5 w-5 text-amber-600" />
        </div>

        <h2
          id="idle-title"
          className="font-heading text-lg font-semibold text-[#23403d]"
        >
          Session timeout warning
        </h2>
        <p id="idle-desc" className="mt-2 text-sm text-[#769b97]">
          You have been inactive for a while. Your admin session will expire
          automatically in{" "}
          <span className="font-semibold text-[#ec6e55]">{timeLabel}</span>.
        </p>

        <div className="mt-6 flex flex-col gap-2">
          <button
            type="button"
            disabled={extending}
            onClick={() => void handleExtend()}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#23403d] px-4 text-sm font-medium text-white transition-colors hover:bg-[#1a3330] disabled:opacity-60"
          >
            <RefreshCw
              className={`h-4 w-4 ${extending ? "animate-spin" : ""}`}
            />
            {extending ? "Extending…" : "Stay signed in"}
          </button>
          <button
            type="button"
            onClick={handleLogout}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-[#efe8e4] px-4 text-sm font-medium text-[#23403d] transition-colors hover:bg-[#faf3ef]"
          >
            <LogOut className="h-4 w-4" />
            Sign out now
          </button>
        </div>
      </div>
    </div>
  );
}
