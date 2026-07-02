"use client";

import { useEffect, useState } from "react";
import { useRefetchKey } from "@/hooks/use-refetch-key";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import { useAdminAuth } from "@/contexts/admin-auth-context";
import { ADMIN_PERMISSIONS, hasAdminPermission } from "@/lib/permissions";
import { createIdempotencyKey } from "@/lib/idempotency";
import type { AdminShippingSettings } from "@/lib/admin-api";
import { getApiErrorMessage } from "@/lib/error-messages";
import { toast } from "@/lib/toast";
import { Truck, MapPin, IndianRupee, AlertTriangle, Loader2, Package, Settings } from "lucide-react";
import { BoxPresetsPanel } from "@/components/admin/BoxPresetsPanel";

export function ShippingSettingsPanel() {
  const api = useAuthenticatedApi();
  const { adminUser } = useAdminAuth();
  const canWrite = hasAdminPermission(adminUser, ADMIN_PERMISSIONS.settingsWrite);
  const refetchKey = useRefetchKey();

  const [settings, setSettings] = useState<AdminShippingSettings | null>(null);
  const [pickupPincode, setPickupPincode] = useState("");
  // Displayed and entered in rupees (₹). Multiplied ×100 on save, divided ÷100 on load.
  const [minOrderValueRupees, setMinOrderValueRupees] = useState("");
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
    void api<AdminShippingSettings>("/admin/settings/shipping")
      .then((result) => {
        if (!cancelled) {
          setSettings(result);
          setPickupPincode(result.pickupPincode);
          // Convert paise → rupees for display. Show as integer if divisible by 100.
          const rupees = result.minOrderValuePaise / 100;
          setMinOrderValueRupees(rupees === 0 ? "" : String(Number.isInteger(rupees) ? rupees : rupees.toFixed(2)));
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
      // Convert rupees → paise. Round to avoid floating-point drift.
      const rupeesNum = parseFloat(minOrderValueRupees || "0");
      const minOrderValuePaise = Math.round(rupeesNum * 100);
      const updated = await api<AdminShippingSettings>("/admin/settings/shipping", {
        method: "PATCH",
        idempotencyKey: createIdempotencyKey(),
        body: JSON.stringify({ pickupPincode, minOrderValuePaise }),
      });
      setSettings(updated);
      // Reflect any server-normalised value back
      const rupees = updated.minOrderValuePaise / 100;
      setMinOrderValueRupees(rupees === 0 ? "" : String(Number.isInteger(rupees) ? rupees : rupees.toFixed(2)));
      setSuccess("Shipping settings updated successfully.");
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
        <h3 className="text-lg font-medium text-foreground">Shipping Settings</h3>
        <p className="text-sm text-muted-foreground">
          Manage fulfillment parameters including the origin pickup pincode and free/minimum order value thresholds.
        </p>
      </div>

      {!settings && !error ? (
        <div className="space-y-4">
          <div className="h-20 animate-pulse rounded-lg bg-muted/60" />
          <div className="h-20 animate-pulse rounded-lg bg-muted/60" />
        </div>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); void onSave(); }} className="space-y-6">
          {settings?.source === "default" && (
            <div className="flex min-w-0 items-start gap-2.5 rounded-lg border border-amber-500/20 bg-amber-500/10 p-3.5 text-xs text-amber-800 overflow-hidden">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden />
              <span className="break-words min-w-0">
                <strong>Using default placeholder pincode (500001).</strong> This is
                not your real warehouse/farm origin. Shipping providers (Delhivery,
                Shiprocket) will compute incorrect serviceability and charges until
                you save your actual pickup pincode below.
              </span>
            </div>
          )}
          {settings?.source === "environment" && (
            <div className="flex min-w-0 items-start gap-2.5 rounded-lg border border-blue-500/20 bg-blue-500/10 p-3.5 text-xs text-blue-800 overflow-hidden">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden />
              <span className="break-words min-w-0">
                Pincode is currently read from the deployment environment variable
                (SHIPROCKET_PICKUP_PINCODE / DELHIVERY_PICKUP_PINCODE). Save a value
                here to persist it in the database — environment values may change
                on deployment without warning.
              </span>
            </div>
          )}

          <div className="rounded-xl border border-border bg-muted/10 p-4 sm:p-5 space-y-4">
            <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <Truck className="h-4 w-4 text-primary" />
              Fulfillment & Delivery Origin
            </h4>
            
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-1.5 text-sm font-medium text-foreground">
                Pickup Pincode (Origin Pincode)
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-muted-foreground/60 select-none">
                    <MapPin className="h-4 w-4" />
                  </span>
                  <input
                    type="text"
                    maxLength={6}
                    required
                    placeholder="e.g. 560001"
                    className={`${inputClass} pl-10`}
                    value={pickupPincode}
                    onChange={(event) => setPickupPincode(event.target.value.replace(/\D/g, ""))}
                  />
                </div>
                <span className="text-xs text-muted-foreground/80">
                  Used by shipping integrations to calculate dynamic courier charges from your warehouse/store.
                </span>
              </label>

              <label className="grid gap-1.5 text-sm font-medium text-foreground">
                Minimum Order Value (₹)
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-muted-foreground/60 select-none">
                    <IndianRupee className="h-4 w-4" />
                  </span>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    placeholder="500"
                    className={`${inputClass} pl-10`}
                    value={minOrderValueRupees}
                    onChange={(event) => setMinOrderValueRupees(event.target.value)}
                  />
                </div>
                <span className="text-xs text-muted-foreground/80">
                  Orders below this amount will be rejected at checkout. Enter in rupees (e.g. 500 for ₹500).
                </span>
              </label>
            </div>
          </div>

          {settings?.source && settings.source !== "default" && (
            <div className="text-xs text-muted-foreground px-1">
              Configuration Active Source: <span className="font-semibold text-foreground uppercase">{settings.source}</span>
            </div>
          )}

          {/* Provider Availability Card */}
          {settings?.providerAvailability && (
            <div className="rounded-xl border border-border bg-muted/10 p-4 sm:p-5 space-y-3">
              <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <Package className="h-4 w-4 text-primary" />
                Shipping Provider Status
              </h4>
              {!settings.providerAvailability.hasAnyProvider && (
                <div className="flex min-w-0 items-start gap-2.5 rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-xs text-destructive overflow-hidden">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden />
                  <span className="break-words min-w-0">
                    <strong>No shipping provider is configured.</strong> Customers cannot get delivery rates at checkout.
                    Configure Delhivery or Shiprocket credentials in the{" "}
                    <a href="/ops/config" className="underline font-medium">Ops Config panel</a>.
                  </span>
                </div>
              )}
              <div className="grid gap-2 sm:grid-cols-2">
                <div className={`flex items-center gap-2.5 rounded-lg border p-3 text-sm ${settings.providerAvailability.delhiveryConfigured ? "border-green-500/30 bg-green-500/10" : "border-border bg-muted/20"}`}>
                  <div className={`h-2 w-2 shrink-0 rounded-full ${settings.providerAvailability.delhiveryConfigured ? "bg-green-500" : "bg-muted-foreground/30"}`} />
                  <div className="min-w-0">
                    <div className="font-medium text-foreground text-xs">Delhivery</div>
                    <div className={`text-xs ${settings.providerAvailability.delhiveryConfigured ? "text-green-700" : "text-muted-foreground"}`}>
                      {settings.providerAvailability.delhiveryConfigured ? "Configured" : "Not configured"}
                    </div>
                  </div>
                  {!settings.providerAvailability.delhiveryConfigured && (
                    <Settings className="h-3.5 w-3.5 text-muted-foreground/50 ml-auto shrink-0" aria-hidden />
                  )}
                </div>
                <div className={`flex items-center gap-2.5 rounded-lg border p-3 text-sm ${settings.providerAvailability.shiprocketConfigured ? "border-green-500/30 bg-green-500/10" : "border-border bg-muted/20"}`}>
                  <div className={`h-2 w-2 shrink-0 rounded-full ${settings.providerAvailability.shiprocketConfigured ? "bg-green-500" : "bg-muted-foreground/30"}`} />
                  <div className="min-w-0">
                    <div className="font-medium text-foreground text-xs">Shiprocket</div>
                    <div className={`text-xs ${settings.providerAvailability.shiprocketConfigured ? "text-green-700" : "text-muted-foreground"}`}>
                      {settings.providerAvailability.shiprocketConfigured ? "Configured" : "Not configured"}
                    </div>
                  </div>
                  {!settings.providerAvailability.shiprocketConfigured && (
                    <Settings className="h-3.5 w-3.5 text-muted-foreground/50 ml-auto shrink-0" aria-hidden />
                  )}
                </div>
              </div>
              {settings.providerAvailability.hasAnyProvider && (
                <p className="text-xs text-muted-foreground">
                  {settings.providerAvailability.delhiveryConfigured && settings.providerAvailability.shiprocketConfigured
                    ? "Both providers active — cheapest rate auto-selected at checkout."
                    : "One provider active — rates fetched from configured provider."}
                  {" "}Configure credentials in the <a href="/ops/config" className="underline">Ops Config panel</a>.
                </p>
              )}
            </div>
          )}

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
                "Save Shipping Settings"
              )}
            </button>
          </div>
        </form>
      )}

      {/* Box Presets Panel */}
      <BoxPresetsPanel canWrite={canWrite} />
    </div>
  );
}

