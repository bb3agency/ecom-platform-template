"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect, useRef, useCallback } from "react";
import { useAdminDataRefreshEffect } from "@/hooks/use-admin-data-refresh-effect";
import { AdminAuthProvider, useAdminAuth } from "@/contexts/admin-auth-context";
import {
  AdminShellProvider,
} from "@/contexts/admin-shell-context";
import Image from "next/image";
import {
  LogOut,
  Menu,
  Search,
  Bell,
  ChevronsUpDown,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import {
  getAdminNavItems,
  isAdminNavActive,
  type AdminNavItem,
} from "@/components/admin/admin-nav-config";
import { AdminIdleTimeoutModal } from "@/components/auth/AdminIdleTimeoutModal";
import { AdminSearchPanel } from "@/components/admin/AdminSearchPanel";
import { AdminNotificationsPanel } from "@/components/admin/AdminNotificationsPanel";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { BRAND_LOGO_SRC } from "@/lib/constants";
import { useAuthStore } from "@/stores/auth";
import { useToastStore } from "@/stores/toast";
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

const SIDEBAR_COLLAPSED_KEY = "admin.sidebar.collapsed";

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
  const [signOutConfirmOpen, setSignOutConfirmOpen] = useState(false);
  const [pendingOrdersCount, setPendingOrdersCount] = useState<number | null>(null);
  const [bellOpen, setBellOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  // Collapsed state persists across visits; default expanded.
  const [collapsed, setCollapsed] = useState(false);

  const bellRef = useRef<HTMLDivElement>(null);

  const { accessToken, adminUser } = useAdminAuth();
  const api = useAuthenticatedApi();
  const pushToast = useToastStore((s) => s.push);

  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1");
    } catch {
      // Storage unavailable — stay expanded.
    }
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0");
      } catch {
        // Best-effort persistence only.
      }
      return next;
    });
  };

  // Pending-orders count for the sidebar badge + bell. Kept live without a refresh:
  //  - refetches whenever any admin surface mutates order data (notifyAdminDataChanged bus);
  //  - background-polls every 20s so counts move even when the change happened elsewhere
  //    (another admin, a customer checkout, a webhook) — skipped while the tab is hidden.
  const refreshPendingCount = useCallback(() => {
    void api<PaginatedResponse<AdminOrderListItem>>(
      "/admin/orders?page=1&limit=1&status=CONFIRMED",
    )
      .then((res) => setPendingOrdersCount(coercePaginatedResponse(res).meta.total))
      .catch((err: unknown) => {
        console.error("[AdminConsoleShell] Failed to fetch pending orders count", err);
      });
  }, [api]);

  useEffect(() => {
    refreshPendingCount();
    // 20s poll: new orders arrive from customer checkouts/webhooks that no in-app
    // mutation event can announce, so polling is the only "live" signal. The count
    // query is limit=1 (meta.total only) — cheap enough for a short interval.
    const interval = window.setInterval(() => {
      if (!document.hidden) refreshPendingCount();
    }, 20_000);
    const onVisible = () => {
      if (!document.hidden) refreshPendingCount();
    };
    // Both listeners are needed: `visibilitychange` covers tab switches/minimise,
    // but NOT switching between desktop windows (tab stays visible) — `focus` does.
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [refreshPendingCount]);

  // Refresh on every route change inside the console — navigating around is the
  // most common "did anything new come in?" gesture.
  useEffect(() => {
    refreshPendingCount();
  }, [pathname, refreshPendingCount]);

  // Instant update after in-app mutations (ship/cancel/refund/status changes).
  useAdminDataRefreshEffect(refreshPendingCount, ["orders", "dashboard"]);

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
      pushToast({ variant: "success", message: "Signed out successfully." });
      useAuthStore.getState().logoutLocalSession();
      redirectToAdminLogin();
    }
  }

  const permittedNavItems = getAdminNavItems().filter((item) =>
    canViewAdminRoute(adminUser, item.routeKey),
  );

  const SYSTEM_HREFS = ["/admin/settings", "/admin/catalog-write", "/admin/mutations"];
  const mainNavItems = permittedNavItems.filter((item) => !SYSTEM_HREFS.includes(item.href));
  const secondaryNavItems = permittedNavItems.filter((item) => SYSTEM_HREFS.includes(item.href));

  const renderNavItem = (item: AdminNavItem, options?: { onNavigate?: () => void }) => {
    const active = isAdminNavActive(pathname, item.href);
    const showBadge =
      item.href === "/admin/orders" && pendingOrdersCount !== null && pendingOrdersCount > 0;
    const badge = showBadge ? (
      <span
        className={cn(
          "flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[10px] font-bold",
          active ? "bg-primary-foreground/20 text-primary-foreground" : "bg-primary text-primary-foreground",
        )}
      >
        {pendingOrdersCount > 99 ? "99+" : String(pendingOrdersCount)}
      </span>
    ) : null;

    const link = (
      <Link
        key={item.href}
        href={item.href}
        onClick={options?.onNavigate}
        aria-current={active ? "page" : undefined}
        className={cn(
          "group relative flex items-center rounded-lg text-sm font-medium transition-colors duration-150",
          collapsed ? "justify-center px-0 py-2.5" : "justify-between px-3 py-2",
          active
            ? "bg-primary text-primary-foreground shadow-sm"
            : "text-muted-foreground hover:bg-muted hover:text-foreground",
        )}
      >
        {/* Left indicator bar for the active item. */}
        {active && !collapsed && (
          <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-primary-foreground/70" />
        )}
        <span className={cn("flex items-center", collapsed ? "" : "gap-3")}>
          <item.icon className="size-5 shrink-0" aria-hidden />
          {!collapsed && <span>{item.label}</span>}
        </span>
        {!collapsed && badge}
        {collapsed && showBadge && (
          <span className="absolute -top-0.5 right-1 size-2 rounded-full bg-accent" aria-hidden />
        )}
      </Link>
    );

    // Collapsed rail: full label in a tooltip — never truncate.
    if (collapsed && !options?.onNavigate) {
      return (
        <Tooltip key={item.href}>
          <TooltipTrigger render={link} />
          <TooltipContent side="right">{item.label}</TooltipContent>
        </Tooltip>
      );
    }
    return link;
  };

  return (
    <TooltipProvider>
      <div className="admin-console flex h-screen overflow-hidden bg-background text-foreground font-sans">
        {/* ── Sidebar (desktop) ── */}
        <aside
          className={cn(
            "hidden shrink-0 flex-col border-r border-border bg-card lg:flex h-full transition-[width] duration-200 ease-out",
            collapsed ? "w-[72px]" : "w-[260px]",
          )}
          aria-label="Admin navigation"
        >
          <div className={cn("flex items-center", collapsed ? "justify-center px-2 py-4" : "justify-between pr-3")}>
            {collapsed ? <AdminBrandMark /> : <AdminSidebarBrand />}
            {!collapsed && (
              <button
                type="button"
                onClick={toggleCollapsed}
                aria-label="Collapse sidebar"
                className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <PanelLeftClose className="size-4" />
              </button>
            )}
          </div>
          {collapsed && (
            <div className="flex justify-center pb-1">
              <button
                type="button"
                onClick={toggleCollapsed}
                aria-label="Expand sidebar"
                className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <PanelLeftOpen className="size-4" />
              </button>
            </div>
          )}

          {!collapsed && (
            <div className="px-4 py-2">
              <button
                type="button"
                onClick={() => setSearchOpen(true)}
                className="flex w-full items-center gap-2 rounded-lg border border-border bg-background/60 py-2 pl-3 pr-2 text-sm text-muted-foreground transition-colors hover:border-border hover:bg-background"
              >
                <Search className="size-4 shrink-0" aria-hidden />
                <span className="flex-1 text-left">Search…</span>
                <kbd className="flex items-center justify-center rounded border border-border bg-muted/50 px-1.5 py-0.5 text-[10px] font-medium">
                  ⌘K
                </kbd>
              </button>
            </div>
          )}
          {collapsed && (
            <div className="flex justify-center px-2 py-2">
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      onClick={() => setSearchOpen(true)}
                      aria-label="Search"
                      className="rounded-lg border border-border bg-background/60 p-2 text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
                    >
                      <Search className="size-5" aria-hidden />
                    </button>
                  }
                />
                <TooltipContent side="right">Search (⌘K)</TooltipContent>
              </Tooltip>
            </div>
          )}

          <nav
            className={cn(
              "flex flex-1 flex-col gap-0.5 overflow-y-auto py-2 min-h-0",
              collapsed ? "px-3" : "px-3",
            )}
          >
            {mainNavItems.map((item) => renderNavItem(item))}

            {secondaryNavItems.length > 0 && (
              <>
                <div className="mx-1 my-2 border-t border-border" />
                {secondaryNavItems.map((item) => renderNavItem(item))}
              </>
            )}
          </nav>

          {/* User profile → opens the sign-out confirmation. */}
          <div className={cn("border-t border-border", collapsed ? "p-2" : "p-3")}>
            <button
              type="button"
              className={cn(
                "group flex w-full items-center rounded-lg transition-colors hover:bg-muted",
                collapsed ? "justify-center p-2" : "justify-between p-2",
              )}
              onClick={() => setSignOutConfirmOpen(true)}
              disabled={loggingOut}
              aria-label="Account and sign out"
            >
              <span className={cn("flex items-center", collapsed ? "" : "gap-3")}>
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 font-semibold text-primary">
                  {adminUser?.firstName?.charAt(0) || "A"}
                </span>
                {!collapsed && (
                  <span className="text-left">
                    <span className="block text-sm font-medium leading-none text-foreground">
                      {adminUser?.firstName} {adminUser?.lastName}
                    </span>
                    <span className="mt-0.5 block max-w-36 truncate text-xs text-muted-foreground">
                      {loggingOut ? "Signing out…" : (adminUser?.email ?? "Admin")}
                    </span>
                  </span>
                )}
              </span>
              {!collapsed && (
                <ChevronsUpDown className="size-4 text-muted-foreground group-hover:text-foreground" />
              )}
            </button>
          </div>
        </aside>

        {/* ── Main content ── */}
        <div className="flex min-w-0 flex-1 flex-col bg-background h-full overflow-hidden">
          <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border bg-card px-3 py-2.5 sm:px-4 sm:py-3 lg:px-6">
            <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
              <button
                type="button"
                className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-border lg:hidden"
                onClick={() => setMobileNavOpen(true)}
                aria-label="Open navigation menu"
              >
                <Menu className="size-5" />
              </button>

              {/* Mobile/tablet: show brand; desktop: sidebar carries the brand */}
              <div className="lg:hidden min-w-0">
                <AdminSidebarBrand compact />
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
              {/* ── Search (mobile) ── */}
              <button
                type="button"
                onClick={() => setSearchOpen(true)}
                className="flex size-9 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground hover:text-foreground lg:hidden"
                aria-label="Search"
              >
                <Search className="size-4" />
              </button>

              {/* ── Bell ── */}
              <div ref={bellRef} className="relative">
                <button
                  type="button"
                  onClick={() => {
                    setBellOpen((v) => !v);
                  }}
                  className="relative flex size-9 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground transition-colors hover:text-foreground"
                  aria-label="Pending orders"
                >
                  <Bell className="size-4" />
                  {pendingOrdersCount !== null && pendingOrdersCount > 0 && (
                    <span className="absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[8px] font-bold text-white ring-2 ring-background">
                      {pendingOrdersCount > 99 ? "99+" : String(pendingOrdersCount)}
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

        {/* ── Mobile nav drawer ── */}
        <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
          <SheetContent side="left" className="max-w-[min(18rem,88vw)] lg:hidden">
            <div className="flex items-center border-b border-border px-4 py-3">
              <SheetTitle className="p-0">
                <AdminSidebarBrand compact />
              </SheetTitle>
            </div>
            <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 py-4">
              {mainNavItems.map((item) => renderNavItem(item, { onNavigate: closeMobileNav }))}
              {secondaryNavItems.length > 0 && (
                <>
                  <div className="mx-1 my-2 border-t border-border" />
                  {secondaryNavItems.map((item) =>
                    renderNavItem(item, { onNavigate: closeMobileNav }),
                  )}
                </>
              )}
            </nav>
            {/* User profile card + sign out at bottom of mobile drawer */}
            <div className="border-t border-border p-3 space-y-2">
              <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2.5">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
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
                onClick={() => {
                  closeMobileNav();
                  setSignOutConfirmOpen(true);
                }}
              >
                <LogOut className="size-4" />
                Sign out
              </Button>
            </div>
          </SheetContent>
        </Sheet>
      </div>

      {/* Sign-out confirmation — never log out on a stray click. */}
      <ConfirmDialog
        open={signOutConfirmOpen}
        onOpenChange={setSignOutConfirmOpen}
        title="Sign Out"
        description="Are you sure you want to sign out? You will need to sign in again to access the admin console."
        confirmLabel="Sign Out"
        icon={LogOut}
        onConfirm={async () => {
          await handleLogout();
        }}
      />

      <AdminIdleTimeoutModal />
      {searchOpen && <AdminSearchPanel onClose={() => setSearchOpen(false)} />}
    </TooltipProvider>
  );
}

function AdminBrandMark() {
  return (
    <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-card">
      <Image src={BRAND_LOGO_SRC} alt="Logo" width={36} height={36} className="object-contain" />
    </div>
  );
}

function AdminSidebarBrand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={cn("flex items-center gap-2.5", compact ? "" : "px-5 py-4")}>
      <div className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-card">
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
  );
}
