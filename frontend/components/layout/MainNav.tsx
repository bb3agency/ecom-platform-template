"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { User, LogOut } from "lucide-react";
import { useAuthStore } from "@/stores/auth";
import { logoutSession } from "@/lib/auth-api";
import { useCartStore } from "@/stores/cart";
import { useWishlistStore } from "@/stores/wishlist";
import { useCartSync } from "@/hooks/use-cart-sync";
import { useWishlistSync } from "@/hooks/use-wishlist-sync";
import { useSessionBootstrap } from "@/hooks/use-session-bootstrap";
import { CartDropdown } from "@/components/cart/CartDropdown";

export function MainNav() {
  useSessionBootstrap();
  useCartSync();
  useWishlistSync();
  const router = useRouter();
  const pathname = usePathname();
  const authRedirect = ["/login", "/register"].includes(pathname) ? "" : `?redirect=${encodeURIComponent(pathname)}`;
  const user = useAuthStore((s) => s.user);
  const accessToken = useAuthStore((s) => s.accessToken);
  const sessionStatus = useAuthStore((s) => s.storefrontSessionStatus);
  const clearCart = useCartStore((s) => s.clearCart);

  const isSignedIn = Boolean(accessToken);
  const isCheckingSession = sessionStatus === "checking" && !accessToken;

  const onSignOut = async () => {
    try {
      await logoutSession(accessToken);
    } catch {
      // Ignore API logout failures and clear client session anyway.
    } finally {
      useAuthStore.getState().logoutLocalSession();
      clearCart();
      useWishlistStore.getState().clear();
      router.push("/login");
    }
  };

  return (
    <div className="flex shrink-0 items-center gap-3 sm:gap-6">
      {/* Account Menu */}
      <div className="group relative hidden lg:flex items-center gap-2 cursor-pointer">
        <div className="flex size-9 items-center justify-center rounded-full bg-[#eff5ee] text-[#23403d] transition-colors group-hover:bg-[#ec6e55] group-hover:text-white sm:size-11">
          <User className="size-4 sm:size-5" />
        </div>
        
        <div className="hidden flex-col lg:flex">
          {isCheckingSession ? (
            <>
              <span className="h-3 w-16 animate-pulse rounded bg-[#efe8e4]" aria-hidden />
              <span className="mt-1 h-4 w-20 animate-pulse rounded bg-[#efe8e4]" aria-hidden />
            </>
          ) : isSignedIn ? (
            <>
              <span className="text-xs font-bold text-[#767676]">Hello, {user?.firstName || 'User'}</span>
              <span className="text-sm font-bold text-[#23403d]">My Account</span>
            </>
          ) : (
            <>
              <span className="text-xs font-bold text-[#767676]">Welcome</span>
              <span className="text-sm font-bold text-[#23403d]">Sign In / Register</span>
            </>
          )}
        </div>

        {/* Dropdown Menu */}
        <div className="absolute right-0 top-full pt-4 opacity-0 invisible transition-all group-hover:opacity-100 group-hover:visible z-50">
          <div className="flex w-48 flex-col overflow-hidden rounded-xl border border-[#efe8e4] bg-white shadow-xl">
            {isCheckingSession ? (
              <div className="px-5 py-3 text-sm text-[#767676]">Checking session…</div>
            ) : isSignedIn ? (
              <>
                <Link href="/dashboard" className="flex items-center gap-3 px-5 py-3 text-sm font-bold text-[#23403d] hover:bg-[#faf3ef] hover:text-[#ec6e55]">
                  <User className="size-4" /> Dashboard
                </Link>
                <button onClick={onSignOut} className="flex items-center gap-3 px-5 py-3 text-left text-sm font-bold text-[#23403d] hover:bg-[#faf3ef] hover:text-[#ec6e55]">
                  <LogOut className="size-4" /> Sign Out
                </button>
              </>
            ) : (
              <>
                <Link href={`/login${authRedirect}`} className="flex items-center gap-3 px-5 py-3 text-sm font-bold text-[#23403d] hover:bg-[#faf3ef] hover:text-[#ec6e55]">
                  <LogOut className="size-4" /> Sign In
                </Link>
                <Link href={`/register${authRedirect}`} className="flex items-center gap-3 px-5 py-3 text-sm font-bold text-[#23403d] hover:bg-[#faf3ef] hover:text-[#ec6e55]">
                  <User className="size-4" /> Register
                </Link>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Mini Cart — click opens a dropdown right below the icon (items + Go to Cart). */}
      <CartDropdown />
    </div>
  );
}
