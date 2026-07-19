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
import { Button } from "@/components/ui/button";
import { FileSpreadsheet, Upload } from "lucide-react";

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
      <div className="grid min-w-0 grid-cols-1 gap-4 rounded-2xl border border-border bg-card p-5">
        <div className="flex items-center gap-2">
          <span className="flex size-5 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
            1
          </span>
          <p className="text-sm font-semibold text-foreground">Choose a CSV file</p>
        </div>
        <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-border bg-muted/30 p-8 text-center transition-colors hover:bg-muted/50">
          <Upload className="size-6 text-muted-foreground" aria-hidden />
          <span className="text-sm font-medium text-foreground">
            {file ? file.name : "Click to select a CSV file"}
          </span>
          <span className="text-xs text-muted-foreground">.csv only</span>
          <input
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              setResult(null);
              setError(null);
            }}
          />
        </label>
        <div className="flex items-center gap-2">
          <span className="flex size-5 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
            2
          </span>
          <p className="text-sm font-semibold text-foreground">Run the import</p>
        </div>
        <Button
          type="button"
          className="w-fit"
          onClick={() => void onImport()}
          disabled={!file}
          loading={uploading}
        >
          {!uploading && <FileSpreadsheet aria-hidden />}
          Import CSV
        </Button>
        {error ? (
          <p className="text-xs text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        {result ? (
          <div className="rounded-xl border border-border bg-muted/30 p-4 text-sm text-foreground">
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
