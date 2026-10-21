import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  Box,
  ClipboardList,
  Images,
  LayoutDashboard,
  Percent,
  RefreshCcw,
  Settings,
  ShoppingCart,
  Star,
  Truck,
  Users,
  Wallet,
  Layers
} from "lucide-react";
import type { AdminRouteKey } from "@/lib/permissions";

export type AdminNavGroup = "overview" | "sell" | "catalog" | "customers" | "store";

/** Section headings in the sidebar, in display order. */
export const ADMIN_NAV_GROUPS: { id: AdminNavGroup; label: string | null }[] = [
  { id: "overview", label: null },
  { id: "sell", label: "Sales" },
  { id: "catalog", label: "Catalog" },
  { id: "customers", label: "Customers" },
  { id: "store", label: "Store" },
];

export interface AdminNavItem {
  href: string;
  label: string;
  description: string;
  icon: LucideIcon;
  routeKey: AdminRouteKey;
  group: AdminNavGroup;
  /** Shown in the phone bottom tab bar (max 4; the 5th slot is "More"). */
  mobileTab?: boolean;
}

export const ADMIN_NAV_ITEMS: AdminNavItem[] = [
  {
    href: "/admin",
    label: "Dashboard",
    description: "Overview and core metrics",
    icon: LayoutDashboard,
    routeKey: "dashboard",
    group: "overview",
    mobileTab: true,
  },
  {
    href: "/admin/orders",
    label: "Orders",
    description: "Manage and process orders",
    icon: ShoppingCart,
    routeKey: "orders",
    group: "sell",
    mobileTab: true,
  },
  {
    href: "/admin/shipments",
    label: "Shipments",
    description: "Fulfillment and tracking",
    icon: Truck,
    routeKey: "shipments",
    group: "sell",
  },
  {
    href: "/admin/payments",
    label: "Payments",
    description: "Refunds and payment states",
    icon: Wallet,
    routeKey: "payments",
    group: "sell",
  },
  {
    href: "/admin/returns",
    label: "Returns",
    description: "Customer return requests",
    icon: RefreshCcw,
    routeKey: "returns",
    group: "sell",
  },
  {
    href: "/admin/products",
    label: "Products",
    description: "Catalog and variants",
    icon: Box,
    routeKey: "products",
    group: "catalog",
    mobileTab: true,
  },
  {
    href: "/admin/categories",
    label: "Categories",
    description: "Product taxonomy",
    icon: Layers,
    routeKey: "categories",
    group: "catalog",
  },
  {
    href: "/admin/inventory",
    label: "Inventory",
    description: "Stock levels and alerts",
    icon: ClipboardList,
    routeKey: "inventory",
    group: "catalog",
  },
  {
    href: "/admin/customers",
    label: "Customers",
    description: "User accounts and addresses",
    icon: Users,
    routeKey: "customers",
    group: "customers",
    mobileTab: true,
  },
  {
    href: "/admin/reviews",
    label: "Reviews",
    description: "Moderate product reviews",
    icon: Star,
    routeKey: "reviews",
    group: "customers",
  },
  {
    href: "/admin/coupons",
    label: "Coupons",
    description: "Discounts and campaigns",
    icon: Percent,
    routeKey: "coupons",
    group: "customers",
  },
  {
    href: "/admin/analytics",
    label: "Analytics",
    description: "Deep dive reporting",
    icon: BarChart3,
    routeKey: "dashboard",
    group: "overview",
  },
  {
    href: "/admin/gallery",
    label: "Gallery",
    description: "Brand and farm images",
    icon: Images,
    routeKey: "gallery",
    group: "catalog",
  },
  {
    href: "/admin/settings",
    label: "Settings",
    description: "Store profile and config",
    icon: Settings,
    routeKey: "settings",
    group: "store",
  },
];

const DEV_NAV_ITEMS: AdminNavItem[] = [
  {
    href: "/admin/catalog-write",
    label: "Catalog write",
    description: "JSON catalog mutations",
    icon: Layers,
    routeKey: "products",
    group: "store",
  },
  {
    href: "/admin/mutations",
    label: "Mutations",
    description: "Direct backend actions",
    icon: Layers,
    routeKey: "mutations",
    group: "store",
  },
];

export function getAdminNavItems(): AdminNavItem[] {
  if (process.env.NEXT_PUBLIC_ADMIN_DEV_TOOLS === "true") {
    return [...ADMIN_NAV_ITEMS, ...DEV_NAV_ITEMS];
  }
  return ADMIN_NAV_ITEMS;
}

export function isAdminNavActive(pathname: string, href: string): boolean {
  if (href === "/admin") {
    return pathname === "/admin";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}
