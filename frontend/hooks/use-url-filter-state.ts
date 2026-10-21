"use client";

import { useCallback, useState } from "react";

import { readFilterParam, writeFilterParam } from "@/lib/url-filter-params";

/**
 * A list filter mirrored to the URL query string. Reads the initial value once
 * (so `/admin/orders?status=CONFIRMED` opens filtered) and replaces — not pushes —
 * history entries on change, so filtering doesn't flood the Back button.
 *
 * Admin lists render only after the client-side session gate, so reading
 * `window.location` in the initializer cannot cause a hydration mismatch.
 */
export function useUrlFilterState(
  key: string,
  defaultValue: string,
  allowed?: readonly string[],
): [string, (value: string) => void] {
  const [value, setValue] = useState(() =>
    typeof window === "undefined" ? defaultValue : readFilterParam(window.location.search, key, defaultValue, allowed),
  );

  const update = useCallback(
    (next: string) => {
      setValue(next);
      if (typeof window !== "undefined") {
        window.history.replaceState(window.history.state, "", writeFilterParam(window.location.href, key, next, defaultValue));
      }
    },
    [key, defaultValue],
  );

  return [value, update];
}
