"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { LogOut, Menu, Shield, X } from "lucide-react";
import { OPS_NAV_ITEMS, isOpsNavActive } from "@/components/ops/ops-nav-config";
import { OpsSessionProvider } from "@/components/ops/OpsSessionProvider";
import { OpsBadge, OpsLoadingBlock } from "@/components/ops/ui/ops-ui";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  getOpsSessionClient,
  isOpsUnauthorisedError,
  logoutOpsSession,
  type OpsSession,
} from "@/lib/ops-client-api";

interface OpsConsoleShellProps {
  children: ReactNode;
}

export function OpsConsoleShell({ children }: OpsConsoleShellProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [session, setSession] = useState<OpsSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [loggingOut, setLoggingOut] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const nextSession = await getOpsSessionClient();
        if (!cancelled) {
          setSession(nextSession);
        }
      } catch (err) {
        if (!cancelled) {
          setSession(null);
          if (isOpsUnauthorisedError(err)) {
            router.replace("/ops/login");
          }
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [router]);

  const closeMobileNav = () => setMobileNavOpen(false);

  useEffect(() => {
    if (!mobileNavOpen) {
      return;
    }
    const scrollY = window.scrollY;
    const { style } = document.body;
    const previous = {
      position: style.position,
      top: style.top,
      left: style.left,
      right: style.right,
      overflow: style.overflow,
      width: style.width,
    };
    style.position = "fixed";
    style.top = `-${scrollY}px`;
    style.left = "0";
    style.right = "0";
    style.width = "100%";
    style.overflow = "hidden";
    return () => {
      style.position = previous.position;
      style.top = previous.top;
      style.left = previous.left;
      style.right = previous.right;
      style.overflow = previous.overflow;
      style.width = previous.width;
      window.scrollTo(0, scrollY);
    };
  }, [mobileNavOpen]);

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await logoutOpsSession();
    } finally {
      router.replace("/ops/login");
      setLoggingOut(false);
    }
  }

  if (loading) {
    return (
      <div className="dark ops-console flex min-h-dvh w-full items-center justify-center bg-background">
        <OpsLoadingBlock label="Authenticating ops session…" />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="dark ops-console flex min-h-dvh w-full items-center justify-center bg-background">
        <OpsLoadingBlock label="Redirecting to sign in…" />
      </div>
    );
  }

  const canWrite = session.permissions.includes("ops:write");

  return (
    <OpsSessionProvider session={session}>
      <div className="dark ops-console flex h-dvh max-h-dvh w-full max-w-[100vw] overflow-hidden bg-background text-foreground">
        {/* Desktop sidebar */}
        <aside
          className="hidden h-full min-h-0 w-64 shrink-0 flex-col overflow-hidden border-r border-border/60 bg-sidebar lg:flex"
          aria-label="Ops navigation"
        >
          <OpsSidebarBrand />
          <nav className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-3 py-4 [-webkit-overflow-scrolling:touch]">
            <div className="flex flex-col gap-1">
            {OPS_NAV_ITEMS.map((item) => (
              <OpsNavLink
                key={item.href}
                item={item}
                active={isOpsNavActive(pathname, item.href)}
                onNavigate={closeMobileNav}
              />
            ))}
            </div>
          </nav>
          <OpsSidebarFooter
            session={session}
            canWrite={canWrite}
            loggingOut={loggingOut}
            onLogout={() => void handleLogout()}
          />
        </aside>

        {/* Mobile drawer — scroll only inside nav; backdrop does not scroll */}
        {mobileNavOpen ? (
          <button
            type="button"
            className="fixed inset-0 z-40 touch-none bg-background/80 backdrop-blur-sm lg:hidden"
            aria-label="Close navigation"
            onClick={() => setMobileNavOpen(false)}
          />
        ) : null}
        <aside
          className={cn(
            "fixed inset-y-0 left-0 z-50 flex h-dvh max-h-dvh w-[min(20rem,calc(100vw-1rem))] max-w-full flex-col overflow-hidden border-r border-border/60 bg-sidebar shadow-xl transition-transform duration-300 lg:hidden",
            mobileNavOpen ? "translate-x-0" : "pointer-events-none -translate-x-full",
          )}
          aria-hidden={!mobileNavOpen}
          aria-label="Ops mobile navigation"
        >
          <div className="flex shrink-0 items-center justify-between border-b border-border/60 px-4 py-4 pt-[max(1rem,env(safe-area-inset-top))]">
            <OpsSidebarBrand compact />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setMobileNavOpen(false)}
              aria-label="Close menu"
            >
              <X className="size-5" />
            </Button>
          </div>
          <nav className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-3 py-4 [-webkit-overflow-scrolling:touch]">
            <div className="flex flex-col gap-1 pb-2">
              {OPS_NAV_ITEMS.map((item) => (
                <OpsNavLink
                  key={item.href}
                  item={item}
                  active={isOpsNavActive(pathname, item.href)}
                  onNavigate={closeMobileNav}
                />
              ))}
            </div>
          </nav>
          <div className="shrink-0 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <OpsSidebarFooter
              session={session}
              canWrite={canWrite}
              loggingOut={loggingOut}
              onLogout={() => void handleLogout()}
            />
          </div>
        </aside>

        <div
          className={cn(
            "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden",
            mobileNavOpen && "max-lg:pointer-events-none max-lg:touch-none",
          )}
          aria-hidden={mobileNavOpen}
        >
          <header className="z-30 flex shrink-0 items-center justify-between gap-2 border-b border-border/60 bg-background/90 px-3 py-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:gap-3 sm:px-4 lg:px-8">
            <div className="flex items-center gap-3">
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="lg:hidden"
                onClick={() => setMobileNavOpen(true)}
                aria-label="Open navigation"
              >
                <Menu className="size-5" />
              </Button>
              <div className="lg:hidden">
                <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                  Control plane
                </p>
                <p className="font-heading text-sm font-semibold">Raghava Ops</p>
              </div>
            </div>
            <div className="flex min-w-0 items-center gap-2">
              <OpsBadge tone={canWrite ? "info" : "muted"}>
                {canWrite ? "ops:write" : "ops:read"}
              </OpsBadge>
              <span className="hidden truncate text-sm text-muted-foreground sm:inline">
                {session.email}
              </span>
            </div>
          </header>

          <main className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-y-contain px-3 py-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] [-webkit-overflow-scrolling:touch] sm:px-4 sm:py-6 lg:px-8 lg:py-10">
            <div className="mx-auto w-full min-w-0 max-w-6xl">{children}</div>
          </main>
        </div>
      </div>
    </OpsSessionProvider>
  );
}

interface OpsSidebarBrandProps {
  compact?: boolean;
}

function OpsSidebarBrand({ compact = false }: OpsSidebarBrandProps) {
  return (
    <div className={cn("border-b border-border/60 px-4", compact ? "py-0" : "py-5")}>
      <div className="flex items-center gap-3">
        <div className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
          <Shield className="size-5" aria-hidden />
        </div>
        {!compact ? (
          <div>
            <p className="font-heading text-base font-semibold">Ops Console</p>
            <p className="text-xs text-muted-foreground">Platform control plane</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

interface OpsNavLinkProps {
  item: (typeof OPS_NAV_ITEMS)[number];
  active: boolean;
  onNavigate?: () => void;
}

function OpsNavLink({ item, active, onNavigate }: OpsNavLinkProps) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      className={cn(
        "group flex items-start gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors",
        active
          ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-sm"
          : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
      )}
    >
      <Icon
        className={cn(
          "mt-0.5 size-4 shrink-0",
          active ? "text-primary" : "text-muted-foreground group-hover:text-foreground",
        )}
        aria-hidden
      />
      <span className="grid gap-0.5">
        <span className="font-medium leading-none">{item.label}</span>
        <span className="text-xs leading-snug opacity-80">{item.description}</span>
      </span>
    </Link>
  );
}

interface OpsSidebarFooterProps {
  session: OpsSession;
  canWrite: boolean;
  loggingOut: boolean;
  onLogout: () => void;
}

function OpsSidebarFooter({ session, canWrite, loggingOut, onLogout }: OpsSidebarFooterProps) {
  return (
    <div className="border-t border-border/60 p-4">
      <div className="mb-3 rounded-lg bg-muted/40 px-3 py-2.5">
        <p className="truncate text-sm font-medium text-foreground">{session.name}</p>
        <p className="truncate text-xs text-muted-foreground">{session.email}</p>
        <div className="mt-2 flex flex-wrap gap-1">
          <OpsBadge tone={canWrite ? "info" : "muted"}>
            {canWrite ? "Write access" : "Read only"}
          </OpsBadge>
          {session.mfaEnabled ? <OpsBadge tone="success">MFA</OpsBadge> : null}
        </div>
      </div>
      <Button
        type="button"
        variant="outline"
        className="w-full justify-center gap-2"
        onClick={onLogout}
        disabled={loggingOut}
      >
        <LogOut className="size-4" />
        {loggingOut ? "Signing out…" : "Sign out"}
      </Button>
    </div>
  );
}
