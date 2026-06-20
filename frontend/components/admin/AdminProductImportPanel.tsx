"use client";

import { useState } from "react";
import { AdminSection } from "@/components/admin/AdminSection";
import { useAdminAuth } from "@/contexts/admin-auth-context";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import { ensureArray, type AdminProductImportResult } from "@/lib/admin-api";
import { getApiErrorMessage } from "@/lib/error-messages";
import { createIdempotencyKey } from "@/lib/idempotency";
import { notifyAdminDataChanged } from "@/lib/admin-data-refresh";
import { ADMIN_PERMISSIONS, hasAdminPermission } from "@/lib/permissions";

export function AdminProductImportPanel() {
  const api = useAuthenticatedApi();
  const { adminUser } = useAdminAuth();
  const canWrite = hasAdminPermission(adminUser, ADMIN_PERMISSIONS.productsWrite);

  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AdminProductImportResult | null>(null);

  async function onImport() {
    if (!canWrite || !file) return;
    setUploading(true);
    setError(null);
    setResult(null);
    try {
      const formData = new FormData();
      formData.append("csvFile", file);
      const response = await api<AdminProductImportResult>(
        "/admin/products/import-csv",
        {
          method: "POST",
          idempotencyKey: createIdempotencyKey(),
          body: formData,
        },
      );
      setResult(response);
      setFile(null);
      notifyAdminDataChanged(["products", "inventory", "dashboard"]);
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setUploading(false);
    }
  }

  if (!canWrite) return null;

  return (
    <AdminSection
      title="CSV import"
      description="Bulk create or update products from a CSV file."
    >
      <div className="grid gap-3">
        <input
          type="file"
          accept=".csv,text/csv"
          className="text-sm"
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null);
            setResult(null);
            setError(null);
          }}
        />
        <button
          type="button"
          onClick={() => void onImport()}
          disabled={!file || uploading}
          className="h-9 w-fit rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-60"
        >
          {uploading ? "Importing…" : "Import CSV"}
        </button>
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        {result ? (
          <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
            <p>
              Created {result.createdCount}, updated {result.updatedCount}, failed{" "}
              {result.failedCount}.
            </p>
            {ensureArray<AdminProductImportResult["errors"][number]>(result.errors).length > 0 ? (
              <ul className="mt-2 list-inside list-disc text-xs text-muted-foreground">
                {ensureArray<AdminProductImportResult["errors"][number]>(result.errors)
                  .slice(0, 10)
                  .map((item) => (
                  <li key={`${item.line}-${item.message}`}>
                    Line {item.line}: {item.message}
                  </li>
                ))}
                {result.errors.length > 10 ? (
                  <li>…and {result.errors.length - 10} more</li>
                ) : null}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>
    </AdminSection>
  );
}
