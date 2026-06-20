"use client";

import { useCallback, useEffect, useState } from "react";
import { AdminSection } from "@/components/admin/AdminSection";
import { AdminStatusBadge } from "@/components/admin/AdminStatusBadge";
import { ensureArray, type AdminInventoryListItem } from "@/lib/admin-api";
import { getApiErrorMessage } from "@/lib/error-messages";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import { useAdminDataRefreshEffect } from "@/hooks/use-admin-data-refresh-effect";

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
      empty={!loading && !error && items.length === 0}
      emptyMessage="No low-stock alerts."
    >
      <ul className="divide-y divide-border rounded-md border border-border">
        {items.map((row) => (
          <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
            <div>
              <p className="font-medium">
                {row.variant.product.name} · {row.variant.name}
              </p>
              <p className="text-xs text-muted-foreground font-mono">{row.variant.sku}</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">
                Qty {row.quantity} / threshold {row.lowStockThreshold}
              </span>
              <AdminStatusBadge label="Low" tone="warning" />
            </div>
          </li>
        ))}
      </ul>
    </AdminSection>
  );
}
