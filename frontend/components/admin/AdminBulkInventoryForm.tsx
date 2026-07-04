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

const inputClass =
  "h-9 w-full rounded-md border border-border bg-background px-2 text-sm";

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
      <div className="grid min-w-0 grid-cols-1 gap-2">
        {rows.map((row, index) => (
          <div
            key={index}
            className="grid min-w-0 grid-cols-1 gap-2 rounded-md border border-border p-2 md:grid-cols-4"
          >
            <input
              className={inputClass}
              placeholder="Variant ID"
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
              value={row.lowStockThreshold}
              onChange={(event) => {
                const next = [...rows];
                next[index] = { ...row, lowStockThreshold: event.target.value };
                setRows(next);
              }}
            />
            {rows.length > 1 ? (
              <button
                type="button"
                className="text-xs text-destructive"
                onClick={() => setRows(rows.filter((_, i) => i !== index))}
              >
                Remove
              </button>
            ) : null}
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="text-sm text-primary"
            disabled={rows.length >= 100}
            onClick={() => setRows([...rows, emptyRow()])}
          >
            + Add row
          </button>
          <button
            type="button"
            className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-60"
            disabled={saving}
            onClick={() => void onSubmit()}
          >
            {saving ? "Updating…" : "Apply bulk update"}
          </button>
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {result ? (
          <p className="text-sm text-zinc-900">
            Updated {result.updated} variant(s).
            {result.failed.length > 0
              ? ` Failed: ${result.failed.join(", ")}`
              : ""}
          </p>
        ) : null}
      </div>
    </AdminSection>
  );
}
