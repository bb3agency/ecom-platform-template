"use client";

import { useEffect, useState } from "react";
import { useRefetchKey } from "@/hooks/use-refetch-key";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import { useAdminAuth } from "@/contexts/admin-auth-context";
import { ADMIN_PERMISSIONS, hasAdminPermission } from "@/lib/permissions";
import { createIdempotencyKey } from "@/lib/idempotency";
import type { AdminStoreProfile } from "@/lib/admin-api";
import { getApiErrorMessage } from "@/lib/error-messages";
import { fetchPublicStoreConfigClient } from "@/lib/storefront-settings";
import {
  Store,
  FileText,
  CheckCircle2,
  AlertTriangle,
  Info,
  Lock,
  Loader2,
} from "lucide-react";

// ---------------------------------------------------------------------------
// These two values are deployment-time configuration set by the platform admin
// in the backend .env / frontend .env.local. They are shown as read-only here.
// ---------------------------------------------------------------------------
const DEPLOYED_STORE_NAME = process.env.NEXT_PUBLIC_STORE_NAME ?? "(not set)";
const DEPLOYED_WEBSITE_URL = process.env.NEXT_PUBLIC_STOREFRONT_URL ?? "(not set)";

export function StoreSettingsPanel() {
  const api = useAuthenticatedApi();
  const { adminUser } = useAdminAuth();
  const canWrite = hasAdminPermission(adminUser, ADMIN_PERMISSIONS.settingsWrite);

  const refetchKey = useRefetchKey();

  const [gstin, setGstin] = useState("");
  const [fssaiNumber, setFssaiNumber] = useState("");
  const [sellerLegalName, setSellerLegalName] = useState("");
  const [sellerAddress, setSellerAddress] = useState("");
  const [sellerState, setSellerState] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [gstInvoicingEnabled, setGstInvoicingEnabled] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetchPublicStoreConfigClient().then((config) => {
      if (!cancelled) {
        setGstInvoicingEnabled(config.gstInvoicingEnabled);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void api<AdminStoreProfile>("/admin/settings/store")
      .then((result) => {
        if (!cancelled) {
          setGstin(result.gstin ?? "");
          setFssaiNumber(result.fssaiNumber ?? "");
          setSellerLegalName(result.sellerLegalName ?? "");
          setSellerAddress(result.sellerAddress ?? "");
          setSellerState(result.sellerState ?? "");
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
      await api<AdminStoreProfile>("/admin/settings/store", {
        method: "PATCH",
        idempotencyKey: createIdempotencyKey(),
        body: JSON.stringify({
          gstin: gstin.trim() || undefined,
          fssaiNumber: fssaiNumber.trim() || undefined,
          sellerLegalName: sellerLegalName.trim() || undefined,
          sellerAddress: sellerAddress.trim() || undefined,
          sellerState: sellerState.trim() ? sellerState.trim() : null,
        }),
      });
      setSuccess("Compliance IDs saved successfully.");
      setTimeout(() => setSuccess(null), 4000);
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  const inputClass =
    "block w-full rounded-lg border border-border bg-background/50 px-3.5 py-2 text-sm text-foreground placeholder-muted-foreground/60 transition-all focus:border-primary focus:bg-background focus:ring-2 focus:ring-primary/20 focus:outline-hidden disabled:opacity-50";

  const missingSellerDetails =
    !sellerLegalName.trim() || !sellerAddress.trim() || !sellerState.trim();

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium text-foreground">Store Profile</h3>
        <p className="text-sm text-muted-foreground">
          Compliance registration IDs used on GST invoices. Brand identity and contact
          details are configured at deployment time by your platform admin.
        </p>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Read-only: Deployment-time brand identity                           */}
      {/* ------------------------------------------------------------------ */}
      <div className="rounded-xl border border-border bg-muted/10 p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <Lock className="h-4 w-4 text-muted-foreground/70" aria-hidden />
            Brand Identity
          </h4>
          <span className="rounded-full bg-muted/60 px-2 py-0.5 text-[10px] font-medium text-muted-foreground/70 whitespace-nowrap">
            Read only — deployment config
          </span>
        </div>

        <div className="flex min-w-0 items-start gap-2.5 rounded-lg border border-blue-200/60 bg-blue-50/60 p-3 text-xs text-blue-800 overflow-hidden">
          <Info className="h-3.5 w-3.5 shrink-0 mt-0.5 text-blue-500" aria-hidden />
          <span className="break-words min-w-0">
            Store name and website URL are set in the deployment environment by your platform
            admin (<code className="font-mono text-[10px] break-all">NEXT_PUBLIC_STORE_NAME</code> and{" "}
            <code className="font-mono text-[10px] break-all">NEXT_PUBLIC_STOREFRONT_URL</code>). To
            update these values, ask your platform admin to update the deployment config.
          </span>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5 min-w-0">
            <span className="text-sm font-medium text-foreground">Store Name</span>
            <div className="flex min-w-0 items-center gap-2 rounded-lg border border-border bg-muted/40 px-3.5 py-2">
              <Store className="h-4 w-4 shrink-0 text-muted-foreground/60" aria-hidden />
              <span className="text-sm text-foreground font-medium truncate">{DEPLOYED_STORE_NAME}</span>
            </div>
            <span className="text-xs text-muted-foreground/70 truncate">
              From <code className="font-mono text-[10px]">NEXT_PUBLIC_STORE_NAME</code>
            </span>
          </div>

          <div className="grid gap-1.5 min-w-0">
            <span className="text-sm font-medium text-foreground">Website URL</span>
            <div className="flex min-w-0 items-center gap-2 rounded-lg border border-border bg-muted/40 px-3.5 py-2">
              <span className="text-sm text-foreground truncate">{DEPLOYED_WEBSITE_URL}</span>
            </div>
            <span className="text-xs text-muted-foreground/70 truncate">
              From <code className="font-mono text-[10px]">NEXT_PUBLIC_STOREFRONT_URL</code>
            </span>
          </div>
        </div>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Merchant contact note                                               */}
      {/* ------------------------------------------------------------------ */}
      <div className="flex min-w-0 items-start gap-2.5 rounded-lg border border-muted bg-muted/30 p-3.5 text-xs text-muted-foreground overflow-hidden">
        <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" aria-hidden />
        <span>
          <strong className="text-foreground">Merchant shipment notifications</strong> (email/SMS
          to your store team when an order ships) use the merchant contact email and phone from your
          store settings. These fields have been removed from this panel to simplify configuration
          — ask your platform admin to seed them via the backend if merchant shipment alerts are
          needed.
        </span>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Editable: Compliance IDs (GSTIN + FSSAI)                           */}
      {/* ------------------------------------------------------------------ */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void onSave();
        }}
        className="space-y-6"
      >
        {gstInvoicingEnabled ? (
          <>
        {/* Fail-case warning when GST invoicing is on but IDs are missing */}
        {loaded && (!gstin.trim() || !fssaiNumber.trim() || missingSellerDetails) && (
          <div className="flex min-w-0 items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3.5 text-xs text-amber-800 overflow-hidden">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-600" aria-hidden />
            <span>
              <strong>GST invoicing is enabled</strong> but required invoice fields are missing.
              Invoice PDF generation will fail until GSTIN, FSSAI, seller legal name, address, and
              operating state are filled in.
            </span>
          </div>
        )}

        <div className="rounded-xl border border-border bg-muted/10 p-4 sm:p-5 space-y-4">
          <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <FileText className="h-4 w-4 text-primary" aria-hidden />
            Taxation &amp; Compliance IDs
            <span className="ml-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
              Required for invoices
            </span>
          </h4>

          {!loaded && !error ? (
            <div className="space-y-3">
              <div className="h-14 animate-pulse rounded-lg bg-muted/60" />
              <div className="h-14 animate-pulse rounded-lg bg-muted/60" />
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-1.5 text-sm font-medium text-foreground sm:col-span-2">
                Seller Legal Name
                <input
                  type="text"
                  placeholder="Registered business name on GST certificate"
                  maxLength={200}
                  className={inputClass}
                  value={sellerLegalName}
                  onChange={(e) => setSellerLegalName(e.target.value)}
                  disabled={!canWrite}
                />
              </label>

              <label className="grid gap-1.5 text-sm font-medium text-foreground sm:col-span-2">
                Seller / Store Address
                <textarea
                  rows={3}
                  placeholder="Full registered address — printed on tax invoices AND shown on the storefront footer"
                  maxLength={500}
                  className={inputClass}
                  value={sellerAddress}
                  onChange={(e) => setSellerAddress(e.target.value)}
                  disabled={!canWrite}
                />
                <span className="text-xs font-normal text-muted-foreground">
                  Shown to customers in the storefront footer. Updates appear within ~a minute of saving.
                </span>
              </label>

              <label className="grid gap-1.5 text-sm font-medium text-foreground">
                Operating State
                <input
                  type="text"
                  placeholder="Telangana"
                  maxLength={100}
                  className={inputClass}
                  value={sellerState}
                  onChange={(e) => setSellerState(e.target.value)}
                  disabled={!canWrite}
                />
                <span className="text-xs text-muted-foreground/80">
                  State where the business is registered — used for GST place-of-supply on invoices.
                </span>
              </label>

              <label className="grid gap-1.5 text-sm font-medium text-foreground">
                GSTIN
                <input
                  type="text"
                  placeholder="29AAAAA1111A1Z1"
                  maxLength={15}
                  className={inputClass}
                  value={gstin}
                  onChange={(e) => setGstin(e.target.value.toUpperCase())}
                  disabled={!canWrite}
                />
                <span className="text-xs text-muted-foreground/80">
                  15-character Goods &amp; Services Tax Identification Number. Printed on every
                  GST invoice.
                </span>
              </label>

              <label className="grid gap-1.5 text-sm font-medium text-foreground">
                FSSAI License Number
                <input
                  type="text"
                  placeholder="14-digit number"
                  maxLength={14}
                  className={inputClass}
                  value={fssaiNumber}
                  onChange={(e) =>
                    setFssaiNumber(e.target.value.replace(/\D/g, ""))
                  }
                  disabled={!canWrite}
                />
                <span className="text-xs text-muted-foreground/80">
                  Food Safety and Standards Authority of India license. Mandatory for food
                  businesses under FSSAI regulations.
                </span>
              </label>
            </div>
          )}
        </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            GST invoicing fields are hidden because{" "}
            GST invoice fields are hidden because GST invoicing is disabled in backend store config.
          </p>
        )}

        {error && (
          <div className="flex min-w-0 items-start gap-2.5 rounded-lg border border-destructive/20 bg-destructive/10 p-3.5 text-xs text-destructive overflow-hidden">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden />
            <span>{error}</span>
          </div>
        )}

        {success && (
          <div className="flex min-w-0 items-start gap-2.5 rounded-lg border border-green-200 bg-green-50 p-3.5 text-xs text-green-800 overflow-hidden">
            <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5 text-green-600" aria-hidden />
            <span>{success}</span>
          </div>
        )}

        {canWrite && (
          <div className="flex justify-end pt-2 border-t border-border">
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex w-full sm:w-auto min-h-11 items-center justify-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-all hover:bg-primary/95 focus:outline-hidden focus:ring-2 focus:ring-primary/20 disabled:opacity-50 cursor-pointer"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  Saving…
                </>
              ) : (
                "Save Compliance IDs"
              )}
            </button>
          </div>
        )}

        {!canWrite && loaded && (
          <p className="text-xs text-muted-foreground">
            You don&apos;t have permission to update compliance IDs. Contact your admin.
          </p>
        )}
      </form>
    </div>
  );
}
