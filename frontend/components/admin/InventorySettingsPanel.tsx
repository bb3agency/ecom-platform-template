"use client";

import { useEffect, useState } from "react";
import { useRefetchKey } from "@/hooks/use-refetch-key";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import { useAdminAuth } from "@/contexts/admin-auth-context";
import { ADMIN_PERMISSIONS, hasAdminPermission } from "@/lib/permissions";
import { createIdempotencyKey } from "@/lib/idempotency";
import type { AdminInventorySettings } from "@/lib/admin-api";
import { getApiErrorMessage } from "@/lib/error-messages";
import { toast } from "@/lib/toast";
import { Package, Loader2 } from "lucide-react";

export function InventorySettingsPanel() {
  const api = useAuthenticatedApi();
  const { adminUser } = useAdminAuth();
  const canWrite = hasAdminPermission(adminUser, ADMIN_PERMISSIONS.settingsWrite);
  const refetchKey = useRefetchKey();

  const [threshold, setThreshold] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Surface transient error/success as global toast popups instead of large in-panel banners.
  useEffect(() => {
    if (error) toast.error(error);
  }, [error]);
  useEffect(() => {
    if (success) toast.success(success);
  }, [success]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void api<AdminInventorySettings>("/admin/settings/inventory")
      .then((result) => {
        if (!cancelled) {
          setThreshold(result.defaultLowStockThreshold);
          setLoaded(true);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(getApiErrorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [api, refetchKey]);

  async function onSave() {
    if (!canWrite) return;
    setIsSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      await api<AdminInventorySettings>("/admin/settings/inventory", {
        method: "PATCH",
        idempotencyKey: createIdempotencyKey(),
        body: JSON.stringify({ defaultLowStockThreshold: threshold }),
      });
      setSuccess("Inventory settings updated successfully.");
      setTimeout(() => setSuccess(null), 4000);
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  const inputClass = "block w-full rounded-lg border border-border bg-background/50 px-3.5 py-2 text-sm text-foreground placeholder-muted-foreground/60 transition-all focus:border-primary focus:bg-background focus:ring-2 focus:ring-primary/20 focus:outline-hidden disabled:opacity-50";

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium text-foreground">Inventory Settings</h3>
        <p className="text-sm text-muted-foreground">
          Define global default parameters for stock management and dashboard alerts.
        </p>
      </div>

      {!loaded && !error ? (
        <div className="space-y-4">
          <div className="h-24 animate-pulse rounded-lg bg-muted/60" />
        </div>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); void onSave(); }} className="space-y-6">
          <div className="rounded-xl border border-border bg-muted/10 p-4 sm:p-5 space-y-4">
            <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <Package className="h-4 w-4 text-primary" />
              Stock Alerts & Thresholds
            </h4>
            
            <div className="space-y-4">
              <label className="grid min-w-0 grid-cols-1 gap-1.5 text-sm font-medium text-foreground">
                Default Low-Stock Threshold
                <input
                  type="number"
                  min={0}
                  required
                  placeholder="e.g. 5"
                  className={inputClass}
                  value={threshold}
                  onChange={(event) => setThreshold(Number(event.target.value || 0))}
                />
                <span className="text-xs text-muted-foreground/80 max-w-xl">
                  Products with stock quantity falling equal to or below this number will be flagged as &quot;Low Stock&quot; in tables and trigger automatic notifications.
                </span>
              </label>
            </div>
          </div>

          {/* Submit Action */}
          <div className="flex justify-end pt-2 border-t border-border">
            <button
              type="submit"
              disabled={isSubmitting || !canWrite}
              title={!canWrite ? "Requires settings:write permission" : undefined}
              className="flex w-full sm:w-auto min-h-11 items-center justify-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-all hover:bg-primary/95 focus:outline-hidden focus:ring-2 focus:ring-primary/20 disabled:opacity-50 cursor-pointer"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Saving Changes...
                </>
              ) : (
                "Save Inventory Settings"
              )}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

