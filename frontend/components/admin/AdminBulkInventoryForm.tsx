"use client";

import { useState } from "react";
import { AdminSection } from "@/components/admin/AdminSection";
import { useAdminAuth } from "@/contexts/admin-auth-context";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import type { AdminBulkInventoryResult } from "@/lib/admin-api";
import { getApiErrorMessage } from "@/lib/error-messages";
import { createIdempotencyKey } from "@/lib/idempotency";
import { notifyAdminDataChanged } from "@/lib/admin-data-refresh";
import { ADMIN_PERMISSIONS, hasAdminPermission } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Plus, X } from "lucide-react";

const inputClass =
  "h-9 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary";

interface BulkRow {
  variantId: string;
  quantity: string;
  lowStockThreshold: string;
}

function emptyRow(): BulkRow {
  return { variantId: "", quantity: "", lowStockThreshold: "" };
}

export function AdminBulkInventoryForm() {
  const api = useAuthenticatedApi();
  const { adminUser } = useAdminAuth();
  const canWrite = hasAdminPermission(adminUser, ADMIN_PERMISSIONS.inventoryWrite);

  const [rows, setRows] = useState<BulkRow[]>([emptyRow()]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AdminBulkInventoryResult | null>(null);

  if (!canWrite) return null;

  async function onSubmit() {
    const updates = rows
      .map((row) => {
        if (!row.variantId.trim()) return null;
        const quantity = row.quantity.trim() ? Number(row.quantity) : undefined;
        const lowStockThreshold = row.lowStockThreshold.trim()
          ? Number(row.lowStockThreshold)
          : undefined;
        if (quantity === undefined && lowStockThreshold === undefined) return null;
        return {
          variantId: row.variantId.trim(),
          ...(quantity !== undefined && Number.isFinite(quantity) ? { quantity } : {}),
          ...(lowStockThreshold !== undefined && Number.isFinite(lowStockThreshold)
            ? { lowStockThreshold }
            : {}),
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null);

    if (updates.length === 0) {
      setError("Add at least one row with variant ID and quantity or threshold.");
      return;
    }

    setSaving(true);
    setError(null);
    setResult(null);
    try {
      const response = await api<AdminBulkInventoryResult>("/admin/inventory/bulk-update", {
        method: "POST",
        idempotencyKey: createIdempotencyKey(),
        body: JSON.stringify({ updates }),
      });
      setResult(response);
      notifyAdminDataChanged(["inventory", "products", "dashboard"]);
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <AdminSection
      title="Bulk inventory update"
      description="Update up to 100 variants in one request."
    >
      <div className="grid min-w-0 grid-cols-1 gap-4 rounded-2xl border border-border bg-card p-5">
        <p className="text-sm font-semibold text-foreground">Variant updates</p>
        <div className="grid min-w-0 grid-cols-1 gap-2">
          {rows.map((row, index) => (
            <div
              key={index}
              className="grid min-w-0 grid-cols-1 items-center gap-2 rounded-xl border border-border bg-muted/30 p-3 md:grid-cols-[1fr_1fr_1fr_auto]"
            >
              <input
                className={inputClass}
                placeholder="Variant ID"
                aria-label="Variant ID"
                value={row.variantId}
                onChange={(event) => {
                  const next = [...rows];
                  next[index] = { ...row, variantId: event.target.value };
                  setRows(next);
                }}
              />
              <input
                className={inputClass}
                placeholder="Quantity"
                aria-label="Quantity"
                value={row.quantity}
                onChange={(event) => {
                  const next = [...rows];
                  next[index] = { ...row, quantity: event.target.value };
                  setRows(next);
                }}
              />
              <input
                className={inputClass}
                placeholder="Low stock threshold"
                aria-label="Low stock threshold"
                value={row.lowStockThreshold}
                onChange={(event) => {
                  const next = [...rows];
                  next[index] = { ...row, lowStockThreshold: event.target.value };
                  setRows(next);
                }}
              />
              {rows.length > 1 ? (
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Remove row"
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => setRows(rows.filter((_, i) => i !== index))}
                >
                  <X aria-hidden />
                </Button>
              ) : null}
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={rows.length >= 100}
            onClick={() => setRows([...rows, emptyRow()])}
          >
            <Plus aria-hidden />
            Add row
          </Button>
          <Button type="button" loading={saving} onClick={() => void onSubmit()}>
            Apply bulk update
          </Button>
        </div>
        {error ? <p className="text-xs text-red-600">{error}</p> : null}
        {result ? (
          <p className="flex items-center gap-1.5 text-sm text-foreground">
            <CheckCircle2 className="size-4 text-emerald-600" aria-hidden />
            Updated {result.updated} variant(s).
            {result.failed.length > 0 ? ` Failed: ${result.failed.join(", ")}` : ""}
          </p>
        ) : null}
      </div>
    </AdminSection>
  );
}
