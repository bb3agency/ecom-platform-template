"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AdminCategoryForm } from "@/components/admin/AdminCategoryForm";
import { AdminPagination } from "@/components/admin/AdminPagination";
import { AdminTableScroll } from "@/components/admin/AdminTableScroll";
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
    if (
      !window.confirm(
        "Deactivate this category? Products using it will not be affected. You can restore it later.",
      )
    ) {
      return;
    }
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
      alert(getApiErrorMessage(err));
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
      alert(getApiErrorMessage(err));
    } finally {
      setIsActioning(null);
    }
  };

  const handlePermanentDelete = async (cat: AdminCategoryListItem) => {
    if (!canWrite) return;
    if (
      !window.confirm(
        `Permanently delete "${cat.name}"? This cannot be undone. The category must have no products assigned.`,
      )
    ) {
      return;
    }
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
      alert(getApiErrorMessage(err));
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

  return (
    <>
      <div className="flex flex-col gap-6 min-w-0">
        <div className="grid grid-cols-1 gap-3 sm:gap-4 sm:grid-cols-3">
          <div className="flex flex-col justify-center rounded-xl border border-border/40 bg-card p-4 sm:p-5 shadow-sm">
            <div className="flex items-center gap-3 sm:gap-4">
              <div className="flex h-10 w-10 sm:h-12 sm:w-12 shrink-0 items-center justify-center rounded-xl bg-emerald-50">
                <Layers className="h-5 w-5 text-emerald-600" />
              </div>
              <div className="flex flex-col gap-0.5 sm:gap-1">
                <p className="text-[10px] sm:text-xs font-medium text-muted-foreground">Total Categories</p>
                <p className="font-heading text-lg sm:text-2xl font-bold tracking-tight text-foreground">
                  {categoryKpis ? categoryKpis.total.toLocaleString() : kpisLoading ? "…" : kpisError ? "!" : "—"}
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-col justify-center rounded-xl border border-border/40 bg-card p-4 sm:p-5 shadow-sm">
            <div className="flex items-center gap-3 sm:gap-4">
              <div className="flex h-10 w-10 sm:h-12 sm:w-12 shrink-0 items-center justify-center rounded-xl bg-blue-100">
                <Tag className="h-5 w-5 text-blue-600" />
              </div>
              <div className="flex flex-col gap-0.5 sm:gap-1">
                <p className="text-[10px] sm:text-xs font-medium text-muted-foreground">Active</p>
                <p className="font-heading text-lg sm:text-2xl font-bold tracking-tight text-foreground">
                  {categoryKpis ? categoryKpis.active.toLocaleString() : "—"}
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-col justify-center rounded-xl border border-border/40 bg-card p-4 sm:p-5 shadow-sm">
            <div className="flex items-center gap-3 sm:gap-4">
              <div className="flex h-10 w-10 sm:h-12 sm:w-12 shrink-0 items-center justify-center rounded-xl bg-rose-100">
                <EyeOff className="h-5 w-5 text-rose-600" />
              </div>
              <div className="flex flex-col gap-0.5 sm:gap-1">
                <p className="text-[10px] sm:text-xs font-medium text-muted-foreground">Inactive</p>
                <p className="font-heading text-lg sm:text-2xl font-bold tracking-tight text-foreground">
                  {categoryKpis ? categoryKpis.inactive.toLocaleString() : "—"}
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-col rounded-xl border border-border/40 bg-card shadow-sm min-w-0 overflow-hidden">
          <div className="flex flex-col gap-4 border-b border-border/40 p-4 sm:flex-row sm:items-center sm:justify-between">
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
                className="h-9 w-full rounded-md border border-border/50 bg-background pl-9 pr-4 text-sm focus:border-zinc-900 focus:outline-none"
              />
            </form>

            <div className="flex flex-wrap items-center gap-2">
              <select
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value);
                  setPage(1);
                }}
                className="h-9 rounded-md border border-border/50 bg-background px-3 text-sm focus:border-zinc-900 focus:outline-none"
              >
                <option value="active">Active (published)</option>
                <option value="inactive">Inactive</option>
                <option value="">All</option>
              </select>

              {canWrite && (
                <button
                  type="button"
                  onClick={() => {
                    setEditingCategory(null);
                    setFormOpen(true);
                  }}
                  className="flex h-9 items-center gap-1.5 rounded-md bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-800"
                >
                  <Plus className="h-4 w-4" />
                  Add Category
                </button>
              )}
            </div>
          </div>

          {error && (
            <div className="p-4 text-sm text-destructive bg-destructive/10 border-b border-border/40">
              {error}
            </div>
          )}

          <AdminTableScroll>
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border/40 bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Category</th>
                  <th className="px-4 py-3">Slug</th>
                  <th className="px-4 py-3">Parent</th>
                  <th className="px-4 py-3 text-center">Status</th>
                  <th className="px-4 py-3 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {loading && items.length === 0 ? (
                  <tr>
                    <td colSpan={colSpan} className="px-4 py-8 text-center text-muted-foreground text-sm">
                      Loading…
                    </td>
                  </tr>
                ) : items.length === 0 ? (
                  <tr>
                    <td colSpan={colSpan} className="px-4 py-8 text-center text-muted-foreground text-sm">
                      No categories found.
                    </td>
                  </tr>
                ) : (
                  items.map((cat) => (
                    <tr key={cat.id} className="group hover:bg-muted/30">
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingCategory(cat);
                            setFormOpen(true);
                          }}
                          className="font-semibold text-foreground hover:text-zinc-900 hover:underline text-left"
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
                        <span
                          className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                            cat.isActive
                              ? "bg-emerald-50 text-emerald-700"
                              : "bg-rose-50 text-rose-700"
                          }`}
                        >
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${cat.isActive ? "bg-emerald-500" : "bg-rose-500"}`}
                          />
                          {cat.isActive ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-center gap-1">
                          {canWrite && (
                            <button
                              type="button"
                              onClick={() => {
                                setEditingCategory(cat);
                                setFormOpen(true);
                              }}
                              aria-label="Edit category"
                              className="flex h-7 w-7 items-center justify-center rounded-md border border-border/50 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                          )}
                          {canWrite &&
                            (cat.isActive ? (
                              <button
                                type="button"
                                disabled={isActioning === cat.id}
                                onClick={() => void handleDeactivate(cat.id)}
                                className="h-7 rounded-md bg-zinc-900 px-3 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-60"
                              >
                                Deactivate
                              </button>
                            ) : (
                              <button
                                type="button"
                                disabled={isActioning === cat.id}
                                onClick={() => void handleRestore(cat.id)}
                                className="h-7 rounded-md border border-zinc-300 bg-white px-3 text-xs font-medium text-zinc-900 hover:bg-zinc-50 disabled:opacity-60"
                              >
                                Restore
                              </button>
                            ))}
                          {canWrite && !cat.isActive && (
                            <button
                              type="button"
                              disabled={isActioning === cat.id}
                              onClick={() => void handlePermanentDelete(cat)}
                              aria-label="Permanently delete category"
                              className="flex h-7 w-7 items-center justify-center rounded-md border border-rose-200 bg-rose-50 text-rose-600 hover:bg-rose-100 transition-colors disabled:opacity-60"
                              title="Permanently delete"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </AdminTableScroll>

          <div className="border-t border-border/40 p-4">
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
