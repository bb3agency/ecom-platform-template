"use client";

import { useEffect, useRef } from "react";
import { getTurnstileSiteKey, isTurnstileConfigured } from "@/lib/turnstile-config";

const TURNSTILE_SCRIPT_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

type TurnstileApi = {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string;
      callback: (token: string) => void;
      "expired-callback"?: () => void;
      "error-callback"?: () => void;
    },
  ) => string;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let scriptLoadPromise: Promise<void> | null = null;

function loadTurnstileScript(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.resolve();
  }
  if (window.turnstile) {
    return Promise.resolve();
  }
  if (!scriptLoadPromise) {
    scriptLoadPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector<HTMLScriptElement>(
        `script[src="${TURNSTILE_SCRIPT_SRC}"]`,
      );
      if (existing) {
        if (window.turnstile) {
          resolve();
          return;
        }
        existing.addEventListener("load", () => resolve(), { once: true });
        existing.addEventListener(
          "error",
          () => reject(new Error("Turnstile script failed to load")),
          { once: true },
        );
        return;
      }
      const script = document.createElement("script");
      script.src = TURNSTILE_SCRIPT_SRC;
      script.async = true;
      script.defer = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Turnstile script failed to load"));
      document.head.appendChild(script);
    });
  }
  return scriptLoadPromise;
}

interface TurnstileChallengeProps {
  onTokenChange: (token: string | null) => void;
  onLoadError?: (message: string) => void;
  className?: string;
}

/**
 * Cloudflare Turnstile widget. Renders only when `isTurnstileConfigured()` is true
 * (production build with site key, or dev with NEXT_PUBLIC_TURNSTILE_ENFORCE_IN_DEV=true).
 */
export function TurnstileChallenge({
  onTokenChange,
  onLoadError,
  className,
}: TurnstileChallengeProps) {
  const siteKey = isTurnstileConfigured() ? getTurnstileSiteKey() : null;
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const onTokenChangeRef = useRef(onTokenChange);

  useEffect(() => {
    onTokenChangeRef.current = onTokenChange;
  });

  useEffect(() => {
    if (!siteKey) {
      onTokenChangeRef.current(null);
      return;
    }

    let cancelled = false;

    void loadTurnstileScript()
      .then(() => {
        if (cancelled || !containerRef.current || !window.turnstile) {
          return;
        }
        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          callback: (token) => onTokenChangeRef.current(token),
          "expired-callback": () => onTokenChangeRef.current(null),
          "error-callback": () => onTokenChangeRef.current(null),
        });
      })
      .catch(() => {
        if (!cancelled) {
          onLoadError?.("Security check failed to load. Refresh the page and try again.");
          onTokenChangeRef.current(null);
        }
      });

    return () => {
      cancelled = true;
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }
      onTokenChangeRef.current(null);
    };
  }, [siteKey, onLoadError]);

  if (!siteKey) {
    return null;
  }

  return <div ref={containerRef} className={className} />;
}
