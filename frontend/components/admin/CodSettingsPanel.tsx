"use client";

import { useEffect, useState } from "react";
import { useRefetchKey } from "@/hooks/use-refetch-key";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import { useAdminAuth } from "@/contexts/admin-auth-context";
import { ADMIN_PERMISSIONS, hasAdminPermission } from "@/lib/permissions";
import { createIdempotencyKey } from "@/lib/idempotency";
import { getApiErrorMessage } from "@/lib/error-messages";
import { toast } from "@/lib/toast";
import { Banknote, Clock, MapPin, Smartphone, Star, AlertTriangle, Loader2 } from "lucide-react";

interface CodSettings {
  isCodEnabled: boolean;
  cancellationWindowHours: number;
  sellerState: string | null;
  mobileOtpSignupEnabled?: boolean;
  reviewsEnabled?: boolean;
  returnsEnabled?: boolean;
}

export function CodSettingsPanel() {
  const api = useAuthenticatedApi();
  const { adminUser } = useAdminAuth();
  const canWrite = hasAdminPermission(adminUser, ADMIN_PERMISSIONS.settingsWrite);
  const refetchKey = useRefetchKey();

  const [settings, setSettings] = useState<CodSettings | null>(null);
  const [isCodEnabled, setIsCodEnabled] = useState(true);
  const [cancellationWindowHours, setCancellationWindowHours] = useState(24);
  const [mobileOtpSignupEnabled, setMobileOtpSignupEnabled] = useState(false);
  const [reviewsEnabled, setReviewsEnabled] = useState(false);
  const [returnsEnabled, setReturnsEnabled] = useState(true);
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
    async function load() {
      try {
        const result = await api<CodSettings>("/admin/settings/cod");
        if (cancelled) {
          return;
        }
        setSettings(result);
        setIsCodEnabled(result.isCodEnabled);
        setCancellationWindowHours(result.cancellationWindowHours);
        setMobileOtpSignupEnabled(result.mobileOtpSignupEnabled ?? false);
        setReviewsEnabled(result.reviewsEnabled ?? false);
        setReturnsEnabled(result.returnsEnabled ?? true);
      } catch (err) {
        if (!cancelled) {
          setError(getApiErrorMessage(err));
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [api, refetchKey]);

  const onSave = async () => {
    if (!canWrite) return;
    try {
      setIsSubmitting(true);
      setError(null);
      setSuccess(null);
      const payload = {
        isCodEnabled,
        cancellationWindowHours,
        mobileOtpSignupEnabled,
        reviewsEnabled,
        returnsEnabled,
      };
      const updated = await api<CodSettings>("/admin/settings/cod", {
        method: "PATCH",
        idempotencyKey: createIdempotencyKey(),
        body: JSON.stringify(payload),
      });
      setSettings(updated);
      setMobileOtpSignupEnabled(updated.mobileOtpSignupEnabled ?? false);
      setReviewsEnabled(updated.reviewsEnabled ?? false);
      setReturnsEnabled(updated.returnsEnabled ?? true);
      setSuccess("Settings updated successfully.");
      setTimeout(() => setSuccess(null), 4000);
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const inputClass = "block w-full rounded-lg border border-border bg-background/50 px-3.5 py-2 text-sm text-foreground placeholder-muted-foreground/60 transition-all focus:border-primary focus:bg-background focus:ring-2 focus:ring-primary/20 focus:outline-hidden disabled:opacity-50";

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium text-foreground">Cash on Delivery &amp; Sign-up Settings</h3>
        <p className="text-sm text-muted-foreground">
          Configure COD availability, customer cancellation policies, regional rules, and customer sign-up options.
        </p>
      </div>

      {!settings && !error ? (
        <div className="space-y-4">
          <div className="h-40 animate-pulse rounded-lg bg-muted/60" />
        </div>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); void onSave(); }} className="space-y-6">
          
          {/* Fail-case warnings */}
          {isCodEnabled && !settings?.sellerState?.trim() && (
            <div className="flex min-w-0 items-start gap-2.5 rounded-lg border border-amber-500/20 bg-amber-500/10 p-3.5 text-xs text-amber-800 overflow-hidden">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden />
              <span>
                <strong>Seller operating state is not set.</strong> GST invoice tax splits require
                the operating state in Admin → Settings → Store Profile.
              </span>
            </div>
          )}

          {/* Enable/Disable Card */}
          <div className="rounded-xl border border-border bg-muted/10 p-4 sm:p-5 space-y-4">
            <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <Banknote className="h-4 w-4 text-primary" />
              Availability Check
            </h4>
            
            <label className="flex items-start gap-3 rounded-lg border border-border bg-background/60 p-4 transition-all hover:bg-background cursor-pointer">
              <input
                type="checkbox"
                checked={isCodEnabled}
                onChange={(event) => setIsCodEnabled(event.target.checked)}
                className="mt-1 h-4.5 w-4.5 rounded-sm border-border text-primary focus:ring-primary/20"
              />
              <div className="space-y-0.5">
                <span className="text-sm font-medium text-foreground">
                  Accept Cash on Delivery Orders
                </span>
                <p className="text-xs text-muted-foreground">
                  Allow customers to choose cash/pay on delivery during checkout. If disabled, only prepaid options will be shown.
                </p>
              </div>
            </label>
          </div>

          {/* Configuration Card */}
          <div className="rounded-xl border border-border bg-muted/10 p-4 sm:p-5 space-y-5">
            <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <Clock className="h-4 w-4 text-primary" />
              Policies & Restrictions
            </h4>

            <div className="grid min-w-0 grid-cols-1 gap-5 sm:gap-6 sm:grid-cols-2">
              <label className="grid min-w-0 grid-cols-1 gap-1.5 text-sm font-medium text-foreground sm:col-span-2">
                Cancellation Window (Hours)
                <div className="relative">
                  <input
                    type="number"
                    min={1}
                    max={720}
                    required
                    placeholder="24"
                    className={`${inputClass} pr-14`}
                    value={cancellationWindowHours}
                    onChange={(event) => setCancellationWindowHours(Number(event.target.value || 1))}
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-muted-foreground pointer-events-none">
                    hours
                  </span>
                </div>
                <span className="text-xs text-muted-foreground/80">
                  Allow customers to cancel COD orders from their portal within this window.
                </span>
              </label>

              <div className="grid min-w-0 grid-cols-1 gap-1.5 text-sm font-medium text-foreground sm:col-span-2">
                <div className="flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                  Seller Operating State
                </div>
                <div className="rounded-lg border border-border bg-muted/40 px-3.5 py-2 text-sm text-foreground">
                  {settings?.sellerState?.trim() || "Not set"}
                </div>
                <span className="text-xs text-muted-foreground/80">
                  Edit in Admin → Settings → Store Profile (Tax &amp; Compliance section).
                </span>
              </div>
            </div>
          </div>

          {/* Mobile OTP Signup Toggle */}
          <div className="rounded-xl border border-border bg-muted/10 p-4 sm:p-5 space-y-4">
            <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <Smartphone className="h-4 w-4 text-primary" aria-hidden />
              Customer Sign-up Options
            </h4>

            <label className="flex items-start gap-3 rounded-lg border border-border bg-background/60 p-4 transition-all hover:bg-background cursor-pointer">
              <input
                type="checkbox"
                checked={mobileOtpSignupEnabled}
                onChange={(event) => setMobileOtpSignupEnabled(event.target.checked)}
                className="mt-1 h-4 w-4 rounded-sm border-border text-primary focus:ring-primary/20"
              />
              <div className="space-y-0.5 min-w-0">
                <span className="text-sm font-medium text-foreground">
                  Allow Sign-up with Mobile Number (WhatsApp OTP)
                </span>
                <p className="text-xs text-muted-foreground">
                  When enabled, customers see a &quot;Sign up with Mobile&quot; tab on the
                  registration page. OTP is sent via WhatsApp. Disabled by default — enable
                  only if WhatsApp messaging is configured.
                </p>
              </div>
            </label>
          </div>

          {/* Customer Reviews Toggle */}
          <div className="rounded-xl border border-border bg-muted/10 p-4 sm:p-5 space-y-4">
            <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <Star className="h-4 w-4 text-primary" aria-hidden />
              Storefront Features
            </h4>

            <label className="flex items-start gap-3 rounded-lg border border-border bg-background/60 p-4 transition-all hover:bg-background cursor-pointer">
              <input
                type="checkbox"
                checked={reviewsEnabled}
                onChange={(event) => setReviewsEnabled(event.target.checked)}
                className="mt-1 h-4 w-4 rounded-sm border-border text-primary focus:ring-primary/20"
              />
              <div className="space-y-0.5 min-w-0">
                <span className="text-sm font-medium text-foreground">
                  Enable Customer Reviews
                </span>
                <p className="text-xs text-muted-foreground">
                  When enabled, star ratings show on product cards and product pages, and
                  customers can review products they&apos;ve had delivered (reviews appear
                  after you approve them in Reviews). Disabled by default.
                </p>
              </div>
            </label>

            <label className="flex items-start gap-3 rounded-lg border border-border bg-background/60 p-4 transition-all hover:bg-background cursor-pointer">
              <input
                type="checkbox"
                checked={returnsEnabled}
                onChange={(event) => setReturnsEnabled(event.target.checked)}
                className="mt-1 h-4 w-4 rounded-sm border-border text-primary focus:ring-primary/20"
              />
              <div className="space-y-0.5 min-w-0">
                <span className="text-sm font-medium text-foreground">
                  Allow Order Returns
                </span>
                <p className="text-xs text-muted-foreground">
                  When enabled, customers can request a return/replacement on delivered orders
                  from their account; requests land in your Returns queue for approval. Turning
                  this off hides the return option on the storefront and blocks new requests
                  server-side — returns already in progress are unaffected.
                </p>
              </div>
            </label>
          </div>

          {/* Submit Action */}
          <div className="flex justify-start pt-2 border-t border-border">
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
                "Save COD Settings"
              )}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

