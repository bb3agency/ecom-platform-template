"use client";

import { useCallback, useEffect, useState } from "react";
import { AdminPagination } from "@/components/admin/AdminPagination";
import { AdminTableScroll } from "@/components/admin/AdminTableScroll";
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
import { AlertCircle, Boxes } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";

const PAGE_SIZE = 20;

const inputClass =
  "h-8 w-24 rounded-lg border border-input bg-background px-2 text-right text-sm tabular-nums focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary";

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
    <div className="flex min-w-0 flex-col gap-4">
      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      <div className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        {loading && items.length === 0 ? (
          <div className="flex flex-col gap-3 p-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4">
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-4 w-16" />
                <Skeleton className="ml-auto h-4 w-20" />
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={Boxes}
            headline="No inventory rows found"
            description="Inventory rows appear here once products with variants exist."
            className="m-4"
          />
        ) : (
          <>
            <AdminTableScroll>
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="sticky top-0 z-10 border-b border-border bg-card text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">Product</th>
                    <th className="px-4 py-3 font-medium">SKU</th>
                    <th className="px-4 py-3 text-right font-medium">On Hand</th>
                    <th className="px-4 py-3 text-right font-medium">Available</th>
                    <th className="px-4 py-3 text-right font-medium">Threshold</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 text-center font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {items.map((row) => {
                    const available =
                      row.availableQuantity ??
                      Math.max(0, row.quantity - (row.reservedQuantity ?? 0));
                    const out = available <= 0;
                    const low = !out && (row.lowStockAlerted || available <= row.lowStockThreshold);
                    const isEditing = editingId === row.variantId;

                    return (
                      <tr key={row.id} className="group transition-colors hover:bg-muted/50">
                        <td className="px-4 py-3">
                          <p className="font-semibold text-foreground">{row.variant.product.name}</p>
                          <p className="text-xs text-muted-foreground">{row.variant.name}</p>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                          {row.variant.sku}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {isEditing ? (
                            <input
                              className={inputClass}
                              value={quantity}
                              aria-label="On-hand quantity"
                              onChange={(e) => setQuantity(e.target.value)}
                            />
                          ) : (
                            <span
                              className={cn(
                                "font-medium text-foreground",
                                low && "text-amber-600",
                                out && "text-red-600",
                              )}
                            >
                              {row.quantity}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right font-medium tabular-nums text-foreground">
                          {available}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {isEditing ? (
                            <input
                              className={inputClass}
                              value={threshold}
                              aria-label="Low-stock threshold"
                              onChange={(e) => setThreshold(e.target.value)}
                            />
                          ) : (
                            <span className="text-muted-foreground">{row.lowStockThreshold}</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {out ? (
                            <Badge variant="destructive" dot>
                              Out of Stock
                            </Badge>
                          ) : low ? (
                            <Badge variant="warning" dot>
                              Low Stock
                            </Badge>
                          ) : (
                            <Badge variant="success" dot>
                              In Stock
                            </Badge>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-center gap-2">
                            {canWrite &&
                              (isEditing ? (
                                <>
                                  <Button
                                    type="button"
                                    size="sm"
                                    loading={saving}
                                    onClick={() => void saveEdit(row.variantId)}
                                  >
                                    Save
                                  </Button>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => setEditingId(null)}
                                  >
                                    Cancel
                                  </Button>
                                </>
                              ) : (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  onClick={() => startEdit(row)}
                                >
                                  Adjust
                                </Button>
                              ))}
                            {onViewHistory && (
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                onClick={() => onViewHistory(row.variantId)}
                              >
                                History
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </AdminTableScroll>

            <div className="border-t border-border p-4">
              {data && <AdminPagination meta={data.meta} onPageChange={setPage} />}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
