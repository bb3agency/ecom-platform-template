"use client";

import { useEffect, useState } from "react";

/**
 * Returns a counter that increments whenever the browser window regains focus
 * or the tab becomes visible. Add this to a fetch useEffect's dependency array
 * to re-fetch the latest data when an admin tabs back to the page, keeping
 * settings in sync across multiple concurrent admin sessions.
 */
export function useRefetchKey(): number {
  const [key, setKey] = useState(0);

  useEffect(() => {
    const bump = () => setKey((k) => k + 1);
    const onVisibility = () => {
      if (document.visibilityState === "visible") bump();
    };

    window.addEventListener("focus", bump);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", bump);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return key;
}
