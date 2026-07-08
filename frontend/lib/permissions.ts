/** Merchant admin permission tokens — must match backend admin-permissions.ts */
export const ADMIN_PERMISSIONS = {
  ordersRead: "orders:read",
  ordersWrite: "orders:write",
  ordersExport: "orders:export",
  ordersRefund: "orders:refund",
  ordersNotify: "orders:notify",
  productsRead: "products:read",
  productsWrite: "products:write",
  categoriesRead: "categories:read",
  categoriesWrite: "categories:write",
  inventoryRead: "inventory:read",
  inventoryWrite: "inventory:write",
  usersRead: "users:read",
  usersWrite: "users:write",
  settingsRead: "settings:read",
  settingsWrite: "settings:write",
  shipmentsRead: "shipments:read",
  paymentsRead: "payments:read",
  reviewsRead: "reviews:read",
  reviewsModerate: "reviews:moderate",
  couponsRead: "coupons:read",
  couponsWrite: "coupons:write",
  dashboardRead: "dashboard:read",
  analyticsRead: "analytics:read",
  analyticsExport: "analytics:export",
  analyticsReplay: "analytics:replay",
} as const;

export function isAdminUser(user: {
  role?: string;
  permissions?: string[];
} | null): boolean {
  if (!user) return false;
  if (user.role === "ADMIN") return true;
  const perms = user.permissions ?? [];
  return perms.some(
    (p) =>
      p.startsWith("orders:") ||
      p.startsWith("products:") ||
      p.startsWith("categories:") ||
      p.startsWith("inventory:") ||
      p.startsWith("users:") ||
      p.startsWith("settings:") ||
      p.startsWith("shipments:") ||
      p.startsWith("payments:") ||
      p.startsWith("reviews:") ||
      p.startsWith("coupons:") ||
      p.startsWith("analytics:"),
  );
}

export function canAccessAdmin(user: {
  role?: string;
  permissions?: string[];
} | null): boolean {
  return isAdminUser(user);
}

export function hasAdminPermission(
  user: { role?: string; permissions?: string[] } | null,
  permission: string,
): boolean {
  if (!user) return false;
  if (user.role === "ADMIN") return true;
  const permissions = user.permissions ?? [];
  return permissions.includes("*") || permissions.includes(permission);
}

function hasPermissionPrefix(
  user: { role?: string; permissions?: string[] } | null,
  prefix: string,
): boolean {
  if (!user) return false;
  if (user.role === "ADMIN") return true;
  const permissions = user.permissions ?? [];
  return permissions.includes("*") || permissions.some((permission) => permission.startsWith(prefix));
}

export type AdminRouteKey =
  | "dashboard"
  | "orders"
  | "products"
  | "categories"
  | "inventory"
  | "customers"
  | "returns"
  | "shipments"
  | "payments"
  | "reviews"
  | "coupons"
  | "mutations"
  | "gallery"
  | "settings";

export function canViewAdminRoute(
  user: { role?: string; permissions?: string[] } | null,
  route: AdminRouteKey,
): boolean {
  if (user?.role === "ADMIN") {
    return true;
  }

  switch (route) {
    case "dashboard":
      return (
        hasPermissionPrefix(user, "orders:") ||
        hasPermissionPrefix(user, "products:") ||
        hasPermissionPrefix(user, "categories:") ||
        hasPermissionPrefix(user, "inventory:") ||
        hasPermissionPrefix(user, "users:") ||
        hasPermissionPrefix(user, "settings:") ||
        hasPermissionPrefix(user, "analytics:")
      );
    case "orders":
    case "returns":
    case "mutations":
      return hasPermissionPrefix(user, "orders:");
    case "shipments":
      return hasAdminPermission(user, ADMIN_PERMISSIONS.shipmentsRead);
    case "payments":
      return hasAdminPermission(user, ADMIN_PERMISSIONS.paymentsRead);
    case "categories":
      return hasPermissionPrefix(user, "categories:") || hasPermissionPrefix(user, "products:");
    case "products":
    case "coupons":
      return hasPermissionPrefix(user, "products:") || hasPermissionPrefix(user, "coupons:");
    case "reviews":
      return hasPermissionPrefix(user, "reviews:");
    case "inventory":
      return hasPermissionPrefix(user, "inventory:");
    case "customers":
      return hasPermissionPrefix(user, "users:");
    case "gallery":
    case "settings":
      return hasPermissionPrefix(user, "settings:");
    default:
      return false;
  }
}

export function resolveAdminRouteFromPathname(pathname: string): AdminRouteKey | null {
  if (pathname === "/admin" || pathname === "/admin/") {
    return "dashboard";
  }
  if (pathname.startsWith("/admin/orders")) {
    return "orders";
  }
  if (pathname.startsWith("/admin/shipments")) {
    return "shipments";
  }
  if (pathname.startsWith("/admin/payments")) {
    return "payments";
  }
  if (pathname.startsWith("/admin/catalog-write") || pathname.startsWith("/admin/products")) {
    return "products";
  }
  if (pathname.startsWith("/admin/categories")) {
    return "categories";
  }
  if (pathname.startsWith("/admin/inventory")) {
    return "inventory";
  }
  if (pathname.startsWith("/admin/customers")) {
    return "customers";
  }
  if (pathname.startsWith("/admin/returns")) {
    return "returns";
  }
  if (pathname.startsWith("/admin/reviews")) {
    return "reviews";
  }
  if (pathname.startsWith("/admin/coupons")) {
    return "coupons";
  }
  if (pathname.startsWith("/admin/mutations")) {
    return "mutations";
  }
  if (pathname.startsWith("/admin/gallery")) {
    return "gallery";
  }
  if (pathname.startsWith("/admin/analytics")) {
    return "dashboard";
  }
  if (pathname.startsWith("/admin/settings")) {
    return "settings";
  }
  return null;
}

export function canViewAdminPath(
  user: { role?: string; permissions?: string[] } | null,
  pathname: string,
): boolean {
  const route = resolveAdminRouteFromPathname(pathname);
  if (!route) {
    return canAccessAdmin(user);
  }
  return canViewAdminRoute(user, route);
}
