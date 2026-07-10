"use client";

import { useEffect, useState } from "react";
import { useRefetchKey } from "@/hooks/use-refetch-key";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import { useAdminAuth } from "@/contexts/admin-auth-context";
import { ADMIN_PERMISSIONS, hasAdminPermission } from "@/lib/permissions";
import { createIdempotencyKey } from "@/lib/idempotency";
import type { AdminLocalDeliverySettings } from "@/lib/admin-api";
import { getApiErrorMessage } from "@/lib/error-messages";
import { toast } from "@/lib/toast";
import { Bike, IndianRupee, Loader2, MapPin, Plus, Trash2 } from "lucide-react";

interface PincodeRow {
  pincode: string;
  /** Fee entered in rupees; empty string = use the store default fee. */
  feeRupees: string;
}

function paiseToRupeesString(paise: number | null): string {
  if (paise == null) return "";
  const rupees = paise / 100;
  return String(Number.isInteger(rupees) ? rupees : rupees.toFixed(2));
}

function rupeesStringToPaise(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const parsed = parseFloat(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed * 100);
}

export function LocalDeliverySettingsPanel() {
  const api = useAuthenticatedApi();
  const { adminUser } = useAdminAuth();
  const canWrite = hasAdminPermission(adminUser, ADMIN_PERMISSIONS.settingsWrite);
  const refetchKey = useRefetchKey();

  const [loaded, setLoaded] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [rows, setRows] = useState<PincodeRow[]>([]);
  const [defaultFeeRupees, setDefaultFeeRupees] = useState("20");
  const [freeAboveRupees, setFreeAboveRupees] = useState("");
  const [estimatedDays, setEstimatedDays] = useState("1");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (error) toast.error(error);
  }, [error]);

  useEffect(() => {
    let cancelled = false;
    void api<AdminLocalDeliverySettings>("/admin/settings/local-delivery")
      .then((result) => {
        if (cancelled) return;
        setEnabled(result.enabled);
        setRows(
          result.pincodes.map((entry) => ({
            pincode: entry.pincode,
            feeRupees: paiseToRupeesString(entry.feePaise),
          }))
        );
        setDefaultFeeRupees(paiseToRupeesString(result.defaultFeePaise) || "20");
        setFreeAboveRupees(paiseToRupeesString(result.freeAbovePaise));
        setEstimatedDays(String(result.estimatedDays));
        setLoaded(true);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(getApiErrorMessage(err));
          setLoaded(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [api, refetchKey]);

  function updateRow(index: number, patch: Partial<PincodeRow>) {
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  async function onSave() {
    if (!canWrite) return;

    const seen = new Set<string>();
    for (const row of rows) {
      const pincode = row.pincode.trim();
      if (!/^[1-9][0-9]{5}$/.test(pincode)) {
        setError(`"${pincode || "(empty)"}" is not a valid 6-digit pincode.`);
        return;
      }
      if (seen.has(pincode)) {
        setError(`Pincode ${pincode} is listed more than once.`);
        return;
      }
      seen.add(pincode);
    }

    setIsSubmitting(true);
    setError(null);
    try {
      const updated = await api<AdminLocalDeliverySettings>("/admin/settings/local-delivery", {
        method: "PATCH",
        idempotencyKey: createIdempotencyKey(),
        body: JSON.stringify({
          enabled,
          pincodes: rows.map((row) => ({
            pincode: row.pincode.trim(),
            feePaise: rupeesStringToPaise(row.feeRupees),
          })),
          defaultFeePaise: rupeesStringToPaise(defaultFeeRupees) ?? 2000,
          freeAbovePaise: rupeesStringToPaise(freeAboveRupees),
          estimatedDays: Math.max(1, Math.min(7, parseInt(estimatedDays || "1", 10) || 1)),
        }),
      });
      setEnabled(updated.enabled);
      setRows(
        updated.pincodes.map((entry) => ({
          pincode: entry.pincode,
          feeRupees: paiseToRupeesString(entry.feePaise),
        }))
      );
      setDefaultFeeRupees(paiseToRupeesString(updated.defaultFeePaise) || "20");
      setFreeAboveRupees(paiseToRupeesString(updated.freeAbovePaise));
      setEstimatedDays(String(updated.estimatedDays));
      toast.success("Local delivery settings updated successfully.");
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  const inputClass =
    "block w-full rounded-lg border border-border bg-background/50 px-3.5 py-2 text-sm text-foreground placeholder-muted-foreground/60 transition-all focus:border-primary focus:bg-background focus:ring-2 focus:ring-primary/20 focus:outline-hidden disabled:opacity-50";

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium text-foreground">Local Delivery</h3>
        <p className="text-sm text-muted-foreground">
          Deliver orders from whitelisted pincodes yourself — Delhivery/Shiprocket are never
          invoked for these orders. You update the order status manually and print the invoice
          from the order page.
        </p>
      </div>

      {!loaded ? (
        <div className="space-y-4">
          <div className="h-20 animate-pulse rounded-lg bg-muted/60" />
          <div className="h-20 animate-pulse rounded-lg bg-muted/60" />
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void onSave();
          }}
          className="space-y-6"
        >
          {/* Master toggle */}
          <label className="flex min-h-11 cursor-pointer items-center justify-between gap-4 rounded-xl border border-border bg-muted/10 p-4">
            <span className="flex items-center gap-3">
              <Bike className="h-5 w-5 text-primary" aria-hidden />
              <span>
                <span className="block text-sm font-medium text-foreground">Enable local delivery</span>
                <span className="block text-xs text-muted-foreground">
                  When off, all orders use the courier providers regardless of the pincode list.
                </span>
              </span>
            </span>
            <input
              type="checkbox"
              className="h-5 w-5 accent-primary"
              checked={enabled}
              disabled={!canWrite}
              onChange={(event) => setEnabled(event.target.checked)}
              aria-label="Enable local delivery"
            />
          </label>

          {/* Pincode + fee rows */}
          <div className="rounded-xl border border-border bg-muted/10 p-4 sm:p-5 space-y-4">
            <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <MapPin className="h-4 w-4 text-primary" />
              Whitelisted Pincodes & Fees
            </h4>
            <p className="text-xs text-muted-foreground">
              Orders shipped to these pincodes are delivered by you. Leave the fee blank to
              charge the default fee. Set higher fees for pincodes farther from the store.
            </p>

            {rows.length === 0 && (
              <p className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                No pincodes whitelisted yet — add your first local pincode below.
              </p>
            )}

            <div className="space-y-2">
              {rows.map((row, index) => (
                <div key={index} className="flex min-w-0 items-center gap-2">
                  <div className="relative w-36 shrink-0">
                    <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-muted-foreground/60 select-none">
                      <MapPin className="h-3.5 w-3.5" />
                    </span>
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={6}
                      required
                      placeholder="Pincode"
                      aria-label={`Local pincode ${index + 1}`}
                      className={`${inputClass} pl-9`}
                      value={row.pincode}
                      disabled={!canWrite}
                      onChange={(event) =>
                        updateRow(index, { pincode: event.target.value.replace(/\D/g, "") })
                      }
                    />
                  </div>
                  <div className="relative min-w-0 flex-1">
                    <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-muted-foreground/60 select-none">
                      <IndianRupee className="h-3.5 w-3.5" />
                    </span>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      placeholder={`Default (₹${defaultFeeRupees || "20"})`}
                      aria-label={`Delivery fee for pincode ${row.pincode || index + 1}`}
                      className={`${inputClass} pl-9`}
                      value={row.feeRupees}
                      disabled={!canWrite}
                      onChange={(event) => updateRow(index, { feeRupees: event.target.value })}
                    />
                  </div>
                  <button
                    type="button"
                    aria-label={`Remove pincode ${row.pincode || index + 1}`}
                    disabled={!canWrite}
                    onClick={() => setRows((current) => current.filter((_, i) => i !== index))}
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:border-destructive/40 hover:text-destructive disabled:opacity-50 cursor-pointer"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>

            <button
              type="button"
              disabled={!canWrite}
              onClick={() => setRows((current) => [...current, { pincode: "", feeRupees: "" }])}
              className="flex min-h-11 items-center gap-2 rounded-lg border border-dashed border-border px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground disabled:opacity-50 cursor-pointer"
            >
              <Plus className="h-4 w-4" />
              Add pincode
            </button>
          </div>

          {/* Fee defaults */}
          <div className="rounded-xl border border-border bg-muted/10 p-4 sm:p-5 space-y-4">
            <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <IndianRupee className="h-4 w-4 text-primary" />
              Fees & Delivery Estimate
            </h4>
            <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-3">
              <label className="grid min-w-0 grid-cols-1 gap-1.5 text-sm font-medium text-foreground">
                Default fee (₹)
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  required
                  className={inputClass}
                  value={defaultFeeRupees}
                  disabled={!canWrite}
                  onChange={(event) => setDefaultFeeRupees(event.target.value)}
                />
                <span className="text-xs text-muted-foreground/80">
                  Charged when a pincode has no fee of its own (₹20 recommended).
                </span>
              </label>
              <label className="grid min-w-0 grid-cols-1 gap-1.5 text-sm font-medium text-foreground">
                Free above (₹)
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  placeholder="Never free"
                  className={inputClass}
                  value={freeAboveRupees}
                  disabled={!canWrite}
                  onChange={(event) => setFreeAboveRupees(event.target.value)}
                />
                <span className="text-xs text-muted-foreground/80">
                  Order subtotal at/above which local delivery becomes free. Leave blank to disable.
                </span>
              </label>
              <label className="grid min-w-0 grid-cols-1 gap-1.5 text-sm font-medium text-foreground">
                Estimated days
                <input
                  type="number"
                  min={1}
                  max={7}
                  required
                  className={inputClass}
                  value={estimatedDays}
                  disabled={!canWrite}
                  onChange={(event) => setEstimatedDays(event.target.value)}
                />
                <span className="text-xs text-muted-foreground/80">
                  Delivery estimate shown to customers at checkout (1 = same/next day).
                </span>
              </label>
            </div>
          </div>

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
                "Save Local Delivery Settings"
              )}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
