"use client";

import { useCallback, useEffect, useState } from "react";
import { AdminSection } from "@/components/admin/AdminSection";
import { ensureArray, type AdminInventoryListItem } from "@/lib/admin-api";
import { getApiErrorMessage } from "@/lib/error-messages";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import { useAdminDataRefreshEffect } from "@/hooks/use-admin-data-refresh-effect";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PackageCheck } from "lucide-react";

export function AdminLowStockList() {
  const api = useAuthenticatedApi();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<AdminInventoryListItem[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api<AdminInventoryListItem[]>("/admin/inventory/low-stock");
      setItems(ensureArray(response));
    } catch (err) {
      setError(getApiErrorMessage(err));
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  useAdminDataRefreshEffect(load, ["inventory", "products"]);

  return (
    <AdminSection
      title="Low stock alerts"
      description="Variants at or below their low-stock threshold."
      loading={loading}
      error={error}
    >
      {!loading && !error && items.length === 0 ? (
        <EmptyState
          icon={PackageCheck}
          headline="Everything is fully stocked"
          description="No variants are at or below their low-stock threshold."
        />
      ) : (
        <ul className="divide-y divide-border/60 rounded-xl border border-border bg-card">
          {items.map((row) => {
            const out = row.quantity <= 0;
            return (
              <li
                key={row.id}
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm transition-colors hover:bg-muted/50"
              >
                <div className="min-w-0">
                  <p className="font-medium text-foreground">
                    {row.variant.product.name} · {row.variant.name}
                  </p>
                  <p className="font-mono text-xs text-muted-foreground">{row.variant.sku}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground">
                    <span className="font-semibold text-foreground">{row.quantity}</span>
                    {" "}/ threshold {row.lowStockThreshold}
                  </span>
                  {out ? (
                    <Badge variant="destructive" dot>
                      Out of Stock
                    </Badge>
                  ) : (
                    <Badge variant="warning" dot>
                      Low Stock
                    </Badge>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </AdminSection>
  );
}
