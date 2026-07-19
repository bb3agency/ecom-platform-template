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
            className="h-9 min-w-48 rounded-lg border border-input bg-background px-3 font-mono text-sm text-foreground placeholder:font-sans placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <Button type="button" size="sm" variant="outline" onClick={() => void load(1)}>
            Load history
          </Button>
        </div>
      }
    >
      {history && meta ? (
        <>
          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <ul className="divide-y divide-border/60">
              {items.map((entry) => (
                <li
                  key={entry.id}
                  className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 transition-colors hover:bg-muted/50"
                >
                  <span
                    className={
                      entry.delta > 0
                        ? "w-14 shrink-0 font-semibold tabular-nums text-emerald-600"
                        : entry.delta < 0
                          ? "w-14 shrink-0 font-semibold tabular-nums text-red-600"
                          : "w-14 shrink-0 font-semibold tabular-nums text-muted-foreground"
                    }
                  >
                    {entry.delta > 0 ? `+${entry.delta}` : entry.delta < 0 ? `−${Math.abs(entry.delta)}` : "0"}
                  </span>
                  <span className="text-sm text-foreground">
                    {entry.reason ?? "Adjustment"}
                  </span>
                  <span className="ml-auto flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
                    <span className="tabular-nums">After: {entry.quantityAfter}</span>
                    <span>{formatAdminDate(entry.createdAt)}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <AdminPagination meta={meta} onPageChange={(next) => void load(next)} />
        </>
      ) : null}
    </AdminSection>
  );
}
