"use client";

import { useCallback, useEffect, useState } from "react";
import { AdminPagination } from "@/components/admin/AdminPagination";
import { AdminTableScroll } from "@/components/admin/AdminTableScroll";
import { AdminStatusBadge } from "@/components/admin/AdminStatusBadge";
import { useAdminAuth } from "@/contexts/admin-auth-context";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import { useAdminDataRefreshEffect } from "@/hooks/use-admin-data-refresh-effect";
import {
  buildAdminQuery,
  coercePaginatedResponse,
  type AdminInventoryListItem,
  readPaginatedItems,
  type PaginatedResponse,
} from "@/lib/admin-api";
import { getApiErrorMessage } from "@/lib/error-messages";
import { createIdempotencyKey } from "@/lib/idempotency";
import { notifyAdminDataChanged } from "@/lib/admin-data-refresh";
import { ADMIN_PERMISSIONS, hasAdminPermission } from "@/lib/permissions";
import { AlertCircle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 20;

const inputClass = "h-8 w-24 rounded-md border border-border bg-background px-2 text-sm focus:border-zinc-900 focus:outline-none";

interface AdminInventoryListProps {
  onViewHistory?: (variantId: string) => void;
}

export function AdminInventoryList({ onViewHistory }: AdminInventoryListProps) {
  const api = useAuthenticatedApi();
  const { adminUser } = useAdminAuth();
  const canWrite = hasAdminPermission(adminUser, ADMIN_PERMISSIONS.inventoryWrite);

  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<PaginatedResponse<AdminInventoryListItem> | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState("");
  const [threshold, setThreshold] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api<PaginatedResponse<AdminInventoryListItem>>(
        `/admin/inventory${buildAdminQuery({ page, limit: PAGE_SIZE })}`,
      );
      setData(coercePaginatedResponse(response));
    } catch (err) {
      setError(getApiErrorMessage(err));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [api, page]);

  useEffect(() => {
    void load();
  }, [load]);

  useAdminDataRefreshEffect(load, ["inventory", "products"]);

  function startEdit(row: AdminInventoryListItem) {
    setEditingId(row.variantId);
    setQuantity(String(row.quantity));
    setThreshold(String(row.lowStockThreshold));
  }

  async function saveEdit(variantId: string) {
    const payload: { quantity?: number; lowStockThreshold?: number } = {};
    if (quantity.trim()) payload.quantity = Number(quantity);
    if (threshold.trim()) payload.lowStockThreshold = Number(threshold);
    if (Object.keys(payload).length === 0) return;

    setSaving(true);
    setError(null);
    try {
      await api(`/admin/inventory/${variantId}`, {
        method: "PATCH",
        idempotencyKey: createIdempotencyKey(),
        body: JSON.stringify(payload),
      });
      setEditingId(null);
      await load();
      notifyAdminDataChanged(["inventory", "products", "dashboard"]);
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const items = readPaginatedItems(data);

  return (
    <div className="flex flex-col gap-4 min-w-0">
      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      <div className="flex flex-col rounded-xl border border-border/40 bg-card shadow-sm min-w-0 overflow-hidden">
        {loading && items.length === 0 ? (
          <div className="flex h-48 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : items.length === 0 ? (
          <div className="flex h-48 flex-col items-center justify-center gap-2 text-muted-foreground">
            <p className="text-sm">No inventory rows found.</p>
          </div>
        ) : (
          <>
            <AdminTableScroll>
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="border-b border-border/40 bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">Product</th>
                    <th className="px-4 py-3 font-medium">SKU</th>
                    <th className="px-4 py-3 font-medium">On Hand</th>
                    <th className="px-4 py-3 font-medium">Available</th>
                    <th className="px-4 py-3 font-medium">Threshold</th>
                    <th className="px-4 py-3 font-medium">Alert</th>
                    <th className="px-4 py-3 font-medium text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {items.map((row) => {
                    const available =
                      row.availableQuantity ??
                      Math.max(0, row.quantity - (row.reservedQuantity ?? 0));
                    const low = row.lowStockAlerted || available <= row.lowStockThreshold;
                    const isEditing = editingId === row.variantId;

                    return (
                      <tr key={row.id} className="group hover:bg-muted/30">
                        <td className="px-4 py-3">
                          <p className="font-semibold text-foreground">{row.variant.product.name}</p>
                          <p className="text-xs text-muted-foreground">{row.variant.name}</p>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                          {row.variant.sku}
                        </td>
                        <td className="px-4 py-3">
                          {isEditing ? (
                            <input
                              className={inputClass}
                              value={quantity}
                              onChange={(e) => setQuantity(e.target.value)}
                            />
                          ) : (
                            <span className={cn("font-medium", low && "text-amber-600")}>
                              {row.quantity}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 font-medium text-foreground">{available}</td>
                        <td className="px-4 py-3">
                          {isEditing ? (
                            <input
                              className={inputClass}
                              value={threshold}
                              onChange={(e) => setThreshold(e.target.value)}
                            />
                          ) : (
                            <span className="text-muted-foreground">{row.lowStockThreshold}</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {low ? (
                            <AdminStatusBadge label="Low stock" tone="warning" />
                          ) : (
                            <AdminStatusBadge label="OK" tone="success" />
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-center gap-2">
                            {canWrite &&
                              (isEditing ? (
                                <>
                                  <button
                                    type="button"
                                    disabled={saving}
                                    onClick={() => void saveEdit(row.variantId)}
                                    className="flex h-7 items-center rounded-md bg-zinc-900 px-3 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-60"
                                  >
                                    {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save"}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setEditingId(null)}
                                    className="h-7 rounded-md border border-border/50 px-3 text-xs text-muted-foreground hover:text-foreground"
                                  >
                                    Cancel
                                  </button>
                                </>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => startEdit(row)}
                                  className="h-7 rounded-md border border-border/50 px-3 text-xs font-medium text-foreground hover:bg-muted transition-colors"
                                >
                                  Adjust
                                </button>
                              ))}
                            {onViewHistory && (
                              <button
                                type="button"
                                onClick={() => onViewHistory(row.variantId)}
                                className="h-7 rounded-md border border-border/50 px-3 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                              >
                                History
                              </button>
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
              {data && <AdminPagination meta={data.meta} onPageChange={setPage} />}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
