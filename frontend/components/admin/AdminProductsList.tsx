"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink, ImageIcon, MoreHorizontal, Package, Plus, RotateCcw, Trash2, EyeOff, Copy } from "lucide-react";

import { AdminPagination } from "@/components/admin/AdminPagination";
import { Button, buttonVariants } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import {
  DataTable,
  FilterBar,
  FilterSelect,
  Notice,
  Panel,
  StatusDot,
  type DataColumn,
} from "@/components/ui/console";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { useAdminAuth } from "@/contexts/admin-auth-context";
import { useAdminDataRefreshEffect } from "@/hooks/use-admin-data-refresh-effect";
import { useAdminListResource } from "@/hooks/use-admin-list-resource";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import { useUrlFilterState } from "@/hooks/use-url-filter-state";
import {
  buildAdminQuery,
  coercePaginatedResponse,
  ensureArray,
  fetchAllPaginatedItems,
  readPaginatedItems,
  type AdminCategoryListItem,
  type AdminProductListItem,
  type PaginatedResponse,
} from "@/lib/admin-api";
import { notifyAdminDataChanged } from "@/lib/admin-data-refresh";
import { formatPaise } from "@/lib/admin-format";
import { STOREFRONT_URL } from "@/lib/constants";
import { getApiErrorMessage } from "@/lib/error-messages";
import { createIdempotencyKey } from "@/lib/idempotency";
import { resolveProductImageUrl } from "@/lib/media-url";
import { ADMIN_PERMISSIONS, hasAdminPermission } from "@/lib/permissions";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 20;

const STATUS_TABS = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Hidden" },
  { value: "out_of_stock", label: "Out of stock" },
  { value: "all", label: "All" },
] as const;

interface Counts {
  all: number;
  active: number;
  inactive: number;
  out_of_stock: number;
}

export function AdminProductsList() {
  const api = useAuthenticatedApi();
  const { adminUser } = useAdminAuth();
  const canWrite = hasAdminPermission(adminUser, ADMIN_PERMISSIONS.productsWrite);
  const { confirm, confirmDialog } = useConfirm();

  const [status, setStatus] = useUrlFilterState("status", "active", STATUS_TABS.map((t) => t.value));
  const [categoryFilter, setCategoryFilter] = useUrlFilterState("category", "");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  useEffect(() => {
    const next = searchInput.trim();
    if (next === search) return;
    const id = window.setTimeout(() => setSearch(next), 400);
    return () => window.clearTimeout(id);
  }, [searchInput, search]);

  const [categories, setCategories] = useState<AdminCategoryListItem[]>([]);
  const loadCategories = useCallback(async () => {
    try {
      setCategories(
        await fetchAllPaginatedItems<AdminCategoryListItem>((page, limit) =>
          api<PaginatedResponse<AdminCategoryListItem>>(`/admin/categories${buildAdminQuery({ page, limit, isActive: true })}`),
        ),
      );
    } catch {
      // Filter just shows "Any category" when this fails.
    }
  }, [api]);
  useEffect(() => {
    void loadCategories();
  }, [loadCategories]);
  useAdminDataRefreshEffect(loadCategories, "categories");

  const fetchPage = useCallback(
    (page: number) =>
      api<PaginatedResponse<AdminProductListItem>>(
        `/admin/products${buildAdminQuery({
          page,
          limit: PAGE_SIZE,
          search: search || undefined,
          category: categoryFilter || undefined,
          isActive: status === "active" ? true : status === "inactive" ? false : undefined,
          inStock: status === "out_of_stock" ? false : undefined,
        })}`,
      ),
    [api, search, categoryFilter, status],
  );
  const { data, loading, error, setPage, reload } = useAdminListResource<AdminProductListItem>(fetchPage);
  useAdminDataRefreshEffect(reload, ["products"]);
  useEffect(() => {
    setPage(1);
  }, [status, categoryFilter, search, setPage]);

  // Tab counts (cheap limit=1 queries; meta.total only).
  const [counts, setCounts] = useState<Counts | null>(null);
  const countsRequest = useRef(0);
  const loadCounts = useCallback(async () => {
    const id = ++countsRequest.current;
    try {
      const total = (q: Record<string, string | number | boolean | undefined>) =>
        api<PaginatedResponse<AdminProductListItem>>(`/admin/products${buildAdminQuery({ page: 1, limit: 1, ...q })}`).then(
          (r) => coercePaginatedResponse(r).meta.total,
        );
      const [all, active, inactive, out] = await Promise.all([
        total({}),
        total({ isActive: true }),
        total({ isActive: false }),
        total({ inStock: false }),
      ]);
      if (id === countsRequest.current) setCounts({ all, active, inactive, out_of_stock: out });
    } catch {
      // Tabs work without counts.
    }
  }, [api]);
  useEffect(() => {
    void loadCounts();
  }, [loadCounts]);
  useAdminDataRefreshEffect(loadCounts, ["products", "inventory"]);

  const [busyId, setBusyId] = useState<string | null>(null);

  async function setActive(product: AdminProductListItem, active: boolean) {
    if (!active) {
      const ok = await confirm({
        title: `Hide “${product.name}”?`,
        description: "It disappears from the store and from carts. You can show it again any time.",
        confirmLabel: "Hide product",
        tone: "primary",
      });
      if (!ok) return;
    }
    setBusyId(product.id);
    try {
      await api(
        `/admin/products/${product.id}`,
        active
          ? { method: "PATCH", idempotencyKey: createIdempotencyKey(), body: JSON.stringify({ isActive: true }) }
          : { method: "DELETE", idempotencyKey: createIdempotencyKey() },
      );
      toast.success(active ? "Product is visible again." : "Product hidden.");
      reload();
      notifyAdminDataChanged(["products", "inventory", "dashboard"]);
    } catch (err) {
      toast.error(getApiErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  async function deletePermanently(product: AdminProductListItem) {
    const ok = await confirm({
      title: `Delete “${product.name}” permanently?`,
      description: "This removes the product, its variants and images. It can't be undone. Products with orders or reviews can only be hidden.",
      confirmLabel: "Delete permanently",
      typeToConfirm: "DELETE",
    });
    if (!ok) return;
    setBusyId(product.id);
    try {
      await api(`/admin/products/${product.id}/permanent`, { method: "DELETE", idempotencyKey: createIdempotencyKey() });
      toast.success("Product deleted.");
      reload();
      notifyAdminDataChanged(["products", "inventory", "dashboard"]);
    } catch (err) {
      toast.error(getApiErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  async function copyLink(product: AdminProductListItem) {
    try {
      await navigator.clipboard.writeText(`${STOREFRONT_URL}/products/${product.slug}`);
      toast.success("Store link copied.");
    } catch {
      toast.error("Couldn't copy the link.");
    }
  }

  const items = readPaginatedItems(data);

  const productStatus = (p: AdminProductListItem) => {
    const active = ensureArray<AdminProductListItem["variants"][number]>(p.variants).filter((v) => v.isActive);
    if (!p.isActive) return { label: "Hidden", tone: "neutral" as const };
    if (active.length === 0) return { label: "No active variants", tone: "warning" as const };
    return { label: "Active", tone: "success" as const };
  };

  const priceLabel = (p: AdminProductListItem) => {
    const prices = ensureArray<AdminProductListItem["variants"][number]>(p.variants)
      .filter((v) => v.isActive)
      .map((v) => v.price);
    if (prices.length === 0) return "—";
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    return min === max ? formatPaise(min) : `${formatPaise(min)} – ${formatPaise(max)}`;
  };

  const thumb = (p: AdminProductListItem, size: "sm" | "md" = "sm") => {
    const first = p.images?.[0];
    return (
      <span
        className={cn(
          "relative flex shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted",
          size === "sm" ? "size-10" : "size-12",
        )}
      >
        {first?.url ? (
          <Image
            src={resolveProductImageUrl(first.url)}
            alt=""
            fill
            sizes={size === "sm" ? "40px" : "48px"}
            className="object-cover"
          />
        ) : (
          <ImageIcon className="size-4 text-muted-foreground" aria-hidden />
        )}
      </span>
    );
  };

  const rowMenu = (p: AdminProductListItem) =>
    canWrite ? (
      <DropdownMenu>
        <DropdownMenuTrigger
          className="inline-flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
          aria-label={`More actions for ${p.name}`}
          disabled={busyId === p.id}
        >
          <MoreHorizontal className="size-4" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="console-theme admin-console w-52">
          {p.slug ? (
            <>
              <DropdownMenuItem
                className="h-9 px-2"
                onClick={() => window.open(`${STOREFRONT_URL}/products/${p.slug}`, "_blank", "noopener")}
              >
                <ExternalLink aria-hidden /> View in store
              </DropdownMenuItem>
              <DropdownMenuItem className="h-9 px-2" onClick={() => void copyLink(p)}>
                <Copy aria-hidden /> Copy store link
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          ) : null}
          {p.isActive ? (
            <DropdownMenuItem className="h-9 px-2" onClick={() => void setActive(p, false)}>
              <EyeOff aria-hidden /> Hide from store
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem className="h-9 px-2" onClick={() => void setActive(p, true)}>
              <RotateCcw aria-hidden /> Show in store
            </DropdownMenuItem>
          )}
          <DropdownMenuItem variant="destructive" className="h-9 px-2" onClick={() => void deletePermanently(p)}>
            <Trash2 aria-hidden /> Delete permanently
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    ) : null;

  const columns: DataColumn<AdminProductListItem>[] = [
    {
      key: "product",
      header: "Product",
      hideOnMobile: true,
      cell: (p) => (
        <div className="flex min-w-0 items-center gap-3">
          {thumb(p)}
          <div className="min-w-0">
            <p className="truncate font-medium text-foreground">{p.name}</p>
            <p className="text-xs text-muted-foreground">
              {p.variants.length} {p.variants.length === 1 ? "variant" : "variants"}
              {p.isLocalDeliveryOnly ? " · Local delivery only" : ""}
            </p>
          </div>
        </div>
      ),
    },
    { key: "category", header: "Category", hideBelow: "lg", hideOnMobile: true, cell: (p) => <span className="text-foreground">{p.category.name}</span> },
    { key: "price", header: "Price", hideOnMobile: true, cell: (p) => <span className="whitespace-nowrap tabular">{priceLabel(p)}</span> },
    {
      key: "status",
      header: "Status",
      hideOnMobile: true,
      cell: (p) => {
        const s = productStatus(p);
        return <StatusDot tone={s.tone}>{s.label}</StatusDot>;
      },
    },
    { key: "actions", header: <span className="sr-only">Actions</span>, align: "right", className: "w-12", hideOnMobile: true, cell: rowMenu },
  ];

  return (
    <>
      {confirmDialog}
      <Panel flush>
        <div role="tablist" aria-label="Product status" className="flex min-w-0 gap-1 overflow-x-auto border-b border-border px-2 scrollbar-hide sm:px-3">
          {STATUS_TABS.map((tab) => {
            const active = status === tab.value;
            const count = counts ? counts[tab.value as keyof Counts] : null;
            return (
              <button
                key={tab.value}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setStatus(tab.value)}
                className={cn(
                  "relative flex h-11 shrink-0 items-center gap-1.5 whitespace-nowrap px-2.5 text-sm transition-colors",
                  active ? "font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {tab.label}
                {count !== null ? (
                  <span className={cn("rounded-full px-1.5 text-xs tabular", active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>
                    {count}
                  </span>
                ) : null}
                {active ? <span aria-hidden className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-primary" /> : null}
              </button>
            );
          })}
        </div>

        <div className="border-b border-border p-3 sm:px-5">
          <FilterBar
            search={{ value: searchInput, onChange: setSearchInput, placeholder: "Search products", label: "Search products by name or SKU" }}
          >
            <FilterSelect
              label="Category"
              value={categoryFilter}
              onChange={setCategoryFilter}
              options={[{ value: "", label: "Any category" }, ...categories.map((c) => ({ value: c.slug, label: c.name }))]}
            />
          </FilterBar>
        </div>

        {error ? (
          <div className="p-4 sm:p-5">
            <Notice
              tone="danger"
              title="Couldn't load products"
              action={
                <Button type="button" variant="outline" size="lg" onClick={reload}>
                  Try again
                </Button>
              }
            >
              {error}
            </Notice>
          </div>
        ) : (
          <DataTable
            rows={items}
            columns={columns}
            rowKey={(p) => p.id}
            rowHref={(p) => `/admin/products/${p.id}`}
            loading={loading}
            caption="Products"
            mobileCard={(p) => {
              const s = productStatus(p);
              return (
                <div className="relative flex min-w-0 items-center gap-3 px-4 py-3">
                  <Link href={`/admin/products/${p.id}`} className="absolute inset-0" aria-label={`Edit ${p.name}`} />
                  {thumb(p, "md")}
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-foreground">{p.name}</p>
                    <p className="text-sm text-foreground tabular">{priceLabel(p)}</p>
                    <StatusDot tone={s.tone} className="text-xs text-muted-foreground">
                      {s.label}
                    </StatusDot>
                  </div>
                  <div className="relative">{rowMenu(p)}</div>
                </div>
              );
            }}
            empty={
              <EmptyState
                icon={Package}
                headline={search || categoryFilter ? "No products match" : status === "active" ? "No products yet" : "Nothing here"}
                description={
                  search || categoryFilter
                    ? "Try another search or category."
                    : status === "active"
                      ? "Add your first product to start selling."
                      : "Products show up here when they match this tab."
                }
                action={
                  canWrite && !search && !categoryFilter && status === "active" ? (
                    <Link href="/admin/products/new" className={buttonVariants({ size: "lg" })}>
                      <Plus aria-hidden /> Add product
                    </Link>
                  ) : undefined
                }
              />
            }
          />
        )}

        {data && data.meta.total > 0 ? (
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 sm:px-5">
            <p className="text-sm text-muted-foreground tabular">
              {Math.min((data.meta.page - 1) * data.meta.limit + 1, data.meta.total)}–
              {Math.min(data.meta.page * data.meta.limit, data.meta.total)} of {data.meta.total.toLocaleString("en-IN")}
            </p>
            <AdminPagination meta={data.meta} onPageChange={setPage} />
          </div>
        ) : null}
      </Panel>
    </>
  );
}
