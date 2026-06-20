"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Store, Truck, ClipboardList, Wallet, Bell, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

const SETTINGS_LINKS = [
  {
    href: "/admin/settings/store",
    label: "Store Profile",
    description: "Name, contact, compliance IDs",
    icon: Store,
  },
  {
    href: "/admin/settings/shipping",
    label: "Shipping",
    description: "Pickup pincode and minimum order",
    icon: Truck,
  },
  {
    href: "/admin/settings/inventory",
    label: "Inventory",
    description: "Default low-stock threshold",
    icon: ClipboardList,
  },
  {
    href: "/admin/settings/cod",
    label: "Cash on Delivery",
    description: "COD enablement and cancellation",
    icon: Wallet,
  },
  {
    href: "/admin/settings/notifications",
    label: "Notifications",
    description: "Channels and per-template routing",
    icon: Bell,
  },
];

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // Find active label for breadcrumbs / mobile header
  const activeLink = SETTINGS_LINKS.find((link) => pathname === link.href) || SETTINGS_LINKS[0];

  return (
    <div className="flex flex-col gap-4 sm:gap-6">
      {/* Sitemap / Breadcrumbs */}
      <div className="flex items-center gap-1.5 sm:gap-2 overflow-x-auto text-xs sm:text-sm text-muted-foreground scrollbar-none whitespace-nowrap">
        <Link href="/admin" className="shrink-0 hover:text-foreground transition-colors">
          Dashboard
        </Link>
        <ChevronRight className="h-3.5 w-3.5 sm:h-4 sm:w-4 shrink-0 text-muted-foreground/60" />
        <Link href="/admin/settings" className="shrink-0 hover:text-foreground transition-colors">
          Settings
        </Link>
        <ChevronRight className="h-3.5 w-3.5 sm:h-4 sm:w-4 shrink-0 text-muted-foreground/60" />
        <span className="shrink-0 text-foreground font-medium">{activeLink.label}</span>
      </div>

      <header className="border-b border-border pb-3 sm:pb-4">
        <h1 className="font-heading text-xl sm:text-2xl font-bold tracking-tight text-foreground">
          Settings
        </h1>
        <p className="mt-1 text-xs sm:text-sm text-muted-foreground">
          Manage your store profile, inventory thresholds, shipping details, and payment options.
        </p>
      </header>

      {/* Settings Grid Workspace */}
      <div className="grid gap-4 sm:gap-6 lg:grid-cols-4 items-start">
        {/* Navigation Sidebar */}
        <aside className="lg:col-span-1 min-w-0 overflow-hidden">
          {/* Desktop Nav */}
          <nav className="hidden lg:flex flex-col gap-1.5 rounded-xl border border-border bg-card p-2 shadow-xs">
            {SETTINGS_LINKS.map((item) => {
              const Icon = item.icon;
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200",
                    isActive
                      ? "bg-primary text-primary-foreground shadow-xs"
                      : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                  )}
                >
                  <Icon className={cn("h-4 w-4 shrink-0", isActive ? "text-primary-foreground" : "text-muted-foreground")} />
                  <div className="flex flex-col text-left">
                    <span>{item.label}</span>
                    <span className={cn("text-[10px] font-normal leading-tight mt-0.5", isActive ? "text-primary-foreground/85" : "text-muted-foreground/75")}>
                      {item.description}
                    </span>
                  </div>
                </Link>
              );
            })}
          </nav>

          {/* Mobile Nav (horizontal scrollable bar) */}
          <div className="lg:hidden -mx-3 sm:-mx-4 flex overflow-x-auto gap-2 px-3 sm:px-4 pb-2 scrollbar-none">
            {SETTINGS_LINKS.map((item) => {
              const Icon = item.icon;
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex min-h-11 shrink-0 items-center gap-2 rounded-full px-4 py-2 text-xs font-medium whitespace-nowrap transition-all",
                    isActive
                      ? "bg-primary text-primary-foreground shadow-xs"
                      : "border border-border bg-card text-muted-foreground hover:bg-muted/50"
                  )}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  {item.label}
                </Link>
              );
            })}
          </div>
        </aside>

        {/* Content Pane */}
        <main className="lg:col-span-3 min-w-0">
          <div className="rounded-xl border border-border bg-card p-4 sm:p-6 shadow-xs overflow-hidden">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
