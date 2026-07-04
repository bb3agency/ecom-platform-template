"use client";

import { useCallback, useEffect, useState } from "react";
import { BellRing, Loader2 } from "lucide-react";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import { createIdempotencyKey } from "@/lib/idempotency";
import { getApiErrorMessage } from "@/lib/error-messages";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

type AlertChannel = "EMAIL" | "WHATSAPP" | "SMS";

interface AdminNotificationPreferences {
  enabled: boolean;
  channels: AlertChannel[];
  email: string | null;
  phone: string | null;
}

const CHANNEL_OPTIONS: Array<{ value: AlertChannel; label: string; needsPhone: boolean }> = [
  { value: "EMAIL", label: "Email", needsPhone: false },
  { value: "WHATSAPP", label: "WhatsApp", needsPhone: true },
  { value: "SMS", label: "SMS", needsPhone: true },
];

/**
 * Per-admin opt-in for new-order alerts. Personal to the signed-in admin (own
 * profile, no extra permission) — every opted-in admin is notified on their
 * selected channels whenever a customer places an order.
 */
export function AdminMyOrderAlertsPanel() {
  const api = useAuthenticatedApi();
  const [prefs, setPrefs] = useState<AdminNotificationPreferences | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [channels, setChannels] = useState<AlertChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api<AdminNotificationPreferences>(
        "/admin/me/notification-preferences",
      );
      setPrefs(result);
      setEnabled(result.enabled);
      setChannels(result.channels);
    } catch (err) {
      toast.error(getApiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(nextEnabled: boolean, nextChannels: AlertChannel[]) {
    setSaving(true);
    try {
      const result = await api<AdminNotificationPreferences>(
        "/admin/me/notification-preferences",
        {
          method: "PATCH",
          idempotencyKey: createIdempotencyKey(),
          body: JSON.stringify({ enabled: nextEnabled, channels: nextChannels }),
        },
      );
      setPrefs(result);
      setEnabled(result.enabled);
      setChannels(result.channels);
      toast.success(
        result.enabled
          ? "You will be notified about new orders."
          : "New-order notifications turned off.",
      );
    } catch (err) {
      toast.error(getApiErrorMessage(err));
      // Reload server truth so the toggles never show an unsaved state.
      void load();
    } finally {
      setSaving(false);
    }
  }

  const hasPhone = Boolean(prefs?.phone?.trim());

  return (
    <section className="grid min-w-0 grid-cols-1 gap-4 rounded-xl border border-border bg-muted/10 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <BellRing className="h-4 w-4 text-muted-foreground/70" aria-hidden />
          Notify me about new orders
        </h4>
        {loading || saving ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden />
        ) : null}
      </div>

      <p className="text-xs text-muted-foreground">
        Personal setting — only affects your account. Every admin who opts in gets an alert on
        their selected channels whenever a customer places an order.
      </p>

      <label className="flex items-center gap-3 cursor-pointer">
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-border text-zinc-900 focus:ring-zinc-900 disabled:opacity-60"
          checked={enabled}
          disabled={loading || saving}
          onChange={(e) => {
            const next = e.target.checked;
            // Enabling with no channels defaults to EMAIL (backend rejects empty).
            const nextChannels = next && channels.length === 0 ? (["EMAIL"] as AlertChannel[]) : channels;
            setEnabled(next);
            setChannels(nextChannels);
            void save(next, nextChannels);
          }}
        />
        <span className="text-sm font-medium">Send me an alert for every new order</span>
      </label>

      {enabled ? (
        <div className="grid min-w-0 grid-cols-1 gap-2 pl-7">
          {CHANNEL_OPTIONS.map((option) => {
            const checked = channels.includes(option.value);
            const blocked = option.needsPhone && !hasPhone;
            return (
              <label
                key={option.value}
                className={cn(
                  "flex items-center gap-3",
                  blocked ? "cursor-not-allowed opacity-60" : "cursor-pointer",
                )}
              >
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-border text-zinc-900 focus:ring-zinc-900 disabled:opacity-60"
                  checked={checked}
                  disabled={loading || saving || blocked}
                  onChange={(e) => {
                    const nextChannels = e.target.checked
                      ? [...channels, option.value]
                      : channels.filter((c) => c !== option.value);
                    if (nextChannels.length === 0) {
                      toast.error("Keep at least one channel selected, or turn alerts off.");
                      return;
                    }
                    setChannels(nextChannels);
                    void save(true, nextChannels);
                  }}
                />
                <span className="text-sm">{option.label}</span>
                {blocked ? (
                  <span className="text-xs text-muted-foreground">
                    (add a phone number to your admin account to enable)
                  </span>
                ) : null}
              </label>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
