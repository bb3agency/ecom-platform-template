"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Info, Loader2 } from "lucide-react";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import { useAdminDataRefreshEffect } from "@/hooks/use-admin-data-refresh-effect";
import { useAdminAuth } from "@/contexts/admin-auth-context";
import { ADMIN_PERMISSIONS, hasAdminPermission } from "@/lib/permissions";
import type { AdminStorefrontCouponsStatus } from "@/lib/admin-api";
import { createIdempotencyKey } from "@/lib/idempotency";
import { getApiErrorMessage } from "@/lib/error-messages";
import { notifyAdminDataChanged } from "@/lib/admin-data-refresh";

export function AdminCouponsStorefrontBanner() {
  const api = useAuthenticatedApi();
  const { adminUser } = useAdminAuth();
  const canWrite = hasAdminPermission(adminUser, ADMIN_PERMISSIONS.couponsWrite);
  const [status, setStatus] = useState<AdminStorefrontCouponsStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api<AdminStorefrontCouponsStatus>("/admin/coupons/storefront-status");
      setStatus(data);
    } catch (err) {
      setError(getApiErrorMessage(err));
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  useAdminDataRefreshEffect(load, ["coupons"]);

  const onToggle = async (nextEnabled: boolean) => {
    if (!canWrite) return;
    setSaving(true);
    setError(null);
    try {
      const data = await api<AdminStorefrontCouponsStatus>("/admin/coupons/storefront-status", {
        method: "PATCH",
        idempotencyKey: createIdempotencyKey(),
        body: JSON.stringify({ couponsEnabled: nextEnabled }),
      });
      setStatus(data);
      notifyAdminDataChanged(["coupons", "dashboard"]);
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  if (loading && !status) {
    return (
      <div className="rounded-xl border border-border/40 bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
        Loading storefront coupon settings…
      </div>
    );
  }

  if (!status && error) {
    return (
      <div className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
        <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
        <p>Could not load storefront coupon settings: {error}</p>
      </div>
    );
  }

  if (!status) return null;

  const enabled = status.merchantEnabled;

  return (
    <div
      className={
        enabled
          ? "rounded-xl border border-emerald-300/60 bg-emerald-50 px-4 py-4 text-sm text-emerald-950"
          : "rounded-xl border border-amber-300/60 bg-amber-50 px-4 py-4 text-sm text-amber-950"
      }
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3 min-w-0">
          {enabled ? (
            <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
          ) : (
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          )}
          <div className="min-w-0">
            <p className="font-semibold">
              {enabled ? "Coupons are live on the storefront" : "Coupons are hidden on the storefront"}
            </p>
            <p className="mt-1 opacity-90">
              {enabled
                ? `Customers can apply coupon codes at cart and checkout. ${status.redeemableCouponCount} coupon${status.redeemableCouponCount === 1 ? "" : "s"} are currently redeemable.`
                : "Turn this on when you are ready for customers to use promo codes. Coupon management in admin stays available either way."}
            </p>
            {!enabled && status.redeemableCouponCount > 0 ? (
              <p className="mt-2 text-xs font-medium">
                You have {status.redeemableCouponCount} active coupon
                {status.redeemableCouponCount === 1 ? "" : "s"} — enable storefront coupons to let customers use them.
              </p>
            ) : null}
          </div>
        </div>

        <label className="flex shrink-0 items-center gap-3 rounded-lg border border-current/15 bg-white/60 px-3 py-2">
          <span className="text-xs font-semibold uppercase tracking-wide">
            Storefront coupons
          </span>
          <input
            type="checkbox"
            className="size-4 accent-[#23403d] disabled:opacity-50"
            checked={enabled}
            disabled={!canWrite || saving}
            onChange={(event) => void onToggle(event.target.checked)}
            aria-label="Enable coupon codes on the storefront"
          />
          {saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
        </label>
      </div>

      {error ? (
        <p className="mt-3 text-xs font-medium text-destructive">{error}</p>
      ) : null}

      {!canWrite ? (
        <p className="mt-3 text-xs opacity-80">You need coupon write permission to change this setting.</p>
      ) : null}
    </div>
  );
}
