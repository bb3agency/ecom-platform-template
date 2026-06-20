"use client";

import { useEffect, useRef, useState } from "react";
import {
  normalizeStorefrontSearchQuery,
  searchStorefrontCatalog,
  STOREFRONT_SEARCH_DEBOUNCE_MS,
  STOREFRONT_SEARCH_MIN_CHARS,
  type StorefrontSearchResults,
} from "@/lib/storefront-search";

export function useStorefrontSearch(query: string, enabled = true) {
  const [results, setResults] = useState<StorefrontSearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const trimmed = normalizeStorefrontSearchQuery(query);
    if (!enabled || trimmed.length < STOREFRONT_SEARCH_MIN_CHARS) {
      setResults(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const timer = window.setTimeout(() => {
      void searchStorefrontCatalog(trimmed, { signal: controller.signal })
        .then((next) => {
          if (!controller.signal.aborted) {
            setResults(next);
          }
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            setResults({
              products: [],
              categories: [],
              productTotal: 0,
            });
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) {
            setLoading(false);
          }
        });
    }, STOREFRONT_SEARCH_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, enabled]);

  const showPanel =
    enabled &&
    normalizeStorefrontSearchQuery(query).length >=
      STOREFRONT_SEARCH_MIN_CHARS &&
    (loading || results !== null);

  return { results, loading, showPanel };
}
