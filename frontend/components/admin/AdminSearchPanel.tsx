"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Search,
  X,
  ShoppingCart,
  Box,
  Users,
  Loader2,
  ArrowRight,
  Hash,
  Plus,
  LayoutDashboard,
  Settings,
  Truck,
  Wallet,
  RefreshCcw,
  Star,
  Percent,
  ClipboardList,
  BarChart3,
  Layers,
  ArrowUpRight,
} from "lucide-react";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import {
  coercePaginatedResponse,
  type AdminOrderListItem,
  type AdminProductListItem,
  type AdminUserListItem,
  type PaginatedResponse,
} from "@/lib/admin-api";
import { formatPaise } from "@/lib/admin-format";
import { cn } from "@/lib/utils";
import { resolveProductImageUrl } from "@/lib/media-url";

interface AdminSearchPanelProps {
  onClose: () => void;
}

interface SearchResults {
  orders: AdminOrderListItem[];
  products: AdminProductListItem[];
  customers: AdminUserListItem[];
}

interface QuickAction {
  label: string;
  description: string;
  href: string;
  icon: React.ElementType;
  keywords: string[];
}

const QUICK_ACTIONS: QuickAction[] = [
  // ── Create / Add actions ────────────────────────────────────────────────────
  {
    label: "Add Product",
    description: "Create a new product listing",
    href: "/admin/products/new",
    icon: Plus,
    keywords: [
      "add product", "new product", "create product", "product",
      "add", "create", "new listing", "upload product",
    ],
  },
  {
    label: "Add Category",
    description: "Create a new product category",
    href: "/admin/categories/new",
    icon: Plus,
    keywords: [
      "add category", "new category", "create category", "category",
      "add", "create", "new collection",
    ],
  },
  {
    label: "Create Coupon",
    description: "Set up a discount coupon",
    href: "/admin/coupons/new",
    icon: Plus,
    keywords: [
      "add coupon", "new coupon", "create coupon", "coupon", "discount",
      "add", "create", "new discount", "promo code", "voucher",
    ],
  },
  // ── Page navigation ─────────────────────────────────────────────────────────
  {
    label: "Dashboard",
    description: "Overview and key metrics",
    href: "/admin",
    icon: LayoutDashboard,
    keywords: [
      "dashboard", "home", "overview", "metrics", "stats",
      "view", "summary", "kpi", "revenue overview",
    ],
  },
  {
    label: "Orders",
    description: "View, update and manage all orders",
    href: "/admin/orders",
    icon: ShoppingCart,
    keywords: [
      "orders", "order list", "manage orders",
      "view orders", "update order", "edit order", "cancel order",
      "ship order", "fulfil order", "fulfill order", "order status",
      "manage", "update", "edit", "delete order",
    ],
  },
  {
    label: "Products",
    description: "Edit, delete and manage your product catalog",
    href: "/admin/products",
    icon: Box,
    keywords: [
      "products", "catalog", "listings", "product list",
      "edit product", "update product", "delete product", "remove product",
      "manage products", "manage", "update", "edit", "delete", "remove",
      "deactivate product", "publish product",
    ],
  },
  {
    label: "Customers",
    description: "View, ban and manage customer accounts",
    href: "/admin/customers",
    icon: Users,
    keywords: [
      "customers", "users", "accounts", "buyers",
      "view customers", "edit customer", "update customer", "ban customer",
      "unban customer", "manage customers", "customer list",
      "manage", "update", "edit", "delete", "ban", "block",
    ],
  },
  {
    label: "Inventory",
    description: "Update stock levels and adjustments",
    href: "/admin/inventory",
    icon: ClipboardList,
    keywords: [
      "inventory", "stock", "levels", "quantity",
      "update stock", "edit stock", "adjust stock", "stock adjustment",
      "update inventory", "manage inventory", "low stock", "restock",
      "manage", "update", "edit", "adjust",
    ],
  },
  {
    label: "Shipments",
    description: "Fulfillment, tracking and delivery",
    href: "/admin/shipments",
    icon: Truck,
    keywords: [
      "shipments", "shipping", "fulfillment", "tracking", "delivery",
      "update shipment", "track order", "dispatch", "courier",
      "manage shipments", "view shipments",
      "manage", "update", "view",
    ],
  },
  {
    label: "Payments",
    description: "View payment records and process refunds",
    href: "/admin/payments",
    icon: Wallet,
    keywords: [
      "payments", "refunds", "transactions", "billing",
      "view payments", "process refund", "refund order", "payment status",
      "manage payments", "update payment",
      "manage", "update", "view", "refund", "delete",
    ],
  },
  {
    label: "Returns",
    description: "Approve or reject customer return requests",
    href: "/admin/returns",
    icon: RefreshCcw,
    keywords: [
      "returns", "return requests", "refund requests",
      "approve return", "reject return", "manage returns", "view returns",
      "update return", "return status",
      "manage", "update", "view", "approve", "reject",
    ],
  },
  {
    label: "Reviews",
    description: "Moderate, approve and delete product reviews",
    href: "/admin/reviews",
    icon: Star,
    keywords: [
      "reviews", "ratings", "moderation", "feedback",
      "approve review", "reject review", "delete review", "moderate review",
      "manage reviews", "update review", "view reviews",
      "manage", "update", "edit", "delete", "approve", "reject", "moderate",
    ],
  },
  {
    label: "Coupons",
    description: "Edit, pause and delete discount coupons",
    href: "/admin/coupons",
    icon: Percent,
    keywords: [
      "coupons", "discounts", "promo", "promotions", "campaigns",
      "edit coupon", "update coupon", "delete coupon", "pause coupon",
      "restore coupon", "manage coupons", "voucher", "promo code",
      "manage", "update", "edit", "delete", "pause", "deactivate",
    ],
  },
  {
    label: "Categories",
    description: "Edit and delete product categories",
    href: "/admin/categories",
    icon: Layers,
    keywords: [
      "categories", "taxonomy", "collections",
      "edit category", "update category", "delete category", "remove category",
      "manage categories", "category list",
      "manage", "update", "edit", "delete", "remove",
    ],
  },
  {
    label: "Analytics",
    description: "Revenue, funnel and performance reports",
    href: "/admin/analytics",
    icon: BarChart3,
    keywords: [
      "analytics", "reports", "revenue", "funnel", "stats", "charts",
      "view analytics", "sales report", "performance", "insights",
      "view", "report",
    ],
  },
  {
    label: "Settings",
    description: "Update store profile and configuration",
    href: "/admin/settings",
    icon: Settings,
    keywords: [
      "settings", "config", "store profile", "configuration", "preferences",
      "update settings", "edit settings", "store settings", "shipping settings",
      "cod settings", "inventory settings", "notification settings",
      "manage", "update", "edit", "configure",
    ],
  },
];

function matchQuickActions(query: string): QuickAction[] {
  const q = query.toLowerCase().trim();
  if (!q) return [];
  return QUICK_ACTIONS.filter((action) =>
    action.keywords.some((kw) => kw.includes(q) || q.includes(kw)) ||
    action.label.toLowerCase().includes(q) ||
    action.description.toLowerCase().includes(q),
  ).slice(0, 6);
}

const DEBOUNCE_MS = 300;

export function AdminSearchPanel({ onClose }: AdminSearchPanelProps) {
  const router = useRouter();
  const api = useAuthenticatedApi();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const search = useCallback(
    async (q: string) => {
      if (!q.trim()) {
        setResults(null);
        setLoading(false);
        return;
      }
      setLoading(true);
      const encoded = encodeURIComponent(q.trim());
      try {
        const [ordersRes, productsRes, customersRes] = await Promise.allSettled([
          api<PaginatedResponse<AdminOrderListItem>>(
            `/admin/orders?search=${encoded}&limit=3`,
          ),
          api<PaginatedResponse<AdminProductListItem>>(
            `/admin/products?search=${encoded}&limit=3`,
          ),
          api<PaginatedResponse<AdminUserListItem>>(
            `/admin/users?search=${encoded}&limit=3`,
          ),
        ]);
        setResults({
          orders:
            ordersRes.status === "fulfilled"
              ? coercePaginatedResponse(ordersRes.value).items as AdminOrderListItem[]
              : [],
          products:
            productsRes.status === "fulfilled"
              ? coercePaginatedResponse(productsRes.value).items as AdminProductListItem[]
              : [],
          customers:
            customersRes.status === "fulfilled"
              ? coercePaginatedResponse(customersRes.value).items as AdminUserListItem[]
              : [],
        });
      } finally {
        setLoading(false);
        setActiveIndex(-1);
      }
    },
    [api],
  );

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    setQuery(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!val.trim()) {
      setResults(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(() => void search(val), DEBOUNCE_MS);
  }

  const quickActions = query.trim() ? matchQuickActions(query) : [];

  // Build flat list of all result links for keyboard nav (quick actions first)
  const allItems: { href: string; label: string }[] = [];
  quickActions.forEach((a) => allItems.push({ href: a.href, label: a.label }));
  if (results) {
    results.orders.forEach((o) =>
      allItems.push({ href: `/admin/orders/${o.id}`, label: o.orderNumber }),
    );
    results.products.forEach((p) =>
      allItems.push({ href: `/admin/products/${p.id}`, label: p.name }),
    );
    results.customers.forEach((c) =>
      allItems.push({
        href: `/admin/customers/${c.id}`,
        label: `${c.firstName} ${c.lastName}`,
      }),
    );
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!allItems.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, allItems.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && activeIndex >= 0) {
      e.preventDefault();
      router.push(allItems[activeIndex].href);
      onClose();
    }
  }

  const hasDbResults =
    results &&
    (results.orders.length > 0 ||
      results.products.length > 0 ||
      results.customers.length > 0);

  const hasAnyResults = quickActions.length > 0 || hasDbResults;
  const isEmpty = query.trim() && !loading && !hasAnyResults;

  let flatIndex = 0;

  return (
    <div className="fixed inset-0 z-[60] flex flex-col" role="dialog" aria-modal="true" aria-label="Search">
      {/* Backdrop */}
      <button
        type="button"
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        aria-label="Close search"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="relative mx-auto mt-[5vh] w-full max-w-xl px-3 sm:px-0">
        <div className="rounded-2xl border border-border bg-card shadow-2xl overflow-hidden">
          {/* Input */}
          <div className="flex items-center gap-3 px-4 py-3.5 border-b border-border/50">
            {loading ? (
              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" aria-hidden />
            ) : (
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            )}
            <input
              ref={inputRef}
              type="text"
              placeholder="Search orders, products, customers, or go to a page…"
              value={query}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/70 focus:outline-none"
              autoComplete="off"
              spellCheck={false}
            />
            {query && (
              <button
                type="button"
                onClick={() => { setQuery(""); setResults(null); inputRef.current?.focus(); }}
                className="rounded-md p-1 text-muted-foreground hover:text-foreground"
                aria-label="Clear search"
              >
                <X className="h-4 w-4" />
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="ml-1 rounded-md border border-border/60 px-2 py-1 text-[10px] font-medium text-muted-foreground hover:bg-muted/50"
            >
              Esc
            </button>
          </div>

          {/* Empty state */}
          {!query && (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              Search orders, products, customers — or type a page name to navigate.
            </div>
          )}

          {isEmpty && (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              No results for <strong>&quot;{query}&quot;</strong>
            </div>
          )}

          {hasAnyResults && (
            <div className="max-h-[60vh] overflow-y-auto divide-y divide-border/40">

              {/* Quick Actions */}
              {quickActions.length > 0 && (
                <section>
                  <div className="flex items-center gap-1.5 px-4 py-2">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Quick Actions
                    </span>
                  </div>
                  {quickActions.map((action) => {
                    const idx = flatIndex++;
                    const Icon = action.icon;
                    const isAdd = action.icon === Plus;
                    return (
                      <Link
                        key={action.href}
                        href={action.href}
                        onClick={onClose}
                        className={cn(
                          "flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/50",
                          activeIndex === idx && "bg-muted/70",
                        )}
                      >
                        <div className={cn(
                          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm",
                          isAdd
                            ? "bg-emerald-50 text-emerald-600"
                            : "bg-zinc-100 text-zinc-600",
                        )}>
                          <Icon className="h-4 w-4" />
                        </div>
                        <div className="flex min-w-0 flex-1 flex-col">
                          <span className="text-sm font-semibold text-foreground">
                            {action.label}
                          </span>
                          <span className="text-[11px] text-muted-foreground">
                            {action.description}
                          </span>
                        </div>
                        <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
                      </Link>
                    );
                  })}
                </section>
              )}

              {/* Orders */}
              {results && results.orders.length > 0 && (
                <section>
                  <div className="flex items-center justify-between px-4 py-2">
                    <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      <ShoppingCart className="h-3 w-3" aria-hidden /> Orders
                    </span>
                    <Link
                      href={`/admin/orders?search=${encodeURIComponent(query)}`}
                      onClick={onClose}
                      className="text-[10px] font-medium text-primary hover:underline flex items-center gap-0.5"
                    >
                      View all <ArrowRight className="h-3 w-3" />
                    </Link>
                  </div>
                  {results.orders.map((order) => {
                    const idx = flatIndex++;
                    return (
                      <Link
                        key={order.id}
                        href={`/admin/orders/${order.id}`}
                        onClick={onClose}
                        className={cn(
                          "flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/50",
                          activeIndex === idx && "bg-muted/70",
                        )}
                      >
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-600">
                          <Hash className="h-3.5 w-3.5" />
                        </div>
                        <div className="flex min-w-0 flex-1 flex-col">
                          <span className="text-sm font-semibold text-foreground truncate">
                            {order.orderNumber}
                          </span>
                          <span className="text-[11px] text-muted-foreground truncate">
                            {order.customerName} · {formatPaise(order.total)}
                          </span>
                        </div>
                        <span className={cn(
                          "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium",
                          order.status === "CONFIRMED" ? "bg-amber-50 text-amber-700" :
                          order.status === "SHIPPED" ? "bg-blue-50 text-blue-700" :
                          order.status === "DELIVERED" ? "bg-green-50 text-green-700" :
                          order.status === "CANCELLED" ? "bg-red-50 text-red-700" :
                          "bg-muted text-muted-foreground"
                        )}>
                          {order.status}
                        </span>
                      </Link>
                    );
                  })}
                </section>
              )}

              {/* Products */}
              {results && results.products.length > 0 && (
                <section>
                  <div className="flex items-center justify-between px-4 py-2">
                    <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      <Box className="h-3 w-3" aria-hidden /> Products
                    </span>
                    <Link
                      href={`/admin/products?search=${encodeURIComponent(query)}`}
                      onClick={onClose}
                      className="text-[10px] font-medium text-primary hover:underline flex items-center gap-0.5"
                    >
                      View all <ArrowRight className="h-3 w-3" />
                    </Link>
                  </div>
                  {results.products.map((product) => {
                    const idx = flatIndex++;
                    const img = resolveProductImageUrl(product.images?.[0]?.url);
                    return (
                      <Link
                        key={product.id}
                        href={`/admin/products/${product.id}`}
                        onClick={onClose}
                        className={cn(
                          "flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/50",
                          activeIndex === idx && "bg-muted/70",
                        )}
                      >
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border/50 bg-muted/40 overflow-hidden">
                          {img && img !== "/next.svg" ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={img} alt="" className="h-full w-full object-cover" />
                          ) : (
                            <Box className="h-4 w-4 text-muted-foreground/50" />
                          )}
                        </div>
                        <div className="flex min-w-0 flex-1 flex-col">
                          <span className="text-sm font-semibold text-foreground truncate">
                            {product.name}
                          </span>
                          <span className="text-[11px] text-muted-foreground truncate">
                            {product.category.name} · {product.variants.length} variant{product.variants.length !== 1 ? "s" : ""}
                          </span>
                        </div>
                        {!product.isActive && (
                          <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-500">
                            Inactive
                          </span>
                        )}
                      </Link>
                    );
                  })}
                </section>
              )}

              {/* Customers */}
              {results && results.customers.length > 0 && (
                <section>
                  <div className="flex items-center justify-between px-4 py-2">
                    <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      <Users className="h-3 w-3" aria-hidden /> Customers
                    </span>
                    <Link
                      href={`/admin/customers?search=${encodeURIComponent(query)}`}
                      onClick={onClose}
                      className="text-[10px] font-medium text-primary hover:underline flex items-center gap-0.5"
                    >
                      View all <ArrowRight className="h-3 w-3" />
                    </Link>
                  </div>
                  {results.customers.map((customer) => {
                    const idx = flatIndex++;
                    return (
                      <Link
                        key={customer.id}
                        href={`/admin/customers/${customer.id}`}
                        onClick={onClose}
                        className={cn(
                          "flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/50",
                          activeIndex === idx && "bg-muted/70",
                        )}
                      >
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-violet-50 text-sm font-bold text-violet-600">
                          {customer.firstName?.charAt(0) || "?"}
                        </div>
                        <div className="flex min-w-0 flex-1 flex-col">
                          <span className="text-sm font-semibold text-foreground truncate">
                            {customer.firstName} {customer.lastName}
                          </span>
                          <span className="text-[11px] text-muted-foreground truncate">
                            {customer.email ?? customer.phone ?? "No contact"} · {customer.totalOrders} order{customer.totalOrders !== 1 ? "s" : ""}
                          </span>
                        </div>
                        <span className="shrink-0 text-[11px] text-muted-foreground">
                          {formatPaise(customer.totalSpendPaise)}
                        </span>
                      </Link>
                    );
                  })}
                </section>
              )}
            </div>
          )}

          {/* Footer hint */}
          {hasAnyResults && (
            <div className="border-t border-border/40 px-4 py-2 flex items-center gap-4 text-[10px] text-muted-foreground/70">
              <span><kbd className="font-mono">↑↓</kbd> navigate</span>
              <span><kbd className="font-mono">↵</kbd> open</span>
              <span><kbd className="font-mono">Esc</kbd> close</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
