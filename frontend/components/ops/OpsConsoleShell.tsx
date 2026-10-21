"use client";

/**
 * Ops console chrome. Spec: docs/CONSOLE_DESIGN_SYSTEM.md → Shell.
 *
 *  - lg+: 240px sidebar (collapsible to a 64px icon rail) + 56px top bar.
 *  - below lg: top bar + bottom tab bar (4 most-used destinations + "More" sheet).
 *  - `main` is the only scroll container; the page never scrolls sideways.
 *
 * The session is cookie-only (`GET /ops/session` with credentials: "include");
 * a 401 sends the operator to /ops/login before any console UI renders.
 * The traffic mode is polled here so every screen shows a maintenance warning.
 */

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { LogOut, Menu, PanelLeftClose, PanelLeftOpen, ShieldCheck, TriangleAlert } from "lucide-react";
import { OPS_NAV_GROUPS, OPS_TAB_ITEMS, isOpsNavActive, type OpsNavItem } from "@/components/ops/ops-nav-config";
import { OpsSessionProvider } from "@/components/ops/OpsSessionProvider";
import { OPS_POPUP_CLASS, formatClock, useSecondsUntil } from "@/components/ops/ui/ops-ui";
import { Monogram, StatusDot } from "@/components/ui/console";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { loadShedLabel, loadShedTone } from "@/lib/ops-status-maps";
import {
  getOpsLoadShedStatusClient,
  getOpsSessionClient,
  isOpsUnauthorisedError,
  logoutOpsSession,
  type OpsLoadShedStatus,
  type OpsSession,
} from "@/lib/ops-client-api";

const SIDEBAR_STORAGE_KEY = "ops-console:sidebar-collapsed";
const LOAD_SHED_POLL_MS = 30_000;
const LOAD_SHED_PENDING_POLL_MS = 5_000;

function readCollapsed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

interface OpsConsoleShellProps {
  children: ReactNode;
}

export function OpsConsoleShell({ children }: OpsConsoleShellProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [session, setSession] = useState<OpsSession | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [loadShed, setLoadShed] = useState<OpsLoadShedStatus | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getOpsSessionClient()
      .then((next) => {
        if (!cancelled) {
          setSession(next);
          setSessionError(null);
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (isOpsUnauthorisedError(err)) {
          router.replace("/ops/login");
          return;
        }
        setSessionError("The ops API didn't respond. Check that the backend is running, then try again.");
      });
    return () => {
      cancelled = true;
    };
  }, [router, attempt]);

  const refreshLoadShed = useCallback(async () => {
    try {
      setLoadShed(await getOpsLoadShedStatusClient());
    } catch (err) {
      if (isOpsUnauthorisedError(err)) router.replace("/ops/login");
      // Other failures: keep the last known mode; the next poll retries.
    }
  }, [router]);

  const pending = loadShed?.mode === "maintenance" && loadShed.phase === "pending";
  useEffect(() => {
    if (!session) return;
    void refreshLoadShed();
    const timer = window.setInterval(() => void refreshLoadShed(), pending ? LOAD_SHED_PENDING_POLL_MS : LOAD_SHED_POLL_MS);
    return () => window.clearInterval(timer);
  }, [session, pending, refreshLoadShed]);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(SIDEBAR_STORAGE_KEY, next ? "1" : "0");
      } catch {
        // Storage blocked — the preference just won't persist.
      }
      return next;
    });
  }

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await logoutOpsSession();
    } finally {
      router.replace("/ops/login");
    }
  }

  if (!session) {
    return (
      <div className="console-theme ops-console flex min-h-dvh w-full items-center justify-center bg-background px-4 text-foreground">
        {sessionError ? (
          <div className="flex max-w-sm flex-col items-center gap-3 text-center" role="alert">
            <TriangleAlert className="size-6 text-destructive" aria-hidden />
            <p className="text-sm text-foreground">{sessionError}</p>
            <Button type="button" variant="outline" onClick={() => setAttempt((n) => n + 1)}>
              Try again
            </Button>
          </div>
        ) : (
          <p className="flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
            <span className="size-2 animate-pulse rounded-full bg-primary" aria-hidden />
            Checking your ops session…
          </p>
        )}
      </div>
    );
  }

  return (
    <OpsSessionProvider session={session} loadShed={loadShed} refreshLoadShed={refreshLoadShed}>
      <div className="console-theme ops-console flex h-dvh w-full overflow-hidden bg-background text-foreground">
        {/* Desktop sidebar */}
        <aside
          aria-label="Ops navigation"
          className={cn(
            "hidden h-full min-h-0 shrink-0 flex-col border-r border-border bg-sidebar transition-[width] duration-200 lg:flex",
            collapsed ? "w-16" : "w-60",
          )}
        >
          <div className={cn("flex h-14 shrink-0 items-center gap-2.5 border-b border-border", collapsed ? "justify-center px-2" : "px-4")}>
            <BrandMark />
            {!collapsed ? (
              <div className="min-w-0 leading-tight">
                <p className="truncate text-sm font-semibold text-foreground">Ops console</p>
                <p className="truncate text-xs text-muted-foreground">Platform control</p>
              </div>
            ) : null}
          </div>
          <nav className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-3">
            <NavGroups pathname={pathname} collapsed={collapsed} />
          </nav>
          <div className={cn("shrink-0 border-t border-border p-2", collapsed ? "flex justify-center" : "")}>
            <Button
              type="button"
              variant="ghost"
              onClick={toggleCollapsed}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              className={cn("h-9 gap-2 text-muted-foreground", collapsed ? "w-9 px-0" : "w-full justify-start px-2.5")}
            >
              {collapsed ? <PanelLeftOpen aria-hidden /> : <PanelLeftClose aria-hidden />}
              {!collapsed ? <span>Collapse</span> : null}
            </Button>
          </div>
        </aside>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border bg-card px-4 sm:px-6 lg:px-8">
            <Link href="/ops" className="flex min-w-0 items-center gap-2.5 lg:hidden" aria-label="Ops console overview">
              <BrandMark />
              <span className="truncate text-sm font-semibold text-foreground">Ops console</span>
            </Link>
            <div className="hidden min-w-0 lg:block" />
            <div className="flex min-w-0 items-center gap-2 sm:gap-3">
              {loadShed ? (
                <Link
                  href="/ops/load-shed"
                  className="flex h-9 min-w-0 items-center rounded-full border border-border px-3 text-sm transition-colors hover:bg-muted"
                  title="Traffic mode"
                >
                  <StatusDot tone={loadShedTone(loadShed.mode)} className="min-w-0">
                    <span className="truncate">
                      <span className="sr-only">Traffic mode: </span>
                      {loadShedLabel(loadShed)}
                    </span>
                  </StatusDot>
                </Link>
              ) : null}
              <AccountMenu session={session} loggingOut={loggingOut} onLogout={() => void handleLogout()} />
            </div>
          </header>

          {loadShed?.mode === "maintenance" ? <MaintenanceStrip status={loadShed} /> : null}

          <main
            id="ops-main"
            className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain px-4 py-5 sm:px-6 sm:py-6 lg:px-8 lg:py-8"
          >
            {children}
          </main>

          {/* Phone/tablet tab bar */}
          <nav aria-label="Ops sections" className="console-tabbar shrink-0 border-t border-border bg-card lg:hidden">
            <ul className="mx-auto grid max-w-lg grid-cols-5">
              {OPS_TAB_ITEMS.map((item) => (
                <li key={item.href} className="min-w-0">
                  <TabLink item={item} active={isOpsNavActive(pathname, item.href)} />
                </li>
              ))}
              <li className="min-w-0">
                <button
                  type="button"
                  onClick={() => setMoreOpen(true)}
                  aria-haspopup="dialog"
                  className={cn(
                    "flex h-14 w-full flex-col items-center justify-center gap-0.5 text-xs font-medium transition-colors",
                    isMoreActive(pathname) ? "text-primary" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Menu className="size-5" aria-hidden />
                  More
                </button>
              </li>
            </ul>
          </nav>
        </div>

        <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
          <SheetContent side="bottom" className={OPS_POPUP_CLASS}>
            <SheetHeader>
              <SheetTitle>All sections</SheetTitle>
            </SheetHeader>
            <SheetBody className="px-3 pb-6">
              <NavGroups pathname={pathname} collapsed={false} onNavigate={() => setMoreOpen(false)} />
            </SheetBody>
          </SheetContent>
        </Sheet>
      </div>
    </OpsSessionProvider>
  );
}

function isMoreActive(pathname: string): boolean {
  return !OPS_TAB_ITEMS.some((item) => isOpsNavActive(pathname, item.href));
}

function BrandMark() {
  return (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground" aria-hidden>
      <ShieldCheck className="size-4" />
    </span>
  );
}

function NavGroups({
  pathname,
  collapsed,
  onNavigate,
}: {
  pathname: string;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      {OPS_NAV_GROUPS.map((group) => (
        <div key={group.label} className="flex flex-col gap-0.5">
          {collapsed ? (
            <span className="mx-auto mb-1 h-px w-6 bg-border first:hidden" aria-hidden />
          ) : (
            <p className="px-2.5 pb-1 text-xs font-medium text-muted-foreground">{group.label}</p>
          )}
          {group.items.map((item) => (
            <NavLink
              key={item.href}
              item={item}
              active={isOpsNavActive(pathname, item.href)}
              collapsed={collapsed}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function NavLink({
  item,
  active,
  collapsed,
  onNavigate,
}: {
  item: OpsNavItem;
  active: boolean;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      title={collapsed ? item.label : undefined}
      aria-label={collapsed ? item.label : undefined}
      className={cn(
        "relative flex h-10 items-center gap-3 rounded-lg text-sm transition-colors",
        collapsed ? "mx-auto w-10 justify-center" : "px-2.5",
        active
          ? "bg-sidebar-accent font-medium text-foreground"
          : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
      )}
    >
      {active && !collapsed ? (
        <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-primary" aria-hidden />
      ) : null}
      <Icon className={cn("size-4 shrink-0", active ? "text-primary" : "")} aria-hidden />
      {!collapsed ? <span className="truncate">{item.label}</span> : null}
    </Link>
  );
}

function TabLink({ item, active }: { item: OpsNavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-14 w-full flex-col items-center justify-center gap-0.5 text-xs font-medium transition-colors",
        active ? "text-primary" : "text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon className="size-5" aria-hidden />
      <span className="max-w-full truncate px-1">{item.shortLabel ?? item.label}</span>
    </Link>
  );
}

function AccountMenu({
  session,
  loggingOut,
  onLogout,
}: {
  session: OpsSession;
  loggingOut: boolean;
  onLogout: () => void;
}) {
  const canWrite = session.permissions.includes("ops:write");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex h-9 min-w-0 items-center gap-2 rounded-full pr-1 text-sm outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring sm:pr-3"
        aria-label={`Account: ${session.name}`}
      >
        <Monogram name={session.name} className="bg-primary/10 text-primary" />
        <span className="hidden max-w-40 truncate font-medium text-foreground sm:inline">{session.name}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className={cn(OPS_POPUP_CLASS, "w-64")}>
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex flex-col gap-0.5 px-2 py-2">
            <span className="truncate text-sm font-medium text-foreground">{session.name}</span>
            <span className="truncate text-xs font-normal text-muted-foreground" title={session.email}>
              {session.email}
            </span>
            <span className="pt-1 text-xs font-normal text-muted-foreground">
              {canWrite ? "Can view and change settings" : "View only"}
              {session.mfaEnabled ? " · MFA on" : ""}
            </span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onLogout} disabled={loggingOut} className="h-9 px-2">
          <LogOut aria-hidden />
          {loggingOut ? "Signing out…" : "Sign out"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Console-wide warning while maintenance is starting or active. */
function MaintenanceStrip({ status }: { status: OpsLoadShedStatus }) {
  const seconds = useSecondsUntil(status.phase === "pending" ? status.pendingUntil : null);
  const pending = status.phase === "pending";
  return (
    <div className="console-notice shrink-0 border-x-0 border-t-0 px-4 py-2 text-sm sm:px-6 lg:px-8" data-tone={pending ? "warning" : "danger"} role="status">
      <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <TriangleAlert className="size-4 shrink-0" aria-hidden />
        <span className="font-medium">
          {pending
            ? `Storefront goes into maintenance in ${seconds != null ? formatClock(seconds) : "a moment"}.`
            : "Storefront is in maintenance — shoppers see the maintenance page."}
        </span>
        <Link href="/ops/load-shed" className="font-medium text-primary underline-offset-4 hover:underline">
          {pending ? "Cancel or change" : "Restore traffic"}
        </Link>
      </p>
    </div>
  );
}
