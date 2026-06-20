"use client";

import { useCallback, useEffect, useState } from "react";
import { AdminPagination } from "@/components/admin/AdminPagination";
import { AdminSection } from "@/components/admin/AdminSection";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import {
  buildAdminQuery,
  normalizePagination,
  readPaginatedItems,
  type AdminInventoryHistoryResponse,
} from "@/lib/admin-api";
import { formatAdminDate } from "@/lib/admin-format";
import { getApiErrorMessageWithHint } from "@/lib/error-messages";
import { Button } from "@/components/ui/button";

export function AdminInventoryHistoryPanel({
  initialVariantId = "",
}: {
  initialVariantId?: string;
}) {
  const api = useAuthenticatedApi();
  const [variantId, setVariantId] = useState(initialVariantId);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<AdminInventoryHistoryResponse | null>(null);

  const load = useCallback(
    async (targetPage: number) => {
      if (!variantId.trim()) {
        setError("Enter a variant ID.");
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const response = await api<AdminInventoryHistoryResponse>(
          `/admin/inventory/history/${variantId.trim()}${buildAdminQuery({
            page: targetPage,
            limit: 20,
          })}`,
        );
        setHistory(response);
      } catch (err) {
        setError(getApiErrorMessageWithHint(err));
        setHistory(null);
      } finally {
        setLoading(false);
      }
    },
    [api, variantId],
  );

  useEffect(() => {
    if (initialVariantId) {
      setVariantId(initialVariantId);
    }
  }, [initialVariantId]);

  useEffect(() => {
    if (initialVariantId.trim()) {
      void load(1);
    }
  }, [initialVariantId, load]);

  const meta = history ? normalizePagination(history) : null;
  const items = readPaginatedItems(history);

  return (
    <AdminSection
      title="Adjustment history"
      description="Stock changes for a specific variant."
      loading={loading}
      error={error}
      empty={Boolean(history && items.length === 0)}
      emptyMessage="No history entries for this variant."
      actions={
        <div className="flex flex-wrap gap-2">
          <input
            value={variantId}
            onChange={(event) => setVariantId(event.target.value)}
            placeholder="Variant ID"
            className="h-9 min-w-48 rounded-md border border-border bg-background px-2 text-sm"
          />
          <Button type="button" size="sm" variant="outline" onClick={() => void load(1)}>
            Load history
          </Button>
        </div>
      }
    >
      {history && meta ? (
        <>
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border bg-muted/50 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Delta</th>
                  <th className="px-3 py-2 font-medium">Qty after</th>
                  <th className="px-3 py-2 font-medium">Reason</th>
                  <th className="px-3 py-2 font-medium">When</th>
                </tr>
              </thead>
              <tbody>
                {items.map((entry) => (
                  <tr key={entry.id} className="border-b border-border last:border-0">
                    <td className="px-3 py-2 font-medium">
                      {entry.delta > 0 ? `+${entry.delta}` : entry.delta}
                    </td>
                    <td className="px-3 py-2">{entry.quantityAfter}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {entry.reason ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {formatAdminDate(entry.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <AdminPagination meta={meta} onPageChange={(next) => void load(next)} />
        </>
      ) : null}
    </AdminSection>
  );
}
