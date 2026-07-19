"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { AdminPagination } from "@/components/admin/AdminPagination";
import { AdminRowActionsMenu } from "@/components/admin/AdminRowActionsMenu";
import { AdminTableScroll } from "@/components/admin/AdminTableScroll";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useToastStore } from "@/stores/toast";
import { useAdminAuth } from "@/contexts/admin-auth-context";
import { useAdminListResource } from "@/hooks/use-admin-list-resource";
import {
  buildAdminQuery,
  coercePaginatedResponse,
  fetchAllPaginatedItems,
  ensureArray,
  readPaginatedItems,
  type AdminProductListItem,
  type AdminCategoryListItem,
  type PaginatedResponse,
} from "@/lib/admin-api";
import { formatPaise } from "@/lib/admin-format";
import { getApiErrorMessage } from "@/lib/error-messages";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import { useAdminDataRefreshEffect } from "@/hooks/use-admin-data-refresh-effect";
import { createIdempotencyKey } from "@/lib/idempotency";
import { notifyAdminDataChanged } from "@/lib/admin-data-refresh";
import { resolveProductImageUrl } from "@/lib/media-url";
import { ADMIN_PERMISSIONS, hasAdminPermission } from "@/lib/permissions";
import {
  Package,
  Tag,
  EyeOff,
  AlertTriangle,
  Search,
  Filter,
  Plus,
  Image as ImageIcon,
} from "lucide-react";
import { STOREFRONT_URL } from "@/lib/constants";
import Image from "next/image";

const PAGE_SIZE = 8;

// ── shared helpers ──────────────────────────────────────────────────────────

interface ProductKpis {
  total: number;
  active: number;
  outOfStock: number;
  lowStock: number;
}

export function AdminProductsList() {
  const api = useAuthenticatedApi();
  const { adminUser } = useAdminAuth();
  const canWrite = hasAdminPermission(
    adminUser,
    ADMIN_PERMISSIONS.productsWrite,
  );

  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("active");
  const [tagFilter, setTagFilter] = useState("");

  const [categories, setCategories] = useState<AdminCategoryListItem[]>([]);

  const loadCategories = useCallback(async () => {
    try {
      const items = await fetchAllPaginatedItems<AdminCategoryListItem>(
        async (page, limit) =>
          api<PaginatedResponse<AdminCategoryListItem>>(
            `/admin/categories${buildAdminQuery({ page, limit, isActive: true })}`,
          ),
      );
      setCategories(items);
    } catch (err) {
      console.error("Failed to load categories", err);
    }
  }, [api]);

  useEffect(() => {
    void loadCategories();
  }, [loadCategories]);

  useAdminDataRefreshEffect(loadCategories, "categories");

  const fetchPage = useCallback(
    async (page: number) => {
      return api<PaginatedResponse<AdminProductListItem>>(
        `/admin/products${buildAdminQuery({
          page,
          limit: PAGE_SIZE,
          search: search || undefined,
          category: categoryFilter || undefined,
          tags: tagFilter || undefined,
          isActive:
            statusFilter === "active"
              ? true
              : statusFilter === "inactive"
                ? false
                : undefined,
          inStock: statusFilter === "out_of_stock" ? false : undefined,
        })}`,
      );
    },
    [api, search, categoryFilter, tagFilter, statusFilter],
  );

  const { data, loading, error, setPage, reload } =
    useAdminListResource<AdminProductListItem>(fetchPage);

  const [selectedIds, setSelectedIds] = useState<Record<string, boolean>>({});
  const [isDeleting, setIsDeleting] = useState<string | null>(null);
  const { confirm, confirmDialog } = useConfirm();
  const pushToast = useToastStore((s) => s.push);

  // ── KPI state ────────────────────────────────────────────────────────────
  const [productKpis, setProductKpis] = useState<ProductKpis | null>(null);
  const [kpisLoading, setKpisLoading] = useState(true);
  const kpisRequestIdRef = useRef(0);

  const loadKpis = useCallback(async () => {
    const requestId = ++kpisRequestIdRef.current;
    setKpisLoading(true);
    try {
      const [totalRes, activeRes, outRes, lowRes] = await Promise.all([
        api<PaginatedResponse<AdminProductListItem>>(
          `/admin/products${buildAdminQuery({ page: 1, limit: 1 })}`,
        ),
        api<PaginatedResponse<AdminProductListItem>>(
          `/admin/products${buildAdminQuery({ page: 1, limit: 1, isActive: true })}`,
        ),
        api<PaginatedResponse<AdminProductListItem>>(
          `/admin/products${buildAdminQuery({ page: 1, limit: 1, inStock: false })}`,
        ),
        api<AdminProductListItem[]>(`/admin/inventory/low-stock`),
      ]);
      if (requestId !== kpisRequestIdRef.current) {
        return;
      }
      const safeTotal = (r: PaginatedResponse<AdminProductListItem>) =>
        coercePaginatedResponse(r).meta.total;
      const lowArr = Array.isArray(lowRes) ? lowRes : [];
      setProductKpis({
        total: safeTotal(totalRes),
        active: safeTotal(activeRes),
        outOfStock: safeTotal(outRes),
        lowStock: lowArr.length,
      });
    } catch {
      // keep prior values when refresh fails
    } finally {
      if (requestId === kpisRequestIdRef.current) {
        setKpisLoading(false);
      }
    }
  }, [api]);

  useEffect(() => {
    void loadKpis();
  }, [loadKpis]);

  useAdminDataRefreshEffect(loadKpis, ["products", "inventory"]);

  useAdminDataRefreshEffect(reload, ["products"]);

  const handleDeleteProduct = async (productId: string) => {
    if (!canWrite) return;
    const ok = await confirm({
      title: "Deactivate Product?",
      description:
        "The product will be hidden from the storefront. You can restore it at any time.",
      confirmLabel: "Deactivate",
      tone: "primary",
    });
    if (!ok) return;

    setIsDeleting(productId);
    try {
      await api(`/admin/products/${productId}`, {
        method: "DELETE",
        idempotencyKey: createIdempotencyKey(),
      });
      reload();
      notifyAdminDataChanged(["products", "inventory", "dashboard"]);
      pushToast({ variant: "success", message: "Product deactivated." });
    } catch (err) {
      console.error("Failed to deactivate product", err);
      pushToast({ variant: "error", message: getApiErrorMessage(err) });
    } finally {
      setIsDeleting(null);
    }
  };

  const handleRestoreProduct = async (productId: string) => {
    if (!canWrite) return;

    setIsDeleting(productId);
    try {
      await api(`/admin/products/${productId}`, {
        method: "PATCH",
        idempotencyKey: createIdempotencyKey(),
        body: JSON.stringify({ isActive: true }),
      });
      reload();
      notifyAdminDataChanged(["products", "inventory", "dashboard"]);
    } catch (err) {
      console.error("Failed to restore product", err);
      pushToast({ variant: "error", message: getApiErrorMessage(err) });
    } finally {
      setIsDeleting(null);
    }
  };

  const handleHardDeleteProduct = async (productId: string, productName: string) => {
    if (!canWrite) return;
    const ok = await confirm({
      title: "Delete Product?",
      description: (
        <>
          This action cannot be undone. This will permanently delete{" "}
          <span className="font-semibold text-foreground">“{productName}”</span> including all
          variants and images.
        </>
      ),
      confirmLabel: "Delete Product",
      typeToConfirm: "DELETE",
    });
    if (!ok) return;

    setIsDeleting(productId);
    try {
      await api(`/admin/products/${productId}/permanent`, {
        method: "DELETE",
        idempotencyKey: createIdempotencyKey(),
      });
      reload();
      notifyAdminDataChanged(["products", "inventory", "dashboard"]);
    } catch (err) {
      console.error("Failed to permanently delete product", err);
      pushToast({ variant: "error", message: getApiErrorMessage(err) });
    } finally {
      setIsDeleting(null);
    }
  };

  const items = readPaginatedItems(data);

  return (
    <div className="flex flex-col gap-6 min-w-0">
      {confirmDialog}
      {/* KPI Cards Row */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <div className="flex flex-col justify-center rounded-xl border border-border/40 bg-card p-4 sm:p-5 shadow-sm min-w-0">
          <div className="flex items-center gap-3 sm:gap-4">
            <div className="flex h-10 w-10 sm:h-12 sm:w-12 shrink-0 items-center justify-center rounded-xl bg-emerald-50">
              <Package className="h-5 w-5 text-emerald-600" />
            </div>
            <div className="flex flex-col gap-0.5 sm:gap-1 min-w-0">
              <p className="text-[10px] sm:text-xs font-medium text-muted-foreground truncate">
                Total Products
              </p>
              <p className="font-heading text-lg sm:text-2xl font-bold tracking-tight text-foreground truncate">
                {productKpis ? productKpis.total.toLocaleString() : kpisLoading ? "…" : "—"}
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-col justify-center rounded-xl border border-border/40 bg-card p-4 sm:p-5 shadow-sm min-w-0">
          <div className="flex items-center gap-3 sm:gap-4">
            <div className="flex h-10 w-10 sm:h-12 sm:w-12 shrink-0 items-center justify-center rounded-xl bg-blue-100">
              <Tag className="h-5 w-5 text-blue-600" />
            </div>
            <div className="flex flex-col gap-0.5 sm:gap-1 min-w-0">
              <p className="text-[10px] sm:text-xs font-medium text-muted-foreground truncate">
                Active Products
              </p>
              <p className="font-heading text-lg sm:text-2xl font-bold tracking-tight text-foreground truncate">
                {productKpis ? productKpis.active.toLocaleString() : "—"}
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-col justify-center rounded-xl border border-border/40 bg-card p-4 sm:p-5 shadow-sm min-w-0">
          <div className="flex items-center gap-3 sm:gap-4">
            <div className="flex h-10 w-10 sm:h-12 sm:w-12 shrink-0 items-center justify-center rounded-xl bg-rose-100">
              <EyeOff className="h-5 w-5 text-rose-600" />
            </div>
            <div className="flex flex-col gap-0.5 sm:gap-1 min-w-0">
              <p className="text-[10px] sm:text-xs font-medium text-muted-foreground truncate">
                Out of Stock
              </p>
              <p className="font-heading text-lg sm:text-2xl font-bold tracking-tight text-foreground truncate">
                {productKpis ? productKpis.outOfStock.toLocaleString() : "—"}
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-col justify-center rounded-xl border border-border/40 bg-card p-4 sm:p-5 shadow-sm min-w-0">
          <div className="flex items-center gap-3 sm:gap-4">
            <div className="flex h-10 w-10 sm:h-12 sm:w-12 shrink-0 items-center justify-center rounded-xl bg-purple-100">
              <AlertTriangle className="h-5 w-5 text-purple-600" />
            </div>
            <div className="flex flex-col gap-0.5 sm:gap-1 min-w-0">
              <p className="text-[10px] sm:text-xs font-medium text-muted-foreground truncate">
                Low Stock
              </p>
              <p className="font-heading text-lg sm:text-2xl font-bold tracking-tight text-foreground truncate">
                {productKpis ? productKpis.lowStock.toLocaleString() : "—"}
              </p>
            </div>
          </div>
          <div className="mt-3 sm:mt-4 flex flex-wrap items-center gap-1 sm:gap-1.5 text-[9px] sm:text-[11px] font-medium">
            <span className="text-muted-foreground">vs last week</span>
          </div>
        </div>
      </div>

      {/* Main Table Section */}
      <div className="flex flex-col rounded-xl border border-border/40 bg-card shadow-sm min-w-0 overflow-hidden">
        <div className="flex flex-col gap-4 border-b border-border/40 p-4 sm:flex-row sm:items-center sm:justify-between">
          <form
            className="relative w-full min-w-0 flex-1 sm:max-w-sm"
            onSubmit={(event) => {
              event.preventDefault();
              setSearch(searchInput.trim());
              setPage(1);
            }}
          >
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search products by name, SKU or barcode..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="h-9 w-full rounded-md border border-border/50 bg-background pl-9 pr-4 text-sm focus:border-zinc-900 focus:outline-none"
            />
          </form>

          <div className="grid grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-row sm:items-center">
            <select
              className="h-9 w-full rounded-md border border-border/50 bg-background px-3 text-sm text-muted-foreground focus:border-zinc-900 focus:outline-none sm:w-auto"
              value={categoryFilter}
              onChange={(e) => {
                setCategoryFilter(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All Categories</option>
              {categories.map((c) => (
                <option key={c.id} value={c.slug}>
                  {c.name}
                </option>
              ))}
            </select>
            <select
              className="h-9 w-full rounded-md border border-border/50 bg-background px-3 text-sm text-muted-foreground focus:border-zinc-900 focus:outline-none sm:w-auto"
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All Status</option>
              <option value="active">Active (published)</option>
              <option value="inactive">Inactive (draft)</option>
              <option value="out_of_stock">Out of stock</option>
            </select>
            <select
              className="h-9 w-full rounded-md border border-border/50 bg-background px-3 text-sm text-muted-foreground focus:border-zinc-900 focus:outline-none sm:w-auto"
              value={tagFilter}
              onChange={(e) => {
                setTagFilter(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All Tags</option>
              <option value="new">New</option>
              <option value="sale">Sale</option>
              <option value="organic">Naturally Grown</option>
            </select>
            <Button variant="outline" className="h-9 w-full gap-2 font-medium sm:w-auto">
              <Filter className="h-4 w-4" /> More Filters
            </Button>
            {canWrite && (
              <Link href="/admin/products/new" className="col-span-2 sm:col-span-1">
                <Button className="h-9 w-full gap-2 bg-zinc-900 text-white hover:bg-zinc-800 sm:w-auto">
                  <Plus className="h-4 w-4" /> Add Product
                </Button>
              </Link>
            )}
          </div>
        </div>

        {loading ? (
          <div className="flex h-64 items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-zinc-900 border-t-transparent" />
          </div>
        ) : error ? (
          <div className="flex h-64 items-center justify-center p-4 text-sm text-destructive">
            {error}
          </div>
        ) : items.length === 0 ? (
          <div className="flex h-64 items-center justify-center p-4 text-sm text-muted-foreground">
            No products found. Try adjusting your filters.
          </div>
        ) : (
          <>
            <AdminTableScroll>
              <table className="w-full min-w-[700px] text-left text-sm">
                <thead className="border-b border-border/40 text-xs font-medium text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 w-10">
                      <input
                        type="checkbox"
                        className="rounded border-border/50 text-zinc-900 focus:ring-zinc-900"
                        checked={
                          items.length > 0 &&
                          items.every((item) => selectedIds[item.id])
                        }
                        onChange={(e) => {
                          const checked = e.target.checked;
                          const next: Record<string, boolean> = {};
                          items.forEach((item) => {
                            next[item.id] = checked;
                          });
                          setSelectedIds(next);
                        }}
                      />
                    </th>
                    <th className="px-4 py-3">Product</th>
                    <th className="px-4 py-3">Category</th>
                    <th className="px-4 py-3">SKU</th>
                    <th className="px-4 py-3">Price</th>
                    <th className="px-4 py-3">Variants</th>
                    <th className="px-4 py-3 text-center">Status</th>
                    <th className="px-4 py-3 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {items.map((product) => {
                    const variants = ensureArray<
                      AdminProductListItem["variants"][number]
                    >(product.variants);
                    const activeVariants = variants.filter((v) => v.isActive);
                    const minPrice = activeVariants.length
                      ? Math.min(...activeVariants.map((v) => v.price))
                      : null;
                    const defaultSku = variants[0]?.sku || "—";

                    const firstImage = product.images?.[0];

                    const statusLabel = !product.isActive
                      ? "Inactive"
                      : activeVariants.length === 0
                        ? "Out of Stock"
                        : "Active";
                    const statusActive =
                      product.isActive && activeVariants.length > 0;

                    return (
                      <tr key={product.id} className="group hover:bg-muted/30">
                        <td className="px-4 py-3">
                          <input
                            type="checkbox"
                            className="rounded border-border/50 text-zinc-900 focus:ring-zinc-900"
                            checked={Boolean(selectedIds[product.id])}
                            onChange={(e) => {
                              setSelectedIds((prev) => ({
                                ...prev,
                                [product.id]: e.target.checked,
                              }));
                            }}
                          />
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border/50 bg-muted/30 overflow-hidden relative">
                              {firstImage?.url ? (
                                <Image
                                  src={resolveProductImageUrl(firstImage.url)}
                                  alt={firstImage.altText || product.name}
                                  fill
                                  className="object-cover"
                                />
                              ) : (
                                <ImageIcon className="h-5 w-5 text-muted-foreground/40" />
                              )}
                            </div>
                            <div className="flex flex-col gap-0.5">
                              <Link
                                href={`/admin/products/${product.id}`}
                                className="font-semibold text-foreground hover:text-zinc-900"
                              >
                                {product.name}
                              </Link>
                              <span className="text-xs text-muted-foreground">
                                {variants.length} Unit(s)
                              </span>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 font-medium text-foreground">
                          {product.category.name}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {defaultSku}
                        </td>
                        <td className="px-4 py-3 font-semibold">
                          {minPrice !== null ? formatPaise(minPrice) : "—"}
                        </td>
                        <td className="px-4 py-3 text-sm text-muted-foreground">
                          {variants.length}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <div
                            className={`mx-auto inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ${statusActive ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}
                          >
                            <div
                              className={`h-1.5 w-1.5 rounded-full ${statusActive ? "bg-emerald-500" : "bg-rose-500"}`}
                            />
                            {statusLabel}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-center gap-1">
                            <Link href={`/admin/products/${product.id}`}>
                              <button
                                type="button"
                                className="h-7 rounded-md bg-zinc-900 px-3 text-xs font-medium text-white hover:bg-zinc-800"
                              >
                                Edit
                              </button>
                            </Link>
                            {canWrite && (
                              product.isActive ? (
                                <button
                                  type="button"
                                  className="h-7 rounded-md bg-zinc-900 px-3 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-60"
                                  onClick={() => void handleDeleteProduct(product.id)}
                                  disabled={isDeleting === product.id}
                                >
                                  Deactivate
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  className="h-7 rounded-md bg-zinc-900 px-3 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-60"
                                  onClick={() => void handleRestoreProduct(product.id)}
                                  disabled={isDeleting === product.id}
                                >
                                  Restore
                                </button>
                              )
                            )}
                            {canWrite && (
                              <AdminRowActionsMenu
                                disabled={isDeleting === product.id}
                                storefrontUrl={product.slug ? `${STOREFRONT_URL}/products/${product.slug}` : undefined}
                                onDeletePermanently={() =>
                                  void handleHardDeleteProduct(product.id, product.name)
                                }
                              />
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </AdminTableScroll>

            <div className="border-t border-border/40 p-4">
              <AdminPagination
                meta={
                  data?.meta || {
                    page: 1,
                    limit: PAGE_SIZE,
                    total: 0,
                    totalPages: 0,
                  }
                }
                onPageChange={setPage}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
