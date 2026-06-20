"use client";

import { useEffect, useRef, useCallback } from "react";

const ACTIVITY_EVENTS = [
  "mousedown",
  "mousemove",
  "keydown",
  "touchstart",
  "wheel",
  "scroll",
  "click",
] as const;

interface UseIdleTimeoutOptions {
  /** Time in ms before idle warning is shown (default: 25 min) */
  warningAfterMs?: number;
  /** Time in ms of total idle before auto-logout after warning (default: 5 min) */
  logoutAfterWarningMs?: number;
  /** Called when idle warning should be shown */
  onWarning?: () => void;
  /** Called when user becomes active while warning is shown */
  onActive?: () => void;
  /** Called when auto-logout triggers */
  onLogout?: () => void;
  /** Disabled when false */
  enabled?: boolean;
}

export function useIdleTimeout({
  warningAfterMs = 25 * 60 * 1000,
  logoutAfterWarningMs = 5 * 60 * 1000,
  onWarning,
  onActive,
  onLogout,
  enabled = true,
}: UseIdleTimeoutOptions) {
  const lastActivityRef = useRef(0);
  const warningShownRef = useRef(false);
  const timersRef = useRef<{ warning?: number; logout?: number }>({});

  const clearTimers = useCallback(() => {
    if (timersRef.current.warning) {
      window.clearTimeout(timersRef.current.warning);
      timersRef.current.warning = undefined;
    }
    if (timersRef.current.logout) {
      window.clearTimeout(timersRef.current.logout);
      timersRef.current.logout = undefined;
    }
  }, []);

  const schedule = useCallback(() => {
    clearTimers();
    if (!enabled) return;

    const now = Date.now();
    const idleSoFar = now - lastActivityRef.current;
    const warningDelay = Math.max(0, warningAfterMs - idleSoFar);

    timersRef.current.warning = window.setTimeout(() => {
      warningShownRef.current = true;
      onWarning?.();

      timersRef.current.logout = window.setTimeout(() => {
        warningShownRef.current = false;
        onLogout?.();
      }, logoutAfterWarningMs);
    }, warningDelay);
  }, [enabled, warningAfterMs, logoutAfterWarningMs, onWarning, onLogout, clearTimers]);

  const reset = useCallback(() => {
    lastActivityRef.current = Date.now();

    if (warningShownRef.current) {
      warningShownRef.current = false;
      onActive?.();
    }

    schedule();
  }, [onActive, schedule]);

  useEffect(() => {
    if (!enabled) {
      clearTimers();
      return;
    }

    lastActivityRef.current = Date.now();

    const handleActivity = () => reset();

    ACTIVITY_EVENTS.forEach((event) => {
      document.addEventListener(event, handleActivity, { passive: true });
    });

    schedule();

    return () => {
      ACTIVITY_EVENTS.forEach((event) => {
        document.removeEventListener(event, handleActivity);
      });
      clearTimers();
    };
  }, [enabled, reset, schedule, clearTimers]);
}
