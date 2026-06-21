"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSafeRouter } from "@/lib/use-safe-router";
import Image from "next/image";
import {
  X,
  User,
  LogOut,
  Search,
  Store,
  ShoppingBag,
  Loader2,
  Tag,
} from "lucide-react";
import { APP_NAME, BRAND_LOGO_SRC } from "@/lib/constants";
import { useUiStore } from "@/stores/ui";
import { useAuthStore } from "@/stores/auth";
import { logoutSession } from "@/lib/auth-api";
import { formatPrice } from "@/lib/format-price";
import { useCartStore } from "@/stores/cart";
import { useWishlistStore } from "@/stores/wishlist";
import { useSessionBootstrap } from "@/hooks/use-session-bootstrap";
import { useState, useEffect, useRef, useCallback } from "react";
import { StorefrontSearchDropdown } from "@/components/shared/StorefrontSearchDropdown";
import { useStorefrontSearch } from "@/hooks/use-storefront-search";
import {
  buildStorefrontSearchPath,
  normalizeStorefrontSearchQuery,
  STOREFRONT_SEARCH_MIN_CHARS,
} from "@/lib/storefront-search";

// ── Component ────────────────────────────────────────────────────────────────

interface MobileNavProps {
  /** Minimum order value in paise from the database. 0 = no minimum enforced. */
  minOrderValuePaise?: number;
}

export function MobileNav({ minOrderValuePaise = 0 }: MobileNavProps) {
  useSessionBootstrap();

  const mobileMenuOpen = useUiStore((s) => s.mobileMenuOpen);
  const setMobileMenuOpen = useUiStore((s) => s.setMobileMenuOpen);

  const user = useAuthStore((s) => s.user);
  const accessToken = useAuthStore((s) => s.accessToken);
  const sessionStatus = useAuthStore((s) => s.storefrontSessionStatus);
  const clearCart = useCartStore((s) => s.clearCart);

  const isSignedIn = Boolean(accessToken);
  const isCheckingSession = sessionStatus === "checking" && !accessToken;
  const pathname = usePathname();
  const router = useSafeRouter();
  const authRedirect = ["/login", "/register"].includes(pathname) ? "" : `?redirect=${encodeURIComponent(pathname)}`;

  const [searchQuery, setSearchQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const { results, loading, showPanel } = useStorefrontSearch(
    searchQuery,
    mobileMenuOpen,
  );

  const close = useCallback(() => {
    setMobileMenuOpen(false);
    setSearchQuery("");
  }, [setMobileMenuOpen]);

  const onSignOut = async () => {
    try {
      await logoutSession(accessToken);
    } catch {
      // ignore
    } finally {
      useAuthStore.getState().logoutLocalSession();
      clearCart();
      useWishlistStore.getState().clear();
      close();
    }
  };

  // Trap body scroll while open
  useEffect(() => {
    if (mobileMenuOpen) {
      document.body.style.overflow = "hidden";
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      document.body.style.overflow = "";
      setSearchQuery("");
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileMenuOpen]);

  // Close on Escape key
  useEffect(() => {
    if (!mobileMenuOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [mobileMenuOpen, close]);

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-[100] bg-black/50 backdrop-blur-sm transition-opacity duration-300 lg:hidden ${
          mobileMenuOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
        onClick={close}
        aria-hidden="true"
      />

      {/* Drawer — slides in from the RIGHT */}
      <div
        className={`fixed inset-y-0 right-0 z-[101] flex w-[85vw] max-w-sm flex-col bg-white shadow-2xl transition-transform duration-300 ease-in-out lg:hidden ${
          mobileMenuOpen ? "translate-x-0" : "translate-x-full"
        }`}
        role="dialog"
        aria-modal="true"
        aria-label="Navigation menu"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#efe8e4] px-5 py-4">
          <Link
            href="/"
            className="flex items-center gap-2 font-heading text-lg font-bold tracking-tight text-[#23403d]"
            onClick={close}
          >
            <Image
              src={BRAND_LOGO_SRC}
              alt={`${APP_NAME} logo`}
              width={28}
              height={28}
              className="size-7 object-contain"
            />
            {APP_NAME}
          </Link>
          <button
            onClick={close}
            className="rounded-full bg-[#eff5ee] p-2 text-[#23403d] transition-colors hover:bg-[#ec6e55] hover:text-white"
            aria-label="Close menu"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Live search */}
        <div className="relative border-b border-[#efe8e4] px-4 py-3">
          <div className="relative flex items-center">
            {loading ? (
              <Loader2 className="absolute left-3 size-4 animate-spin text-[#ec6e55]" aria-hidden />
            ) : (
              <Search className="absolute left-3 size-4 text-[#767676]" aria-hidden />
            )}
            <input
              ref={inputRef}
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  if (!router.isReady) return;
                  const normalized = normalizeStorefrontSearchQuery(searchQuery);
                  if (normalized.length < STOREFRONT_SEARCH_MIN_CHARS) return;
                  close();
                  router.push(buildStorefrontSearchPath(normalized));
                }
              }}
              placeholder="Search products and categories..."
              className="h-10 w-full rounded-full border border-[#efe8e4] bg-[#faf3ef] pl-9 pr-10 text-sm font-medium text-[#23403d] placeholder:text-[#767676] focus:border-[#23403d] focus:outline-none focus:ring-1 focus:ring-[#23403d]"
              aria-label="Search products and categories"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-3 text-[#767676] hover:text-[#ec6e55]"
                aria-label="Clear search"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>

          {showPanel ? (
            <div className="absolute left-4 right-4 top-full z-10 mt-1">
              <StorefrontSearchDropdown
                query={searchQuery}
                results={results}
                loading={loading}
                onNavigate={close}
              />
            </div>
          ) : null}
        </div>

        {/* Navigation */}
        <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-4 py-4">
          <p className="mb-2 px-2 text-xs font-bold uppercase tracking-wider text-[#767676]">
            Navigation
          </p>

          <Link
            href="/"
            onClick={close}
            className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-bold text-[#23403d] transition-colors hover:bg-[#faf3ef] hover:text-[#ec6e55]"
          >
            <Store className="size-4" /> Home
          </Link>
          <Link
            href="/products"
            onClick={close}
            className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-bold text-[#23403d] transition-colors hover:bg-[#faf3ef] hover:text-[#ec6e55]"
          >
            <ShoppingBag className="size-4" /> All Products
          </Link>
          <Link
            href="/products?sort=popularity"
            onClick={close}
            className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-bold text-[#23403d] transition-colors hover:bg-[#faf3ef] hover:text-[#ec6e55]"
          >
            <Tag className="size-4" /> Special Offers
          </Link>

          <div className="my-3 h-px w-full bg-[#efe8e4]" />

          <p className="mb-2 px-2 text-xs font-bold uppercase tracking-wider text-[#767676]">
            Account
          </p>

          {isCheckingSession ? (
            <div
              className="flex items-center gap-3 rounded-xl bg-[#eff5ee] px-3 py-3 text-sm font-medium text-[#767676]"
              role="status"
              aria-live="polite"
            >
              <Loader2 className="size-4 animate-spin text-[#23403d]" aria-hidden />
              Restoring your session…
            </div>
          ) : isSignedIn ? (
            <>
              <div className="mb-2 flex items-center gap-3 rounded-xl bg-[#eff5ee] px-3 py-2.5">
                <div className="flex size-8 items-center justify-center rounded-full bg-[#23403d] text-xs font-bold text-white">
                  {(user?.firstName?.charAt(0) ?? user?.email?.charAt(0) ?? "U").toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-[#23403d]">
                    {user?.firstName
                      ? `${user.firstName}${user.lastName ? ` ${user.lastName}` : ""}`
                      : "My Account"}
                  </p>
                  <p className="truncate text-xs text-[#767676]">
                    {user?.email ?? user?.phone ?? "Signed in"}
                  </p>
                </div>
              </div>
              <Link
                href="/dashboard"
                onClick={close}
                className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-bold text-[#23403d] transition-colors hover:bg-[#faf3ef]"
              >
                <User className="size-4" /> My Account
              </Link>
              <button
                onClick={() => void onSignOut()}
                className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-bold text-[#ec6e55] transition-colors hover:bg-[#faf3ef]"
              >
                <LogOut className="size-4" /> Sign Out
              </button>
            </>
          ) : (
            <>
              <Link
                href={`/login${authRedirect}`}
                onClick={close}
                className="flex items-center justify-center gap-2 rounded-xl bg-[#23403d] px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-[#ec6e55]"
              >
                <LogOut className="size-4" /> Sign In
              </Link>
              <Link
                href={`/register${authRedirect}`}
                onClick={close}
                className="flex items-center justify-center gap-2 rounded-xl border-2 border-[#23403d] px-4 py-3 text-sm font-bold text-[#23403d] transition-colors hover:border-[#ec6e55] hover:text-[#ec6e55]"
              >
                <User className="size-4" /> Create Account
              </Link>
            </>
          )}
        </nav>

        {/* Footer */}
        <div className="border-t border-[#efe8e4] px-5 py-4">
          <p className="text-center text-xs text-[#767676]">
            {minOrderValuePaise > 0
              ? `Minimum order value: ${formatPrice(minOrderValuePaise)}`
              : "Farm-fresh chemical-free produce"}
          </p>
        </div>
      </div>
    </>
  );
}
