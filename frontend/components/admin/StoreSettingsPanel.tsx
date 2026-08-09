"use client";

import { useEffect, useState } from "react";
import { useRefetchKey } from "@/hooks/use-refetch-key";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import { useAdminAuth } from "@/contexts/admin-auth-context";
import { ADMIN_PERMISSIONS, hasAdminPermission } from "@/lib/permissions";
import { createIdempotencyKey } from "@/lib/idempotency";
import type { AdminStoreProfile } from "@/lib/admin-api";
import { getApiErrorMessage } from "@/lib/error-messages";
import { toast } from "@/lib/toast";
import {
  Store,
  FileText,
  AlertTriangle,
  Info,
  Lock,
  Loader2,
  ReceiptText,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";
import { BRAND_LOGO_SRC } from "@/lib/constants";

// Server-side cap for the stored logo (matches STORE_LOGO_MAX_BYTES on the backend).
const LOGO_MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
/**
 * Target size for the stored logo. The invoice prints it ~54pt tall (≈0.75 inch), so
 * 512px on the longest side is already ~2× what a 300 DPI print needs — anything
 * larger is pure weight. Brand PNGs are routinely multi-megabyte (one client's is
 * 7.5 MB), which is why the picked file is normalised here rather than shipped as-is.
 */
const LOGO_TARGET_MAX_DIMENSION = 512;

/** Client-side input problem (bad/undecodable image) — its message is safe to show as-is. */
class LogoInputError extends Error {}

/**
 * Normalise a picked/fetched logo for upload: preserve the ORIGINAL ASPECT RATIO
 * always, downscale to a print-appropriate size when larger, and keep PNG (lossless,
 * transparency intact) unless the result still exceeds the cap — then fall back to a
 * lightly-compressed JPEG. Small images that already fit are uploaded byte-for-byte.
 * Returns null when the image cannot be decoded, so the caller can report a clear
 * message instead of shipping something the server will reject.
 */
async function prepareLogoForUpload(source: Blob): Promise<Blob | null> {
  const isPng = source.type === "image/png";
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(source);
  } catch {
    // Undecodable (not an image, or too large for the decoder) — only pass through
    // when it is already small enough for the server to validate and reject clearly.
    return source.size <= LOGO_MAX_UPLOAD_BYTES ? source : null;
  }
  try {
    const longest = Math.max(bitmap.width, bitmap.height);
    if (longest <= LOGO_TARGET_MAX_DIMENSION && source.size <= LOGO_MAX_UPLOAD_BYTES) {
      return source;
    }
    const scale = Math.min(1, LOGO_TARGET_MAX_DIMENSION / longest);
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return source.size <= LOGO_MAX_UPLOAD_BYTES ? source : null;
    ctx.drawImage(bitmap, 0, 0, width, height);
    const toBlob = (type: string, quality?: number) =>
      new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
    // PNG first for PNG sources (keeps transparency); canvas PNG output is
    // unoptimised, so fall back to JPEG if it somehow still exceeds the cap.
    const preferred = await toBlob(isPng ? "image/png" : "image/jpeg", isPng ? undefined : 0.9);
    if (preferred && preferred.size <= LOGO_MAX_UPLOAD_BYTES) return preferred;
    const jpeg = await toBlob("image/jpeg", 0.85);
    if (jpeg && jpeg.size <= LOGO_MAX_UPLOAD_BYTES) return jpeg;
    return null;
  } finally {
    bitmap.close();
  }
}

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
  const [contactPhone, setContactPhone] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  // Uploaded invoice/brand logo (stored server-side in StoreSettings; wins over
  // any legacy logoUrl). logoBust cache-busts the preview after each upload.
  const [hasUploadedLogo, setHasUploadedLogo] = useState(false);
  const [logoBusy, setLogoBusy] = useState<null | "upload" | "storefront" | "remove">(null);
  const [logoBust, setLogoBust] = useState(0);
  // A broken preview must never leave a half-rendered box in the layout.
  const [logoPreviewFailed, setLogoPreviewFailed] = useState(false);
  const [facebookUrl, setFacebookUrl] = useState("");
  const [instagramUrl, setInstagramUrl] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Merchant GST invoicing toggle (StoreSettings.gstInvoicingEnabled via the COD settings
  // endpoint). Turning it on/off takes effect live — no backend restart.
  const [gstInvoicingEnabled, setGstInvoicingEnabled] = useState(false);
  const [gstToggleLoaded, setGstToggleLoaded] = useState(false);
  const [gstToggleSaving, setGstToggleSaving] = useState(false);
  // GST BILLING toggle — whether invoices show a GST breakdown (carved out of the
  // GST-inclusive prices) and are titled "TAX INVOICE". Off → plain "INVOICE",
  // no tax columns. Never changes what the customer pays. Default (until the
  // merchant sets it): on only when a GSTIN is configured.
  const [gstBillingEnabled, setGstBillingEnabled] = useState(false);
  const [gstBillingSaving, setGstBillingSaving] = useState(false);

  // Surface transient error/success as global toast popups instead of large in-panel banners.
  useEffect(() => {
    if (error) toast.error(error);
  }, [error]);
  useEffect(() => {
    if (success) toast.success(success);
  }, [success]);

  useEffect(() => {
    let cancelled = false;
    void api<{ gstInvoicingEnabled: boolean; gstBillingEnabled: boolean }>("/admin/settings/cod")
      .then((config) => {
        if (!cancelled) {
          setGstInvoicingEnabled(config.gstInvoicingEnabled);
          setGstBillingEnabled(config.gstBillingEnabled);
          setGstToggleLoaded(true);
        }
      })
      .catch(() => {
        if (!cancelled) setGstToggleLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [api, refetchKey]);

  async function onToggleGstInvoicing(next: boolean) {
    if (!canWrite || gstToggleSaving) return;
    setGstToggleSaving(true);
    setError(null);
    try {
      const res = await api<{ gstInvoicingEnabled: boolean }>("/admin/settings/cod", {
        method: "PATCH",
        idempotencyKey: createIdempotencyKey(),
        body: JSON.stringify({ gstInvoicingEnabled: next }),
      });
      setGstInvoicingEnabled(res.gstInvoicingEnabled);
      setSuccess(
        res.gstInvoicingEnabled
          ? "GST invoicing enabled. Invoices will be generated for new orders."
          : "GST invoicing disabled. New orders will not generate invoices.",
      );
      setTimeout(() => setSuccess(null), 4000);
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setGstToggleSaving(false);
    }
  }

  async function onToggleGstBilling(next: boolean) {
    if (!canWrite || gstBillingSaving) return;
    setGstBillingSaving(true);
    setError(null);
    try {
      const res = await api<{ gstBillingEnabled: boolean }>("/admin/settings/cod", {
        method: "PATCH",
        idempotencyKey: createIdempotencyKey(),
        body: JSON.stringify({ gstBillingEnabled: next }),
      });
      setGstBillingEnabled(res.gstBillingEnabled);
      setSuccess(
        res.gstBillingEnabled
          ? "GST billing enabled — invoices show the GST included in your prices and are titled TAX INVOICE."
          : "GST billing disabled — invoices render as a plain INVOICE with no GST breakdown.",
      );
      setTimeout(() => setSuccess(null), 4000);
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setGstBillingSaving(false);
    }
  }

  async function uploadLogoBlob(blob: Blob, busy: "upload" | "storefront", fileName: string) {
    if (!canWrite || logoBusy) return;
    setLogoBusy(busy);
    setError(null);
    try {
      const prepared = await prepareLogoForUpload(blob);
      if (!prepared) {
        throw new LogoInputError(
          "That image could not be prepared for upload. Use a PNG or JPG logo under 2 MB.",
        );
      }
      const preparedType = prepared.type || blob.type || "image/png";
      const uploadName = preparedType === "image/jpeg" ? fileName.replace(/\.[^.]+$/, "") + ".jpg" : fileName;
      const form = new FormData();
      form.append("file", new File([prepared], uploadName, { type: preparedType }));
      await api<{ hasUploadedLogo: boolean }>("/admin/settings/store/logo", {
        method: "POST",
        body: form,
      });
      setHasUploadedLogo(true);
      setLogoUrl("");
      setLogoBust(Date.now());
      setLogoPreviewFailed(false);
      setSuccess("Logo saved — it will print on every invoice and credit note.");
      setTimeout(() => setSuccess(null), 4000);
    } catch (err) {
      // Client-side input problems carry their own actionable text; anything else is
      // an API error whose backend message (4xx) is already actionable.
      setError(err instanceof LogoInputError ? err.message : getApiErrorMessage(err));
    } finally {
      setLogoBusy(null);
    }
  }

  /** One-click: pull the storefront's own brand logo (same asset the site header uses). */
  async function onUseStorefrontLogo() {
    if (!canWrite || logoBusy) return;
    setError(null);
    try {
      // Same-origin public asset (BRAND_LOGO_SRC, the logo the storefront header shows).
      const response = await fetch(BRAND_LOGO_SRC);
      const contentType = response.headers.get("content-type") ?? "";
      if (!response.ok || !contentType.startsWith("image/")) {
        // A missing asset returns the SPA's HTML 404 page — uploading that would fail
        // server-side validation with a confusing message, so name the real problem.
        throw new LogoInputError(
          `The storefront logo asset (${BRAND_LOGO_SRC}) could not be loaded. Upload the logo file instead.`,
        );
      }
      await uploadLogoBlob(await response.blob(), "storefront", BRAND_LOGO_SRC.split("/").pop() || "logo.png");
    } catch (err) {
      setError(err instanceof LogoInputError ? err.message : getApiErrorMessage(err));
    }
  }

  async function onRemoveLogo() {
    if (!canWrite || logoBusy) return;
    setLogoBusy("remove");
    setError(null);
    try {
      await api<{ hasUploadedLogo: boolean }>("/admin/settings/store/logo", { method: "DELETE" });
      // Also clear any legacy URL-mode logo so "remove" really means text-only invoices.
      if (logoUrl.trim()) {
        await api<AdminStoreProfile>("/admin/settings/store", {
          method: "PATCH",
          idempotencyKey: createIdempotencyKey(),
          body: JSON.stringify({ logoUrl: null }),
        });
        setLogoUrl("");
      }
      setHasUploadedLogo(false);
      setLogoPreviewFailed(false);
      setSuccess("Logo removed — invoices will use a text-only header.");
      setTimeout(() => setSuccess(null), 4000);
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setLogoBusy(null);
    }
  }

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
          setContactPhone(result.contactPhone ?? "");
          setContactEmail(result.contactEmail ?? "");
          setLogoUrl(result.logoUrl ?? "");
          setHasUploadedLogo(result.hasUploadedLogo === true);
          setFacebookUrl(result.facebookUrl ?? "");
          setInstagramUrl(result.instagramUrl ?? "");
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
          // Empty string CLEARS the column (both registrations are optional and must be
          // removable — e.g. a surrendered GSTIN); undefined would silently keep the old
          // value while the UI shows the field as empty.
          gstin: gstin.trim(),
          fssaiNumber: fssaiNumber.trim(),
          sellerLegalName: sellerLegalName.trim() || undefined,
          sellerAddress: sellerAddress.trim() || undefined,
          sellerState: sellerState.trim() ? sellerState.trim() : null,
          contactPhone: contactPhone.trim() || undefined,
          contactEmail: contactEmail.trim() || undefined,
          // null clears the link (hides the footer icon); undefined would leave it unchanged.
          facebookUrl: facebookUrl.trim() ? facebookUrl.trim() : null,
          instagramUrl: instagramUrl.trim() ? instagramUrl.trim() : null,
          // logoUrl is intentionally NOT sent here — the logo is managed by the
          // upload/remove controls above (legacy URL values are cleared by Remove).
        }),
      });
      setSuccess("Store settings saved successfully.");
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
          Your store address (shown on the storefront footer) and the compliance IDs used on GST
          invoices. Brand name and website URL are set at deployment time by your platform admin.
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

        <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="grid min-w-0 grid-cols-1 gap-1.5 min-w-0">
            <span className="text-sm font-medium text-foreground">Store Name</span>
            <div className="flex min-w-0 items-center gap-2 rounded-lg border border-border bg-muted/40 px-3.5 py-2">
              <Store className="h-4 w-4 shrink-0 text-muted-foreground/60" aria-hidden />
              <span className="text-sm text-foreground font-medium truncate">{DEPLOYED_STORE_NAME}</span>
            </div>
            <span className="text-xs text-muted-foreground/70 truncate">
              From <code className="font-mono text-[10px]">NEXT_PUBLIC_STORE_NAME</code>
            </span>
          </div>

          <div className="grid min-w-0 grid-cols-1 gap-1.5 min-w-0">
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
      {/* Editable: Compliance IDs (GSTIN + FSSAI)                           */}
      {/* ------------------------------------------------------------------ */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void onSave();
        }}
        className="space-y-6"
      >
        {/* ------------------------------------------------------------------ */}
        {/* Always editable: Store details (footer address + invoice seller)    */}
        {/* ------------------------------------------------------------------ */}
        <div className="rounded-xl border border-border bg-muted/10 p-4 sm:p-5 space-y-4">
          <h4 className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <Store className="h-4 w-4 text-primary" aria-hidden />
            Store Details &amp; Address
            <span className="ml-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
              Shown on storefront
            </span>
          </h4>

          {!loaded && !error ? (
            <div className="space-y-3">
              <div className="h-14 animate-pulse rounded-lg bg-muted/60" />
              <div className="h-20 animate-pulse rounded-lg bg-muted/60" />
            </div>
          ) : (
            <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
              <label className="grid min-w-0 grid-cols-1 gap-1.5 text-sm font-medium text-foreground sm:col-span-2">
                Seller Legal Name
                <input
                  type="text"
                  placeholder="Registered business / store name"
                  maxLength={200}
                  className={inputClass}
                  value={sellerLegalName}
                  onChange={(e) => setSellerLegalName(e.target.value)}
                  disabled={!canWrite}
                />
              </label>

              <label className="grid min-w-0 grid-cols-1 gap-1.5 text-sm font-medium text-foreground sm:col-span-2">
                Store Address
                <textarea
                  rows={3}
                  placeholder="e.g. D.No.4-15, Tadikonda Mandalam, Bandarupalle, Guntur, Andhra Pradesh, 522018"
                  maxLength={500}
                  className={inputClass}
                  value={sellerAddress}
                  onChange={(e) => setSellerAddress(e.target.value)}
                  disabled={!canWrite}
                />
                <span className="text-xs font-normal text-muted-foreground">
                  Shown to customers in the storefront footer (and printed on tax invoices when GST
                  invoicing is on). Updates appear within ~a minute of saving.
                </span>
              </label>

              <label className="grid min-w-0 grid-cols-1 gap-1.5 text-sm font-medium text-foreground">
                Contact Phone
                <input
                  type="tel"
                  inputMode="tel"
                  placeholder="+91 98765 43210"
                  maxLength={30}
                  className={inputClass}
                  value={contactPhone}
                  onChange={(e) => setContactPhone(e.target.value)}
                  disabled={!canWrite}
                />
                <span className="text-xs font-normal text-muted-foreground">
                  Shown as the &ldquo;Call Us&rdquo; number in the storefront header &amp; footer.
                  Leave blank to hide it.
                </span>
              </label>

              <label className="grid min-w-0 grid-cols-1 gap-1.5 text-sm font-medium text-foreground">
                Contact Email
                <input
                  type="email"
                  inputMode="email"
                  placeholder="support@yourstore.com"
                  maxLength={200}
                  className={inputClass}
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                  disabled={!canWrite}
                />
                <span className="text-xs font-normal text-muted-foreground">
                  Shown to customers in the storefront footer and used for merchant shipment
                  notifications. Leave blank to hide it.
                </span>
              </label>

              <label className="grid min-w-0 grid-cols-1 gap-1.5 text-sm font-medium text-foreground sm:col-span-2">
                Operating State
                <input
                  type="text"
                  placeholder="Andhra Pradesh"
                  maxLength={100}
                  className={inputClass}
                  value={sellerState}
                  onChange={(e) => setSellerState(e.target.value)}
                  disabled={!canWrite}
                />
                <span className="text-xs text-muted-foreground/80">
                  State where the business is registered — also used for GST place-of-supply on
                  invoices.
                </span>
              </label>

              <div className="grid min-w-0 grid-cols-1 gap-1.5 text-sm font-medium text-foreground sm:col-span-2">
                Invoice Logo
                <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-background/50 p-3">
                  {/* Fixed-size preview box: the image is merchant-supplied and can be huge
                      (multi-megapixel brand PNGs), so the box owns the dimensions and clips —
                      never the intrinsic image size driving the panel layout. */}
                  <span className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-background">
                    {(hasUploadedLogo || logoUrl.trim()) && !logoPreviewFailed ? (
                      /* Merchant-supplied bytes served by the API (or a legacy URL) — outside
                         next/image remotePatterns, so a plain img is required here. */
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={
                          hasUploadedLogo
                            ? `${process.env.NEXT_PUBLIC_API_BASE_URL}/store/logo?v=${logoBust}`
                            : logoUrl.trim()
                        }
                        alt="Invoice logo preview"
                        className="max-h-full max-w-full object-contain p-1"
                        onError={() => setLogoPreviewFailed(true)}
                      />
                    ) : (
                      <span className="text-[10px] font-normal text-muted-foreground">
                        {logoPreviewFailed ? "?" : "No logo"}
                      </span>
                    )}
                  </span>
                  {canWrite ? (
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void onUseStorefrontLogo()}
                        disabled={logoBusy !== null}
                        className="flex h-9 items-center gap-1.5 rounded-lg border border-border bg-muted px-3 text-xs font-semibold transition-colors hover:bg-primary/10 hover:text-primary disabled:opacity-50 cursor-pointer"
                        aria-label="Use the storefront's brand logo on invoices"
                      >
                        {logoBusy === "storefront" ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Sparkles className="h-3.5 w-3.5" />
                        )}
                        Use storefront logo
                      </button>
                      <label className="flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-muted px-3 text-xs font-semibold transition-colors hover:bg-primary/10 hover:text-primary">
                        {logoBusy === "upload" ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Upload className="h-3.5 w-3.5" />
                        )}
                        Upload file
                        <input
                          type="file"
                          accept="image/png,image/jpeg"
                          className="sr-only"
                          disabled={logoBusy !== null}
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            e.target.value = "";
                            if (file) void uploadLogoBlob(file, "upload", file.name);
                          }}
                        />
                      </label>
                      {hasUploadedLogo || logoUrl.trim() ? (
                        <button
                          type="button"
                          onClick={() => void onRemoveLogo()}
                          disabled={logoBusy !== null}
                          className="flex h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50 cursor-pointer"
                          aria-label="Remove the invoice logo"
                        >
                          {logoBusy === "remove" ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="h-3.5 w-3.5" />
                          )}
                          Remove
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                <span className="text-xs font-normal text-muted-foreground">
                  Printed at the top-left of every invoice and credit note in its original
                  proportions. PNG or JPG; large images are lightly compressed automatically.
                  &ldquo;Use storefront logo&rdquo; copies the same logo your site header shows.
                </span>
              </div>

              <label className="grid min-w-0 grid-cols-1 gap-1.5 text-sm font-medium text-foreground">
                Facebook Link
                <input
                  type="url"
                  inputMode="url"
                  placeholder="https://facebook.com/yourpage"
                  maxLength={1000}
                  className={inputClass}
                  value={facebookUrl}
                  onChange={(e) => setFacebookUrl(e.target.value)}
                  disabled={!canWrite}
                />
                <span className="text-xs font-normal text-muted-foreground">
                  Shown as the Facebook icon in the storefront footer. Leave blank to hide it.
                </span>
              </label>

              <label className="grid min-w-0 grid-cols-1 gap-1.5 text-sm font-medium text-foreground">
                Instagram Link
                <input
                  type="url"
                  inputMode="url"
                  placeholder="https://instagram.com/yourhandle"
                  maxLength={1000}
                  className={inputClass}
                  value={instagramUrl}
                  onChange={(e) => setInstagramUrl(e.target.value)}
                  disabled={!canWrite}
                />
                <span className="text-xs font-normal text-muted-foreground">
                  Shown as the Instagram icon in the storefront footer. The WhatsApp icon needs no
                  link — it opens a chat with the Contact Phone above. Leave blank to hide it.
                </span>
              </label>
            </div>
          )}
        </div>

        {/* ------------------------------------------------------------------ */}
        {/* GST invoicing master toggle — merchant-controlled, takes effect live */}
        {/* ------------------------------------------------------------------ */}
        <label className="flex min-h-11 cursor-pointer items-center justify-between gap-4 rounded-xl border border-border bg-muted/10 p-4">
          <span className="flex items-start gap-3">
            <ReceiptText className="mt-0.5 h-5 w-5 text-primary" aria-hidden />
            <span>
              <span className="block text-sm font-medium text-foreground">GST invoicing</span>
              <span className="block text-xs text-muted-foreground">
                When on, a GST tax invoice PDF is generated for every new order and offered to
                the customer and admin. Requires the seller details below (name, address, state);
                GSTIN and FSSAI are optional and print only when provided.
                Takes effect immediately — no restart.
              </span>
            </span>
          </span>
          <input
            type="checkbox"
            className="h-5 w-5 accent-primary"
            checked={gstInvoicingEnabled}
            disabled={!canWrite || !gstToggleLoaded || gstToggleSaving}
            onChange={(e) => void onToggleGstInvoicing(e.target.checked)}
            aria-label="Enable GST invoicing"
          />
        </label>

        {/* ------------------------------------------------------------------ */}
        {/* GST-only: Compliance IDs (GSTIN + FSSAI) — gated by invoicing flag  */}
        {/* ------------------------------------------------------------------ */}
        {gstInvoicingEnabled ? (
          <>
        {/* GST BILLING — whether invoices carry a GST breakdown. Presentation-only:
            the GST shown is carved out of the GST-inclusive prices; totals never change. */}
        <label className="flex items-start justify-between gap-4 rounded-xl border border-border bg-muted/10 p-4 sm:p-5">
          <span className="flex items-start gap-3">
            <span>
              <span className="block text-sm font-medium text-foreground">GST billing on invoices</span>
              <span className="block text-xs text-muted-foreground">
                When on, invoices are titled TAX INVOICE and show the CGST/SGST (or IGST)
                included in your GST-inclusive prices, carved out per line — the grand total
                always stays exactly what the customer paid. When off, invoices render as a
                plain INVOICE with no tax columns. Until you set it, this follows your GSTIN:
                on when a GSTIN is filled in below, off otherwise.
              </span>
            </span>
          </span>
          <input
            type="checkbox"
            className="h-5 w-5 accent-primary"
            checked={gstBillingEnabled}
            disabled={!canWrite || !gstToggleLoaded || gstBillingSaving}
            onChange={(e) => void onToggleGstBilling(e.target.checked)}
            aria-label="Enable GST billing on invoices"
          />
        </label>
        {/* Fail-case warning when GST invoicing is on but the seller identity is missing.
            GSTIN and FSSAI are OPTIONAL — they print on invoices when provided but never
            block generation. */}
        {loaded && missingSellerDetails && (
          <div className="flex min-w-0 items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3.5 text-xs text-amber-800 overflow-hidden">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-600" aria-hidden />
            <span>
              <strong>GST invoicing is enabled</strong> but the seller identity is incomplete.
              Invoice PDF generation will fail until seller legal name, address, and operating
              state are filled in. (GSTIN and FSSAI are optional.)
            </span>
          </div>
        )}

        <div className="rounded-xl border border-border bg-muted/10 p-4 sm:p-5 space-y-4">
          <h4 className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
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
            <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
              <label className="grid min-w-0 grid-cols-1 gap-1.5 text-sm font-medium text-foreground">
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

              <label className="grid min-w-0 grid-cols-1 gap-1.5 text-sm font-medium text-foreground">
                FSSAI License Number (optional)
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
                  Food Safety and Standards Authority of India license. Optional — printed on
                  invoices when provided; leaving it blank never blocks invoice generation.
                </span>
              </label>
            </div>
          )}
        </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            GSTIN &amp; FSSAI fields are hidden because GST invoicing is turned off above. Turn it
            on to enter your tax details and start generating invoices. Your store address is
            still saved and shown on the storefront regardless.
          </p>
        )}

        {/* Error/success now surface as global toast popups (see the mirror effects above). */}

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
                "Save Store Settings"
              )}
            </button>
          </div>
        )}

        {!canWrite && loaded && (
          <p className="text-xs text-muted-foreground">
            You don&apos;t have permission to update store settings. Contact your admin.
          </p>
        )}
      </form>
    </div>
  );
}
