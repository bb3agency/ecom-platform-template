"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AdminCategoryForm } from "@/components/admin/AdminCategoryForm";
import { AdminPagination } from "@/components/admin/AdminPagination";
import { AdminTableScroll } from "@/components/admin/AdminTableScroll";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useToastStore } from "@/stores/toast";
import { useAdminAuth } from "@/contexts/admin-auth-context";
import { useAdminListResource } from "@/hooks/use-admin-list-resource";
import {
  buildAdminQuery,
  coercePaginatedResponse,
  fetchAllPaginatedItems,
  readPaginatedItems,
  type AdminCategoryListItem,
  type PaginatedResponse,
} from "@/lib/admin-api";
import { getApiErrorMessage } from "@/lib/error-messages";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import { useAdminDataRefreshEffect } from "@/hooks/use-admin-data-refresh-effect";
import { createIdempotencyKey } from "@/lib/idempotency";
import { notifyAdminDataChanged } from "@/lib/admin-data-refresh";
import { ADMIN_PERMISSIONS, hasAdminPermission } from "@/lib/permissions";
import { Layers, Tag, EyeOff, Search, Plus, Pencil, Trash2 } from "lucide-react";

const PAGE_SIZE = 20;

interface CategoryKpis {
  total: number;
  active: number;
  inactive: number;
}

export function AdminCategoriesList() {
  const api = useAuthenticatedApi();
  const { adminUser } = useAdminAuth();
  const canWrite = hasAdminPermission(adminUser, ADMIN_PERMISSIONS.categoriesWrite);

  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [statusFilter, setStatusFilter] = useState("active");
  const [parentNames, setParentNames] = useState<Record<string, string>>({});

  // Modal state
  const [formOpen, setFormOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<AdminCategoryListItem | null>(null);

  const fetchPage = useCallback(
    async (page: number) => {
      return api<PaginatedResponse<AdminCategoryListItem>>(
        `/admin/categories${buildAdminQuery({
          page,
          limit: PAGE_SIZE,
          search: search || undefined,
          isActive:
            statusFilter === "active"
              ? true
              : statusFilter === "inactive"
                ? false
                : undefined,
        })}`,
      );
    },
    [api, search, statusFilter],
  );

  const { data, loading, error, setPage, reload } =
    useAdminListResource<AdminCategoryListItem>(fetchPage);

  const [isActioning, setIsActioning] = useState<string | null>(null);
  const { confirm, confirmDialog } = useConfirm();
  const pushToast = useToastStore((s) => s.push);

  const loadParentNames = useCallback(async () => {
    try {
      const all = await fetchAllPaginatedItems<AdminCategoryListItem>(
        async (page, limit) =>
          api<PaginatedResponse<AdminCategoryListItem>>(
            `/admin/categories${buildAdminQuery({ page, limit })}`,
          ),
      );
      setParentNames(Object.fromEntries(all.map((c) => [c.id, c.name])));
    } catch {
      // non-fatal
    }
  }, [api]);

  useEffect(() => {
    void loadParentNames();
  }, [loadParentNames]);

  useAdminDataRefreshEffect(loadParentNames, "categories");

  const [categoryKpis, setCategoryKpis] = useState<CategoryKpis | null>(null);
  const [kpisLoading, setKpisLoading] = useState(true);
  const [kpisError, setKpisError] = useState(false);
  const kpisRequestIdRef = useRef(0);

  const loadKpis = useCallback(async () => {
    const requestId = ++kpisRequestIdRef.current;
    setKpisLoading(true);
    setKpisError(false);
    try {
      const [totalRes, activeRes] = await Promise.all([
        api<PaginatedResponse<AdminCategoryListItem>>(
          `/admin/categories${buildAdminQuery({ page: 1, limit: 1 })}`,
        ),
        api<PaginatedResponse<AdminCategoryListItem>>(
          `/admin/categories${buildAdminQuery({ page: 1, limit: 1, isActive: true })}`,
        ),
      ]);
      if (requestId !== kpisRequestIdRef.current) return;
      const safeTotal = (r: PaginatedResponse<AdminCategoryListItem>) =>
        coercePaginatedResponse(r).meta.total;
      const total = safeTotal(totalRes);
      const active = safeTotal(activeRes);
      setCategoryKpis({ total, active, inactive: total - active });
    } catch {
      if (requestId === kpisRequestIdRef.current) setKpisError(true);
    } finally {
      if (requestId === kpisRequestIdRef.current) setKpisLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void loadKpis();
  }, [loadKpis]);
  useAdminDataRefreshEffect(loadKpis, "categories");
  useAdminDataRefreshEffect(reload, "categories");

  useEffect(() => {
    setPage(1);
  }, [search, statusFilter, setPage]);

  function handleSaved() {
    reload();
    void loadKpis();
    void loadParentNames();
  }

  const handleDeactivate = async (categoryId: string) => {
    if (!canWrite) return;
    const ok = await confirm({
      title: "Deactivate Category?",
      description:
        "Products using this category will not be affected. You can restore it later.",
      confirmLabel: "Deactivate",
      tone: "primary",
    });
    if (!ok) return;
    setIsActioning(categoryId);
    try {
      await api(`/admin/categories/${categoryId}`, {
        method: "DELETE",
        idempotencyKey: createIdempotencyKey(),
      });
      reload();
      void loadKpis();
      void loadParentNames();
      notifyAdminDataChanged(["categories", "products", "dashboard"]);
    } catch (err) {
      pushToast({ variant: "error", message: getApiErrorMessage(err) });
    } finally {
      setIsActioning(null);
    }
  };

  const handleRestore = async (categoryId: string) => {
    if (!canWrite) return;
    setIsActioning(categoryId);
    try {
      await api(`/admin/categories/${categoryId}`, {
        method: "PATCH",
        idempotencyKey: createIdempotencyKey(),
        body: JSON.stringify({ isActive: true }),
      });
      reload();
      void loadKpis();
      void loadParentNames();
      notifyAdminDataChanged(["categories", "products", "dashboard"]);
    } catch (err) {
      pushToast({ variant: "error", message: getApiErrorMessage(err) });
    } finally {
      setIsActioning(null);
    }
  };

  const handlePermanentDelete = async (cat: AdminCategoryListItem) => {
    if (!canWrite) return;
    const ok = await confirm({
      title: "Delete Category?",
      description: (
        <>
          This action cannot be undone. This will permanently delete{" "}
          <span className="font-semibold text-foreground">“{cat.name}”</span>. The category
          must have no products assigned.
        </>
      ),
      confirmLabel: "Delete Category",
      typeToConfirm: "DELETE",
    });
    if (!ok) return;
    setIsActioning(cat.id);
    try {
      await api(`/admin/categories/${cat.id}/permanent`, {
        method: "DELETE",
        idempotencyKey: createIdempotencyKey(),
      });
      reload();
      void loadKpis();
      void loadParentNames();
      notifyAdminDataChanged(["categories", "products", "dashboard"]);
    } catch (err) {
      pushToast({ variant: "error", message: getApiErrorMessage(err) });
    } finally {
      setIsActioning(null);
    }
  };

  const items = readPaginatedItems(data);
  const colSpan = 5;

  const resolveParentName = useCallback(
    (cat: AdminCategoryListItem) => {
      if (!cat.parentId) return "—";
      return parentNames[cat.parentId] ?? cat.parentId;
    },
    [parentNames],
  );

  const kpiCards = [
    {
      label: "Total Categories",
      value: categoryKpis
        ? categoryKpis.total.toLocaleString()
        : kpisLoading
          ? "…"
          : kpisError
            ? "!"
            : "—",
      icon: Layers,
      iconClassName: "bg-muted text-muted-foreground",
    },
    {
      label: "Active",
      value: categoryKpis ? categoryKpis.active.toLocaleString() : "—",
      icon: Tag,
      iconClassName: "bg-emerald-500/10 text-emerald-600",
    },
    {
      label: "Inactive",
      value: categoryKpis ? categoryKpis.inactive.toLocaleString() : "—",
      icon: EyeOff,
      iconClassName: "bg-muted text-muted-foreground",
    },
  ];

  return (
    <>
      {confirmDialog}
      <div className="flex flex-col gap-6 min-w-0">
        <div className="grid grid-cols-1 gap-3 sm:gap-4 sm:grid-cols-3">
          {kpiCards.map(({ label, value, icon: Icon, iconClassName }) => (
            <div
              key={label}
              className="flex flex-col justify-center rounded-2xl border border-border bg-card p-4 sm:p-5 hover:shadow-sm transition-shadow"
            >
              <div className="flex items-center gap-3 sm:gap-4">
                <div
                  className={`flex h-10 w-10 sm:h-12 sm:w-12 shrink-0 items-center justify-center rounded-xl ${iconClassName}`}
                >
                  <Icon className="h-5 w-5" />
                </div>
                <div className="flex flex-col gap-0.5 sm:gap-1">
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="font-heading text-lg sm:text-2xl font-bold tracking-tight text-foreground">
                    {value}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="flex flex-col rounded-2xl border border-border bg-card min-w-0 overflow-hidden">
          <div className="flex flex-col gap-4 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between">
            <form
              className="relative w-full min-w-0 flex-1 sm:max-w-sm"
              onSubmit={(e) => {
                e.preventDefault();
                setSearch(searchInput.trim());
                setPage(1);
              }}
            >
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search categories…"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="h-9 w-full rounded-lg border border-input bg-background pl-9 pr-4 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-ring focus:outline-none"
              />
            </form>

            <div className="flex flex-wrap items-center gap-2">
              <select
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value);
                  setPage(1);
                }}
                className="h-9 rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:border-ring focus:outline-none"
              >
                <option value="active">Active (published)</option>
                <option value="inactive">Inactive</option>
                <option value="">All</option>
              </select>

              {canWrite && (
                <Button
                  size="lg"
                  className="gap-1.5"
                  onClick={() => {
                    setEditingCategory(null);
                    setFormOpen(true);
                  }}
                >
                  <Plus className="h-4 w-4" />
                  Add Category
                </Button>
              )}
            </div>
          </div>

          {error && (
            <div className="p-4 text-sm text-destructive bg-destructive/10 border-b border-border">
              {error}
            </div>
          )}

          <AdminTableScroll>
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="sticky top-0 bg-card border-b border-border text-xs font-medium text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Category</th>
                  <th className="px-4 py-3">Slug</th>
                  <th className="px-4 py-3">Parent</th>
                  <th className="px-4 py-3 text-center">Status</th>
                  <th className="px-4 py-3 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {loading && items.length === 0 ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i}>
                      <td className="px-4 py-3">
                        <Skeleton className="h-4 w-32" />
                      </td>
                      <td className="px-4 py-3">
                        <Skeleton className="h-3.5 w-24" />
                      </td>
                      <td className="px-4 py-3">
                        <Skeleton className="h-3.5 w-16" />
                      </td>
                      <td className="px-4 py-3">
                        <Skeleton className="mx-auto h-5 w-16 rounded-full" />
                      </td>
                      <td className="px-4 py-3">
                        <Skeleton className="mx-auto h-7 w-24 rounded-lg" />
                      </td>
                    </tr>
                  ))
                ) : items.length === 0 ? (
                  <tr>
                    <td colSpan={colSpan} className="p-4">
                      <EmptyState
                        icon={Layers}
                        headline="No categories found"
                        description="Create your first category."
                        className="border-0"
                        action={
                          canWrite ? (
                            <Button
                              className="gap-2"
                              onClick={() => {
                                setEditingCategory(null);
                                setFormOpen(true);
                              }}
                            >
                              <Plus className="h-4 w-4" /> Add Category
                            </Button>
                          ) : undefined
                        }
                      />
                    </td>
                  </tr>
                ) : (
                  items.map((cat) => (
                    <tr key={cat.id} className="group hover:bg-muted/50 transition-colors">
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingCategory(cat);
                            setFormOpen(true);
                          }}
                          className="font-medium text-foreground hover:text-primary hover:underline text-left"
                        >
                          {cat.name}
                        </button>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                        {cat.slug}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">
                        {resolveParentName(cat)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <Badge variant={cat.isActive ? "success" : "default"} dot>
                          {cat.isActive ? "Active" : "Inactive"}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-center gap-1">
                          {canWrite && (
                            <Button
                              size="icon-sm"
                              variant="outline"
                              aria-label="Edit category"
                              onClick={() => {
                                setEditingCategory(cat);
                                setFormOpen(true);
                              }}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          {canWrite &&
                            (cat.isActive ? (
                              <Button
                                size="sm"
                                disabled={isActioning === cat.id}
                                onClick={() => void handleDeactivate(cat.id)}
                              >
                                Deactivate
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={isActioning === cat.id}
                                onClick={() => void handleRestore(cat.id)}
                              >
                                Restore
                              </Button>
                            ))}
                          {canWrite && !cat.isActive && (
                            <Button
                              size="icon-sm"
                              variant="destructive"
                              disabled={isActioning === cat.id}
                              onClick={() => void handlePermanentDelete(cat)}
                              aria-label="Permanently delete category"
                              title="Permanently delete"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </AdminTableScroll>

          <div className="border-t border-border p-4">
            <AdminPagination
              meta={
                data?.meta ?? {
                  page: 1,
                  limit: PAGE_SIZE,
                  total: 0,
                  totalPages: 0,
                }
              }
              onPageChange={setPage}
            />
          </div>
        </div>
      </div>

      <AdminCategoryForm
        open={formOpen}
        category={editingCategory}
        onSaved={handleSaved}
        onClose={() => {
          setFormOpen(false);
          setEditingCategory(null);
        }}
      />
    </>
  );
}
