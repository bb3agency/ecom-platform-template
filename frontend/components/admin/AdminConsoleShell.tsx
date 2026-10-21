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
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import {
  ADMIN_NAV_GROUPS,
  getAdminNavItems,
  isAdminNavActive,
  type AdminNavItem,
} from "@/components/admin/admin-nav-config";
import { Monogram } from "@/components/ui/console";
import "@/components/ui/console-theme.css";
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

  const pendingBadge =
    pendingOrdersCount !== null && pendingOrdersCount > 0
      ? pendingOrdersCount > 99
        ? "99+"
        : String(pendingOrdersCount)
      : null;

  const navGroups = ADMIN_NAV_GROUPS.map((group) => ({
    ...group,
    items: permittedNavItems.filter((item) => item.group === group.id),
  })).filter((group) => group.items.length > 0);

  const tabItems = permittedNavItems.filter((item) => item.mobileTab).slice(0, 4);
  const moreActive = !tabItems.some((item) => isAdminNavActive(pathname, item.href));

  const renderNavItem = (item: AdminNavItem, options?: { onNavigate?: () => void; rail?: boolean }) => {
    const active = isAdminNavActive(pathname, item.href);
    const rail = options?.rail ?? false;
    const badge = item.href === "/admin/orders" ? pendingBadge : null;

    const link = (
      <Link
        key={item.href}
        href={item.href}
        onClick={options?.onNavigate}
        aria-current={active ? "page" : undefined}
        className={cn(
          "group relative flex min-h-9 items-center rounded-lg text-sm transition-colors",
          rail ? "size-10 justify-center" : "gap-3 px-2.5 py-1.5",
          active
            ? "bg-muted font-medium text-foreground"
            : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
        )}
      >
        {active ? (
          <span aria-hidden className="absolute -left-3 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-primary" />
        ) : null}
        <item.icon className={cn("size-4.5 shrink-0", active ? "text-primary" : "")} aria-hidden />
        {rail ? null : <span className="min-w-0 flex-1 truncate">{item.label}</span>}
        {!rail && badge ? (
          <span className="rounded-full bg-primary px-1.5 py-px text-xs font-semibold text-primary-foreground tabular">
            {badge}
          </span>
        ) : null}
        {rail && badge ? (
          <span aria-hidden className="absolute right-1.5 top-1.5 size-2 rounded-full bg-primary ring-2 ring-card" />
        ) : null}
      </Link>
    );

    if (rail) {
      return (
        <Tooltip key={item.href}>
          <TooltipTrigger render={link} />
          <TooltipContent side="right">
            {item.label}
            {badge ? ` · ${badge} to fulfil` : ""}
          </TooltipContent>
        </Tooltip>
      );
    }
    return link;
  };

  const renderNavGroups = (options?: { onNavigate?: () => void; rail?: boolean }) =>
    navGroups.map((group, index) => (
      <div key={group.id} className={cn("flex flex-col gap-px", index > 0 ? "mt-3" : "")}>
        {group.label && !options?.rail ? (
          <p className="px-2.5 pb-1 text-xs font-medium text-muted-foreground">{group.label}</p>
        ) : null}
        {group.label && options?.rail && index > 0 ? (
          <span aria-hidden className="mx-auto mb-2 h-px w-6 bg-border" />
        ) : null}
        {group.items.map((item) => renderNavItem(item, options))}
      </div>
    ));

  const accountName =
    [adminUser?.firstName, adminUser?.lastName].filter(Boolean).join(" ") || "Admin";

  return (
    <TooltipProvider>
      <div className="console-theme admin-console flex h-dvh overflow-hidden bg-background text-foreground">
        {/* ── Sidebar (desktop) ── */}
        <aside
          className={cn(
            "hidden h-full shrink-0 flex-col border-r border-border bg-card transition-[width] duration-200 ease-out lg:flex",
            collapsed ? "w-16" : "w-60",
          )}
          aria-label="Admin navigation"
        >
          <div
            className={cn(
              "flex h-14 shrink-0 items-center border-b border-border",
              collapsed ? "justify-center px-2" : "justify-between gap-2 pl-4 pr-2",
            )}
          >
            {collapsed ? <AdminBrandMark /> : <AdminSidebarBrand />}
            {!collapsed ? (
              <button
                type="button"
                onClick={toggleCollapsed}
                aria-label="Collapse sidebar"
                className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <PanelLeftClose className="size-4" aria-hidden />
              </button>
            ) : null}
          </div>

          <nav
            className={cn(
              "flex min-h-0 flex-1 flex-col overflow-y-auto py-4",
              collapsed ? "items-center px-3" : "px-3",
            )}
          >
            {collapsed ? (
              <button
                type="button"
                onClick={toggleCollapsed}
                aria-label="Expand sidebar"
                className="mb-3 flex size-10 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <PanelLeftOpen className="size-4.5" aria-hidden />
              </button>
            ) : null}
            {renderNavGroups({ rail: collapsed })}
          </nav>

          <div className={cn("shrink-0 border-t border-border", collapsed ? "flex justify-center p-3" : "p-2")}>
            <button
              type="button"
              className={cn(
                "group flex items-center rounded-lg text-left transition-colors hover:bg-muted",
                collapsed ? "size-10 justify-center" : "w-full gap-3 p-2",
              )}
              onClick={() => setSignOutConfirmOpen(true)}
              disabled={loggingOut}
              aria-label="Account and sign out"
            >
              <Monogram name={adminUser?.firstName ?? adminUser?.email} className="bg-primary/10 text-primary" />
              {!collapsed ? (
                <>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground">{accountName}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {loggingOut ? "Signing out…" : (adminUser?.email ?? "Admin")}
                    </span>
                  </span>
                  <LogOut className="size-4 shrink-0 text-muted-foreground group-hover:text-foreground" aria-hidden />
                </>
              ) : null}
            </button>
          </div>
        </aside>

        {/* ── Main column ── */}
        <div className="flex h-full min-w-0 flex-1 flex-col">
          <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-card px-4 sm:px-6 lg:px-8">
            <div className="min-w-0 flex-1 lg:hidden">
              <AdminSidebarBrand compact />
            </div>

            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              className="hidden h-9 w-full max-w-sm items-center gap-2 rounded-lg border border-input bg-background px-3 text-sm text-muted-foreground transition-colors hover:text-foreground lg:flex"
            >
              <Search className="size-4 shrink-0" aria-hidden />
              <span className="flex-1 text-left">Search orders, products, customers</span>
              <kbd className="rounded border border-border bg-card px-1.5 py-0.5 font-sans text-xs">Ctrl K</kbd>
            </button>

            <div className="flex shrink-0 items-center gap-1 lg:ml-auto">
              <button
                type="button"
                onClick={() => setSearchOpen(true)}
                className="flex size-10 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:hidden"
                aria-label="Search"
              >
                <Search className="size-5" aria-hidden />
              </button>

              <div ref={bellRef} className="relative">
                <button
                  type="button"
                  onClick={() => setBellOpen((v) => !v)}
                  className="relative flex size-10 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  aria-label={pendingBadge ? `${pendingBadge} orders to fulfil` : "Notifications"}
                  aria-expanded={bellOpen}
                >
                  <Bell className="size-5" aria-hidden />
                  {pendingBadge ? (
                    <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-xs font-semibold leading-none text-white ring-2 ring-card tabular">
                      {pendingBadge}
                    </span>
                  ) : null}
                </button>
                {bellOpen ? <AdminNotificationsPanel onClose={() => setBellOpen(false)} /> : null}
              </div>
            </div>
          </header>

          <main className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 pb-24 pt-5 sm:px-6 sm:pt-6 lg:px-8 lg:pb-10 lg:pt-8">
            {children}
          </main>
        </div>

        {/* ── Phone/tablet bottom tab bar ── */}
        <nav
          aria-label="Primary"
          className="console-tabbar fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card lg:hidden"
        >
          <ul className="mx-auto grid max-w-lg grid-cols-5">
            {tabItems.map((item) => {
              const active = isAdminNavActive(pathname, item.href);
              const badge = item.href === "/admin/orders" ? pendingBadge : null;
              return (
                <li key={item.href} className="min-w-0">
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "relative flex h-14 flex-col items-center justify-center gap-0.5 text-xs transition-colors",
                      active ? "font-medium text-primary" : "text-muted-foreground",
                    )}
                  >
                    <span className="relative">
                      <item.icon className="size-5" aria-hidden />
                      {badge ? (
                        <span className="absolute -right-2.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-xs font-semibold leading-none text-white tabular">
                          {badge}
                        </span>
                      ) : null}
                    </span>
                    <span className="max-w-full truncate px-1">{item.label}</span>
                  </Link>
                </li>
              );
            })}
            <li className="min-w-0">
              <button
                type="button"
                onClick={() => setMobileNavOpen(true)}
                aria-expanded={mobileNavOpen}
                className={cn(
                  "flex h-14 w-full flex-col items-center justify-center gap-0.5 text-xs transition-colors",
                  moreActive ? "font-medium text-primary" : "text-muted-foreground",
                )}
              >
                <Menu className="size-5" aria-hidden />
                <span>More</span>
              </button>
            </li>
          </ul>
        </nav>

        {/* ── Full navigation sheet (phones/tablets) ── */}
        <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
          <SheetContent side="left" className="console-theme admin-console flex w-72 flex-col p-0 lg:hidden">
            <div className="flex h-14 shrink-0 items-center border-b border-border px-4">
              <SheetTitle className="p-0">
                <AdminSidebarBrand compact />
              </SheetTitle>
            </div>
            <nav className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
              {renderNavGroups({ onNavigate: closeMobileNav })}
            </nav>
            <div className="shrink-0 border-t border-border p-3">
              <div className="flex items-center gap-3 px-1 pb-3">
                <Monogram name={adminUser?.firstName ?? adminUser?.email} className="bg-primary/10 text-primary" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{accountName}</p>
                  <p className="truncate text-xs text-muted-foreground">{adminUser?.email ?? "Admin"}</p>
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                className="w-full justify-center gap-2"
                disabled={loggingOut}
                onClick={() => {
                  closeMobileNav();
                  setSignOutConfirmOpen(true);
                }}
              >
                <LogOut className="size-4" aria-hidden />
                Sign out
              </Button>
            </div>
          </SheetContent>
        </Sheet>
      </div>

      <ConfirmDialog
        open={signOutConfirmOpen}
        onOpenChange={setSignOutConfirmOpen}
        title="Sign out?"
        description="You will need your password and a login code to get back in."
        confirmLabel="Sign out"
        icon={LogOut}
        onConfirm={async () => {
          await handleLogout();
        }}
      />

      <AdminIdleTimeoutModal />
      {searchOpen ? <AdminSearchPanel onClose={() => setSearchOpen(false)} /> : null}
    </TooltipProvider>
  );
}

/** Store logo; falls back to the store's initial when the image is missing or fails to load. */
function AdminBrandMark() {
  const [failed, setFailed] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const storeName = process.env.NEXT_PUBLIC_STORE_NAME ?? "Store";
  // A load error can fire before hydration attaches onError; catch it after mount.
  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;
    if (img.complete && img.naturalWidth === 0) {
      setFailed(true);
      return;
    }
    const onError = () => setFailed(true);
    img.addEventListener("error", onError);
    // The error can also land between commit and this effect; re-check once settled.
    const settle = window.setTimeout(() => {
      if (img.complete && img.naturalWidth === 0) setFailed(true);
    }, 1500);
    return () => {
      img.removeEventListener("error", onError);
      window.clearTimeout(settle);
    };
  }, []);
  if (failed) {
    return <Monogram name={storeName} className="rounded-lg bg-primary text-primary-foreground" />;
  }
  return (
    <span className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-card">
      <Image
        ref={imgRef}
        src={BRAND_LOGO_SRC}
        alt=""
        width={32}
        height={32}
        loading="eager"
        className="object-contain"
        onError={() => setFailed(true)}
      />
    </span>
  );
}

function AdminSidebarBrand({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/admin" className="flex min-w-0 items-center gap-2.5" aria-label="Admin home">
      <AdminBrandMark />
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-semibold leading-tight text-foreground">
          {process.env.NEXT_PUBLIC_STORE_NAME ?? "Store"}
        </span>
        {compact ? null : <span className="text-xs leading-tight text-muted-foreground">Admin</span>}
      </span>
    </Link>
  );
}
