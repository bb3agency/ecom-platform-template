/** Cross-component refresh signals for admin KPI cards and summary panels. */

export type AdminDataScope =
  | "dashboard"
  | "orders"
  | "shipments"
  | "payments"
  | "products"
  | "categories"
  | "inventory"
  | "customers"
  | "reviews"
  | "coupons"
  | "analytics";

export const ADMIN_DASHBOARD_REFRESH_SCOPES: AdminDataScope[] = [
  "dashboard",
  "orders",
  "shipments",
  "payments",
  "products",
  "categories",
  "inventory",
  "customers",
  "reviews",
  "coupons",
  "analytics",
];

type RefreshListener = () => void;

const listeners = new Map<AdminDataScope, Set<RefreshListener>>();

function normalizeScopes(
  scope: AdminDataScope | AdminDataScope[],
): AdminDataScope[] {
  return Array.isArray(scope) ? scope : [scope];
}

export function subscribeAdminDataRefresh(
  scope: AdminDataScope | AdminDataScope[],
  listener: RefreshListener,
): () => void {
  const scopes = normalizeScopes(scope);
  for (const key of scopes) {
    if (!listeners.has(key)) {
      listeners.set(key, new Set());
    }
    listeners.get(key)!.add(listener);
  }

  return () => {
    for (const key of scopes) {
      listeners.get(key)?.delete(listener);
    }
  };
}

export function notifyAdminDataChanged(
  scope: AdminDataScope | AdminDataScope[],
): void {
  const seen = new Set<RefreshListener>();
  for (const key of normalizeScopes(scope)) {
    for (const listener of listeners.get(key) ?? []) {
      if (seen.has(listener)) continue;
      seen.add(listener);
      listener();
    }
  }
}
