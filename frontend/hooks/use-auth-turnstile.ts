"use client";

import { useCallback, useMemo, useState } from "react";
import { isTurnstileConfigured } from "@/lib/turnstile-config";

export function useAuthTurnstile() {
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [widgetKey, setWidgetKey] = useState(0);
  const required = isTurnstileConfigured();

  const onTurnstileTokenChange = useCallback((token: string | null) => {
    setTurnstileToken(token);
    if (token) {
      setLoadError(null);
    }
  }, []);

  /**
   * Force-remounts the Turnstile widget to generate a fresh token.
   * Call this before any action that re-uses the same Turnstile (e.g. OTP resend).
   */
  const bumpTurnstileWidget = useCallback(() => {
    setTurnstileToken(null);
    setWidgetKey((k) => k + 1);
  }, []);

  const ready = !required || Boolean(turnstileToken);

  const turnstileField = useMemo(
    () => (turnstileToken ? { turnstileToken } : {}),
    [turnstileToken],
  );

  return {
    required,
    ready,
    turnstileToken,
    widgetKey,
    turnstileField,
    onTurnstileTokenChange,
    bumpTurnstileWidget,
    turnstileLoadError: loadError,
    setTurnstileLoadError: setLoadError,
  };
}
