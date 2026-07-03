"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LayoutDashboard, Package, MapPin, Settings, LogOut } from "lucide-react";
import { useAuthStore } from "@/stores/auth";
import { logoutSession } from "@/lib/auth-api";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", Icon: LayoutDashboard },
  { href: "/orders", label: "Orders", Icon: Package },
  { href: "/addresses", label: "Addresses", Icon: MapPin },
  { href: "/settings", label: "Settings", Icon: Settings },
] as const;

/**
 * Account-area navigation. Desktop: vertical sidebar with a profile card and sign-out.
 * Mobile: horizontal scrollable pill bar. Active route is highlighted.
 */
export function AccountNav() {
  const pathname = usePathname();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const accessToken = useAuthStore((s) => s.accessToken);

  const initial =
    user?.firstName?.trim().charAt(0).toUpperCase() ||
    user?.email?.trim().charAt(0).toUpperCase() ||
    "?";
  const displayName = [user?.firstName, user?.lastName].filter(Boolean).join(" ") || "My Account";
  const displayContact = user?.email || user?.phone || "";

  async function handleSignOut() {
    try {
      await logoutSession(accessToken);
    } finally {
      useAuthStore.getState().logoutLocalSession();
      router.replace("/login");
    }
  }

  return (
    <nav
      className="flex min-w-0 flex-row items-center gap-1.5 overflow-x-auto rounded-[20px] bg-white p-2 shadow-sm scrollbar-none lg:flex-col lg:items-stretch lg:gap-1 lg:overflow-x-visible lg:p-4"
      aria-label="Account"
    >
      {/* Profile card — desktop sidebar only */}
      <div className="mb-0 hidden items-center gap-3 border-b border-[#efe8e4] pb-4 lg:flex">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[#23403d] text-base font-bold text-white" aria-hidden>
          {initial}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-[#23403d]">{displayName}</p>
          {displayContact ? (
            <p className="truncate text-xs text-[#767676]">{displayContact}</p>
          ) : null}
        </div>
      </div>

      {NAV_ITEMS.map(({ href, label, Icon }) => {
        const active = pathname === href || pathname?.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex shrink-0 items-center justify-center gap-2 rounded-xl px-3.5 py-2.5 text-xs font-bold transition-colors sm:text-sm lg:justify-start lg:px-4 lg:py-3",
              active
                ? "bg-[#23403d] text-white"
                : "text-[#23403d] hover:bg-[#faf3ef] hover:text-[#ec6e55]",
            )}
          >
            <Icon className="size-4 shrink-0" aria-hidden />
            <span className="whitespace-nowrap">{label}</span>
          </Link>
        );
      })}

      {/* Sign out — desktop sidebar only (mobile keeps the pill bar compact) */}
      <button
        type="button"
        onClick={() => void handleSignOut()}
        className="mt-0 hidden items-center gap-2 rounded-xl px-4 py-3 text-sm font-bold text-[#767676] transition-colors hover:bg-[#faf3ef] hover:text-[#ec6e55] lg:mt-2 lg:flex lg:border-t lg:border-[#efe8e4] lg:pt-4"
      >
        <LogOut className="size-4 shrink-0" aria-hidden />
        Sign out
      </button>
    </nav>
  );
}
