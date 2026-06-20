"use client";

import { useEffect, useRef, useState } from "react";
import { useSafeRouter } from "@/lib/use-safe-router";
import { Loader2, Search, X } from "lucide-react";
import { StorefrontSearchDropdown } from "@/components/shared/StorefrontSearchDropdown";
import { useStorefrontSearch } from "@/hooks/use-storefront-search";
import {
  buildStorefrontSearchPath,
  normalizeStorefrontSearchQuery,
  STOREFRONT_SEARCH_MIN_CHARS,
} from "@/lib/storefront-search";
import { cn } from "@/lib/utils";

interface SearchInputProps {
  defaultValue?: string;
  className?: string;
}

export function SearchInput({ defaultValue = "", className }: SearchInputProps) {
  const [value, setValue] = useState(defaultValue);
  const [panelOpen, setPanelOpen] = useState(false);
  const router = useSafeRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const { results, loading, showPanel } = useStorefrontSearch(value, panelOpen);

  useEffect(() => {
    setValue(defaultValue);
  }, [defaultValue]);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setPanelOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!router.isReady) return;
    const normalized = normalizeStorefrontSearchQuery(value);
    if (normalized.length < STOREFRONT_SEARCH_MIN_CHARS) return;
    setPanelOpen(false);
    router.push(buildStorefrontSearchPath(normalized));
  };

  const closePanel = () => {
    setPanelOpen(false);
  };

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <form onSubmit={handleSubmit} role="search" className="relative flex items-center">
        {loading && panelOpen ? (
          <Loader2
            className="pointer-events-none absolute left-4 size-4 animate-spin text-[#ec6e55]"
            aria-hidden
          />
        ) : (
          <Search
            className="pointer-events-none absolute left-4 size-4 text-[#767676]"
            aria-hidden
          />
        )}
        <input
          type="search"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setPanelOpen(true);
          }}
          onFocus={() => setPanelOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setPanelOpen(false);
            }
          }}
          placeholder="Search for chemical free vegetables, fruits..."
          className="h-11 w-full rounded-full border border-[#efe8e4] bg-[#faf3ef] pl-11 pr-24 text-sm font-medium text-[#23403d] placeholder:text-[#767676] focus:border-[#23403d] focus:outline-none focus:ring-1 focus:ring-[#23403d]"
          aria-label="Search products and categories"
          aria-autocomplete="list"
          aria-controls={
            panelOpen && showPanel ? "storefront-search-results" : undefined
          }
          autoComplete="off"
        />
        {value && (
          <button
            type="button"
            onClick={() => {
              setValue("");
              setPanelOpen(false);
            }}
            className="absolute right-[85px] inline-flex size-6 items-center justify-center rounded-full text-[#767676] hover:text-[#ec6e55]"
            aria-label="Clear search"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        )}
        <button
          type="submit"
          className="absolute right-1.5 h-8 rounded-full bg-[#23403d] px-5 text-xs font-bold text-white transition-colors hover:bg-[#ec6e55]"
        >
          Search
        </button>
      </form>

      {panelOpen && showPanel ? (
        <div
          id="storefront-search-results"
          className="absolute left-0 right-0 top-[calc(100%+0.5rem)] z-50"
        >
          <StorefrontSearchDropdown
            query={value}
            results={results}
            loading={loading}
            onNavigate={closePanel}
          />
        </div>
      ) : null}
    </div>
  );
}
