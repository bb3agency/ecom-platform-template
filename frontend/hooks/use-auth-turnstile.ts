"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getTurnstileSiteKey, isTurnstileConfigured } from "@/lib/turnstile-config";
import { fetchPublicStoreConfigClient } from "@/lib/storefront-settings";
import {
  resolveAuthChallengeState,
  TURNSTILE_MISCONFIGURED_MESSAGE,
} from "@/lib/auth-challenge";

export { TURNSTILE_MISCONFIGURED_MESSAGE };

/**
 * Bot-challenge state for the auth forms.
 *
 * The server is the authority on whether a challenge is required. This hook asks it
 * (`GET /store/config` → `authChallenge`) instead of inferring the answer from the
 * build-time `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, because the two can disagree: a
 * storefront built without that variable against an API holding
 * `TURNSTILE_SECRET_KEY` rendered no widget, sent no token, and had every login,
 * registration, phone OTP and password reset rejected with "Challenge token is
 * required". Nothing surfaced it — the forms looked fine and simply failed.
 *
 * Two guarantees follow:
 * - `ready` is false while the contract is still loading, so a form can never post
 *   before we know whether it needs a token. A token-less request is not just a
 *   failure: the API counts it as a challenge failure and locks the IP after three.
 * - `misconfigured` is true when the server demands a challenge but no site key is
 *   resolvable from either source. The caller must show that and keep submit
 *   disabled — the request cannot succeed, so sending it only burns the lockout.
 */
export function useAuthTurnstile() {
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [widgetKey, setWidgetKey] = useState(0);
  const [serverRequired, setServerRequired] = useState<boolean | null>(null);
  const [serverSiteKey, setServerSiteKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchPublicStoreConfigClient().then((config) => {
      if (cancelled) return;
      if (config.configAvailable) {
        setServerRequired(config.authChallenge.required);
        setServerSiteKey(config.authChallenge.siteKey);
        return;
      }
      // Config unreachable — fall back to the build-time answer rather than
      // blocking sign-in on an unrelated outage.
      setServerRequired(isTurnstileConfigured());
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const { required, ready, configLoading, misconfigured, siteKey } = resolveAuthChallengeState({
    serverRequired,
    serverSiteKey,
    envConfigured: isTurnstileConfigured(),
    envSiteKey: getTurnstileSiteKey(),
    token: turnstileToken,
  });

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

  const turnstileField = useMemo(
    () => (turnstileToken ? { turnstileToken } : {}),
    [turnstileToken],
  );

  return {
    required,
    ready,
    /** True until the server's challenge contract is known. Disable submit, show no error. */
    configLoading,
    /** Server demands a challenge but no site key exists anywhere — submit cannot succeed. */
    misconfigured,
    /** Resolved public site key (server-published, else build-time env). */
    siteKey,
    turnstileToken,
    widgetKey,
    turnstileField,
    onTurnstileTokenChange,
    bumpTurnstileWidget,
    turnstileLoadError: loadError,
    setTurnstileLoadError: setLoadError,
  };
}
