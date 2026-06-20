"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect, useRef } from "react";
import { AdminAuthProvider, useAdminAuth } from "@/contexts/admin-auth-context";
import {
  AdminShellProvider,
} from "@/contexts/admin-shell-context";
import Image from "next/image";
import {
  LogOut,
  Menu,
  X,
  Search,
  Bell,
  ChevronsUpDown,
} from "lucide-react";
import {
  getAdminNavItems,
  isAdminNavActive,
} from "@/components/admin/admin-nav-config";
import { AdminIdleTimeoutModal } from "@/components/auth/AdminIdleTimeoutModal";
import { AdminSearchPanel } from "@/components/admin/AdminSearchPanel";
import { AdminNotificationsPanel } from "@/components/admin/AdminNotificationsPanel";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { BRAND_LOGO_SRC } from "@/lib/constants";
import { useAuthStore } from "@/stores/auth";
import { canViewAdminRoute } from "@/lib/permissions";
import { redirectToAdminLogin } from "@/lib/admin-auth-navigation";
import { logoutSession } from "@/lib/auth-api";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import { getCurrentUser } from "@/lib/users-api";
import {
  coercePaginatedResponse,
  type AdminOrderListItem,
  type PaginatedResponse,
} from "@/lib/admin-api";

interface AdminConsoleShellProps {
  children: ReactNode;
}

/** Shell chrome only mounts after AdminAuthProvider has a valid session (avoids hook churn under the loading gate). */
function AdminConsoleAuthenticated({ children }: AdminConsoleShellProps) {
  return (
    <AdminShellProvider>
      <AdminConsoleFrame>{children}</AdminConsoleFrame>
    </AdminShellProvider>
  );
}

export function AdminConsoleShell({ children }: AdminConsoleShellProps) {
  return (
    <AdminAuthProvider>
      <AdminConsoleAuthenticated>{children}</AdminConsoleAuthenticated>
    </AdminAuthProvider>
  );
}

// ─── Main frame ───────────────────────────────────────────────────────────────

function AdminConsoleFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [pendingOrdersCount, setPendingOrdersCount] = useState<number | null>(null);
  const [bellOpen, setBellOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  const bellRef = useRef<HTMLDivElement>(null);

  const { accessToken, adminUser } = useAdminAuth();
  const api = useAuthenticatedApi();

  // Fetch pending orders count for badge + bell
  useEffect(() => {
    let cancelled = false;
    void api<PaginatedResponse<AdminOrderListItem>>(
      "/admin/orders?page=1&limit=1&status=CONFIRMED",
    )
      .then((res) => {
        if (!cancelled)
          setPendingOrdersCount(coercePaginatedResponse(res).meta.total);
      })
      .catch((err: unknown) => {
        console.error("[AdminConsoleShell] Failed to fetch pending orders count", err);
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  // Close bell on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (bellRef.current && !bellRef.current.contains(e.target as Node))
        setBellOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Hydrate admin profile name/email when session was restored without profile data
  useEffect(() => {
    if (!accessToken || adminUser?.firstName) return;
    void getCurrentUser(accessToken)
      .then((user) => useAuthStore.getState().setSession(accessToken, user))
      .catch((err: unknown) => {
        console.error("[AdminConsoleShell] Failed to hydrate admin profile", err);
      });
  }, [accessToken, adminUser?.firstName]);

  // ⌘K / Ctrl+K opens search
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const closeMobileNav = () => setMobileNavOpen(false);

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await logoutSession(accessToken);
    } finally {
      useAuthStore.getState().logoutLocalSession();
      redirectToAdminLogin();
    }
  }

  const permittedNavItems = getAdminNavItems().filter((item) =>
    canViewAdminRoute(adminUser, item.routeKey),
  );

  const mainNavItems = permittedNavItems.filter(
    (item) =>
      ![
        "/admin/settings",
        "/admin/catalog-write",
        "/admin/mutations",
      ].includes(item.href),
  );

  const secondaryNavItems = permittedNavItems.filter((item) =>
    [
      "/admin/settings",
      "/admin/catalog-write",
      "/admin/mutations",
    ].includes(item.href),
  );

  return (
    <>
      <div className="admin-console flex h-screen overflow-hidden bg-background text-foreground font-sans">
        {/* ── Sidebar ── */}
        <aside
          className="hidden w-64 shrink-0 flex-col border-r border-border/40 bg-card lg:flex h-full"
          aria-label="Admin navigation"
        >
          <AdminSidebarBrand />

          <div className="px-4 py-2">
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              className="flex w-full items-center gap-2 rounded-md border border-border/50 bg-background/50 py-2 pl-3 pr-2 text-sm text-muted-foreground hover:border-border hover:bg-background transition-colors"
            >
              <Search className="h-4 w-4 shrink-0" aria-hidden />
              <span className="flex-1 text-left">Search…</span>
              <div className="flex items-center justify-center rounded border border-border/50 bg-muted/50 px-1.5 py-0.5 text-[10px] font-medium">
                ⌘K
              </div>
            </button>
          </div>

          <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3 py-2 min-h-0">
            {mainNavItems.map((item) => {
              const active = isAdminNavActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "group flex items-center justify-between rounded-md px-3 py-2 text-sm font-medium transition-colors",
                    active
                      ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-900/10 dark:text-zinc-900"
                      : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                  )}
                >
                  <div className="flex items-center gap-3">
                    <item.icon className="h-4 w-4 shrink-0" aria-hidden />
                    <span>{item.label}</span>
                  </div>
                  {item.href === "/admin/orders" &&
                  pendingOrdersCount !== null &&
                  pendingOrdersCount > 0 ? (
                    <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-zinc-900 px-1.5 text-[10px] font-bold text-white">
                      {pendingOrdersCount > 99
                        ? "99+"
                        : String(pendingOrdersCount)}
                    </span>
                  ) : null}
                </Link>
              );
            })}

            {secondaryNavItems.length > 0 && (
              <>
                <div className="mx-3 my-2 border-t border-border/40" />
                {secondaryNavItems.map((item) => {
                  const active = isAdminNavActive(pathname, item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn(
                        "group flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                        active
                          ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-900/10 dark:text-zinc-900"
                          : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                      )}
                    >
                      <item.icon className="h-4 w-4 shrink-0" aria-hidden />
                      <span>{item.label}</span>
                    </Link>
                  );
                })}
              </>
            )}
          </nav>

          <div className="border-t border-border/40 p-4">
            <button
              type="button"
              className="group flex w-full items-center justify-between rounded-md p-2 transition-colors hover:bg-muted/50"
              onClick={() => void handleLogout()}
              disabled={loggingOut}
            >
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-muted font-semibold text-muted-foreground">
                  {adminUser?.firstName?.charAt(0) || "A"}
                </div>
                <div className="text-left">
                  <p className="text-sm font-medium leading-none text-foreground">
                    {adminUser?.firstName} {adminUser?.lastName}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {loggingOut ? "Signing out..." : (adminUser?.email ?? "Admin")}
                  </p>
                </div>
              </div>
              <ChevronsUpDown className="h-4 w-4 text-muted-foreground group-hover:text-foreground" />
            </button>
          </div>
        </aside>

        {/* ── Main content ── */}
        <div className="flex min-w-0 flex-1 flex-col bg-[#F9FAFB] dark:bg-background h-full overflow-hidden">
          <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border/40 bg-card px-3 py-2.5 sm:px-4 sm:py-3 lg:px-6">
            <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
              <button
                type="button"
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border lg:hidden"
                onClick={() => setMobileNavOpen(true)}
                aria-label="Open navigation menu"
              >
                <Menu className="h-5 w-5" />
              </button>

              {/* Mobile/tablet: show brand; desktop: show page title (sidebar has brand) */}
              <div className="flex items-center gap-2.5 lg:hidden min-w-0">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white border border-zinc-200 overflow-hidden">
                  <Image src={BRAND_LOGO_SRC} alt="Logo" width={36} height={36} className="object-contain" />
                </div>
                <div className="flex flex-col min-w-0">
                  <span className="font-heading text-sm font-bold tracking-tight text-foreground leading-none truncate">
                    {process.env.NEXT_PUBLIC_STORE_NAME ?? "Admin"}
                  </span>
                  <span className="text-[10px] font-medium text-muted-foreground mt-0.5">
                    Admin Console
                  </span>
                </div>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
              {/* ── Search ── */}
              <button
                type="button"
                onClick={() => setSearchOpen(true)}
                className="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-background text-muted-foreground hover:text-foreground lg:hidden"
                aria-label="Search"
              >
                <Search className="h-4 w-4" />
              </button>

              {/* ── Bell ── */}
              <div ref={bellRef} className="relative">
                <button
                  type="button"
                  onClick={() => {
                    setBellOpen((v) => !v);
                  }}
                  className="relative flex h-9 w-9 items-center justify-center rounded-md border border-border bg-background text-muted-foreground hover:text-foreground"
                  aria-label="Pending orders"
                >
                  <Bell className="h-4 w-4" />
                  {pendingOrdersCount !== null && pendingOrdersCount > 0 && (
                    <span className="absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[8px] font-bold text-white ring-2 ring-background">
                      {pendingOrdersCount > 99
                        ? "99+"
                        : String(pendingOrdersCount)}
                    </span>
                  )}
                </button>

                {bellOpen && (
                  <AdminNotificationsPanel onClose={() => setBellOpen(false)} />
                )}
              </div>

            </div>
          </header>

          <main className="flex-1 overflow-y-auto overflow-x-hidden p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:p-4 lg:p-6">
            {children}
          </main>
        </div>

        {/* ── Mobile nav overlay ── */}
        {mobileNavOpen ? (
          <div
            className="fixed inset-0 z-50 lg:hidden"
            role="dialog"
            aria-modal="true"
          >
            <button
              type="button"
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
              aria-label="Close navigation menu"
              onClick={closeMobileNav}
            />
            <aside className="absolute left-0 top-0 flex h-full w-[min(18rem,88vw)] max-w-[18rem] flex-col bg-card shadow-xl">
              <div className="flex items-center justify-between border-b border-border/40 px-4 py-3">
                <AdminSidebarBrand />
                <button
                  type="button"
                  onClick={closeMobileNav}
                  aria-label="Close menu"
                  className="rounded-md p-1.5 hover:bg-muted text-muted-foreground"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 py-4">
                {permittedNavItems.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={closeMobileNav}
                    className={cn(
                      "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium",
                      isAdminNavActive(pathname, item.href)
                        ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-900/10 dark:text-zinc-900"
                        : "text-muted-foreground hover:bg-muted",
                    )}
                  >
                    <item.icon className="h-4 w-4" />
                    {item.label}
                  </Link>
                ))}
              </nav>
              {/* User profile card + sign out at bottom of mobile sidebar */}
              <div className="border-t border-border/40 p-3 space-y-2">
                <div className="flex items-center gap-3 rounded-lg border border-border/60 bg-muted/30 px-3 py-2.5">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-sm font-bold text-zinc-800">
                    {adminUser?.firstName?.charAt(0) || "A"}
                  </div>
                  <div className="flex flex-col min-w-0">
                    <span className="text-sm font-semibold text-foreground truncate leading-none">
                      {adminUser?.firstName} {adminUser?.lastName}
                    </span>
                    <span className="text-[11px] text-muted-foreground mt-0.5 truncate">
                      {adminUser?.email ?? "Admin"}
                    </span>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full gap-2 justify-start"
                  disabled={loggingOut}
                  onClick={() => void handleLogout()}
                >
                  <LogOut className="h-4 w-4" />
                  {loggingOut ? "Signing out…" : "Sign out"}
                </Button>
              </div>
            </aside>
          </div>
        ) : null}
      </div>
      <AdminIdleTimeoutModal />
      {searchOpen && <AdminSearchPanel onClose={() => setSearchOpen(false)} />}
    </>
  );
}

function AdminSidebarBrand() {
  return (
    <div className="flex items-center gap-2.5 px-5 py-4">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white border border-zinc-200 overflow-hidden">
        <Image src={BRAND_LOGO_SRC} alt="Logo" width={36} height={36} className="object-contain" />
      </div>
      <div className="flex flex-col min-w-0">
        <span className="font-heading text-[14px] font-bold tracking-tight text-foreground leading-none truncate">
          {process.env.NEXT_PUBLIC_STORE_NAME ?? "Admin"}
        </span>
        <span className="text-[10px] font-medium text-muted-foreground mt-0.5">
          Admin Console
        </span>
      </div>
    </div>
  );
}
