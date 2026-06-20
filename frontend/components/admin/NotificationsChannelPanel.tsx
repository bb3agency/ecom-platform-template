"use client";

import { useEffect, useState } from "react";
import {
  Mail,
  MessageSquare,
  MessagesSquare,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  ShieldAlert,
} from "lucide-react";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import { useAdminAuth } from "@/contexts/admin-auth-context";
import { ADMIN_PERMISSIONS, hasAdminPermission } from "@/lib/permissions";
import { createIdempotencyKey } from "@/lib/idempotency";
import { getApiErrorMessage } from "@/lib/error-messages";
import type {
  AdminNotificationSettings,
  NotificationProviderAvailability,
} from "@/lib/admin-api";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Customer-facing templates where per-template routing makes sense.
// Internal/ops templates (LowStockAlert, AdminInvite, OpsActionOtp, etc.)
// are intentionally excluded — they always use EMAIL and are ops-controlled.
// ---------------------------------------------------------------------------
const CUSTOMER_TEMPLATES: Array<{ id: string; label: string; hint: string }> = [
  {
    id: "OrderConfirmed",
    label: "Order confirmed",
    hint: "Sent immediately after a successful order placement",
  },
  {
    id: "PaymentFailed",
    label: "Payment failed",
    hint: "Sent when a prepaid payment attempt fails",
  },
  {
    id: "OrderShipped",
    label: "Order shipped",
    hint: "Sent when admin marks the order as shipped",
  },
  {
    id: "OutForDelivery",
    label: "Out for delivery",
    hint: "Sent when the shipment reaches out-for-delivery status",
  },
  {
    id: "OrderDelivered",
    label: "Order delivered",
    hint: "Sent when delivery is confirmed",
  },
  {
    id: "OrderCancelled",
    label: "Order cancelled",
    hint: "Sent when an order is cancelled by admin or customer",
  },
  {
    id: "OtpVerification",
    label: "OTP / verification code",
    hint: "Delivery channel for login and identity verification OTPs",
  },
  {
    id: "CustomerOtpVerification",
    label: "Customer OTP",
    hint: "Customer-specific OTP messages",
  },
  {
    id: "PasswordReset",
    label: "Password reset",
    hint: "Sent when a customer requests a password reset link",
  },
];

type Channel = "EMAIL" | "SMS" | "WHATSAPP";

// ---------------------------------------------------------------------------
// Provider badge — shows whether a provider is configured in ops or not
// ---------------------------------------------------------------------------
interface ProviderBadgeProps {
  provisioned: boolean;
  label: string;
}
function ProviderBadge({ provisioned, label }: ProviderBadgeProps) {
  if (provisioned) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-semibold text-green-700 ring-1 ring-green-200">
        <CheckCircle2 className="size-3" aria-hidden />
        {label}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700 ring-1 ring-amber-200">
      <ShieldAlert className="size-3" aria-hidden />
      Not configured
    </span>
  );
}

// ---------------------------------------------------------------------------
// "Channel not configured" callout — shown when a channel selected in routing
// is not provisioned in ops
// ---------------------------------------------------------------------------
interface UnconfiguredCalloutProps {
  channel: Channel;
  smsProvider: string | null;
}
function UnconfiguredCallout({ channel, smsProvider }: UnconfiguredCalloutProps) {
  const msgs: Record<Channel, string> = {
    EMAIL:
      "Email is not configured. The platform admin needs to set RESEND_API_KEY and enable NOTIFY_EMAIL_ENABLED in the ops config before email notifications will send.",
    SMS:
      smsProvider
        ? `SMS (${smsProvider}) is not configured. The platform admin needs to provision the API key for this provider in ops config.`
        : "SMS is not configured. The platform admin needs to set the SMS provider and its API key in ops config before SMS notifications will send.",
    WHATSAPP:
      "WhatsApp is not configured. The platform admin needs to provision META_WHATSAPP_ACCESS_TOKEN and META_WHATSAPP_PHONE_NUMBER_ID in ops config.",
  };

  return (
    <div className="mt-1.5 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
      <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-amber-600" aria-hidden />
      <p>{msgs[channel]}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Channel toggle card
// ---------------------------------------------------------------------------
interface ChannelCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  enabled: boolean;
  provisioned: boolean;
  providerLabel: string;
  disabled: boolean;
  onChange: (val: boolean) => void;
  providerNote?: string;
}
function ChannelCard({
  icon,
  title,
  description,
  enabled,
  provisioned,
  providerLabel,
  disabled,
  onChange,
  providerNote,
}: ChannelCardProps) {
  return (
    <div
      className={cn(
        "rounded-xl border p-4 sm:p-5 transition-colors",
        enabled && provisioned
          ? "border-green-200 bg-green-50/50"
          : enabled && !provisioned
          ? "border-amber-200 bg-amber-50/30"
          : "border-border bg-card"
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div
            className={cn(
              "flex size-9 shrink-0 items-center justify-center rounded-lg",
              provisioned ? "bg-green-100 text-green-700" : "bg-muted text-muted-foreground"
            )}
          >
            {icon}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-foreground">{title}</span>
              <ProviderBadge provisioned={provisioned} label={providerLabel} />
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
            {providerNote && (
              <p className="mt-1 text-[11px] text-muted-foreground/70">{providerNote}</p>
            )}
          </div>
        </div>

        {/* Toggle */}
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          disabled={disabled}
          onClick={() => onChange(!enabled)}
          className={cn(
            "relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
            enabled ? "bg-primary" : "bg-input"
          )}
        >
          <span
            className={cn(
              "pointer-events-none inline-block size-5 rounded-full bg-background shadow-lg ring-0 transition-transform",
              enabled ? "translate-x-5" : "translate-x-0"
            )}
          />
        </button>
      </div>

      {/* Warn when enabled but not provisioned */}
      {enabled && !provisioned && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-white px-3 py-2.5 text-xs text-amber-800">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-500" aria-hidden />
          <span>
            This channel is enabled in your store settings but{" "}
            <strong>has not been configured by your platform admin</strong>. Notifications using
            this channel will silently fail until ops configures the provider keys.
          </span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------
export function NotificationsChannelPanel() {
  const api = useAuthenticatedApi();
  const { adminUser } = useAdminAuth();
  const canWrite = hasAdminPermission(adminUser, ADMIN_PERMISSIONS.settingsWrite);

  const [settings, setSettings] = useState<AdminNotificationSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Local form state
  const [emailEnabled, setEmailEnabled] = useState(true);
  const [smsEnabled, setSmsEnabled] = useState(false);
  const [whatsappEnabled, setWhatsappEnabled] = useState(false);
  const [primaryChannels, setPrimaryChannels] = useState<Record<string, Channel>>({});

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void api<AdminNotificationSettings>("/admin/settings/notifications")
      .then((result) => {
        if (cancelled) return;
        setSettings(result);
        setEmailEnabled(result.emailEnabled);
        setSmsEnabled(result.smsEnabled);
        setWhatsappEnabled(result.whatsappEnabled);
        // Seed per-template routing with defaults
        const seeded: Record<string, Channel> = {};
        for (const tmpl of CUSTOMER_TEMPLATES) {
          seeded[tmpl.id] = (result.primaryChannels[tmpl.id] as Channel) ?? "EMAIL";
        }
        setPrimaryChannels(seeded);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(getApiErrorMessage(err));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const availability: NotificationProviderAvailability = settings?.providerAvailability ?? {
    emailProvisioned: false,
    smsProvisioned: false,
    whatsappProvisioned: false,
    smsProvider: null,
  };

  function isChannelAvailable(ch: Channel): boolean {
    if (ch === "EMAIL") return availability.emailProvisioned;
    if (ch === "SMS") return availability.smsProvisioned;
    if (ch === "WHATSAPP") return availability.whatsappProvisioned;
    return false;
  }

  // Count how many templates are routed to an unprovisioned channel
  const misconfiguredTemplates = CUSTOMER_TEMPLATES.filter(
    (t) => !isChannelAvailable(primaryChannels[t.id] ?? "EMAIL")
  ).length;

  async function handleSave() {
    if (!canWrite) return;
    setIsSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      const updated = await api<AdminNotificationSettings>("/admin/settings/notifications", {
        method: "PATCH",
        idempotencyKey: createIdempotencyKey(),
        body: JSON.stringify({
          emailEnabled,
          smsEnabled,
          whatsappEnabled,
          primaryChannels,
        }),
      });
      setSettings(updated);
      setSuccess("Notification settings saved.");
      setTimeout(() => setSuccess(null), 4000);
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const smsProviderLabel =
    availability.smsProvider === "msg91"
      ? "MSG91"
      : availability.smsProvider === "fast2sms"
      ? "Fast2SMS"
      : availability.smsProvider === "noop"
      ? "SMS (noop)"
      : "SMS";

  return (
    <div className="flex flex-col gap-6 sm:gap-8">
      {/* Header */}
      <div>
        <h2 className="font-heading text-base sm:text-lg font-semibold text-foreground">
          Notification Channels
        </h2>
        <p className="mt-1 text-xs sm:text-sm text-muted-foreground">
          Control which channels your store uses for customer notifications. Provider keys are
          managed by your platform admin in the Ops panel.
        </p>
      </div>

      {/* Global error */}
      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{error}</span>
        </div>
      )}

      {/* Channel availability cards */}
      <section>
        <h3 className="mb-3 text-xs font-bold uppercase tracking-widest text-muted-foreground">
          Channel availability
        </h3>
        <div className="flex flex-col gap-3">
          <ChannelCard
            icon={<Mail className="size-4" />}
            title="Email"
            description="Transactional emails via Resend. Recommended for all order lifecycle notifications."
            enabled={emailEnabled}
            provisioned={availability.emailProvisioned}
            providerLabel={availability.emailProvisioned ? "Resend" : "Email"}
            disabled={!canWrite}
            onChange={setEmailEnabled}
          />
          <ChannelCard
            icon={<MessageSquare className="size-4" />}
            title="SMS"
            description="Short message delivery via your configured SMS provider."
            enabled={smsEnabled}
            provisioned={availability.smsProvisioned}
            providerLabel={availability.smsProvisioned ? smsProviderLabel : "SMS"}
            disabled={!canWrite}
            onChange={setSmsEnabled}
            providerNote={
              availability.smsProvider === "noop"
                ? "SMS provider is set to 'noop' — messages will be logged but not delivered. Switch provider in ops config for live delivery."
                : undefined
            }
          />
          <ChannelCard
            icon={<MessagesSquare className="size-4" />}
            title="WhatsApp"
            description="WhatsApp Business messages via Meta Cloud API."
            enabled={whatsappEnabled}
            provisioned={availability.whatsappProvisioned}
            providerLabel={availability.whatsappProvisioned ? "Meta WhatsApp" : "WhatsApp"}
            disabled={!canWrite}
            onChange={setWhatsappEnabled}
          />
        </div>
      </section>

      {/* Per-template routing */}
      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
            Per-template routing
          </h3>
          {misconfiguredTemplates > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-semibold text-amber-700">
              <AlertTriangle className="size-3" aria-hidden />
              {misconfiguredTemplates} misconfigured
            </span>
          )}
        </div>
        <p className="mb-4 text-xs text-muted-foreground">
          Choose the primary delivery channel for each customer notification. Only configured
          channels can be selected.
        </p>

        <div className="flex flex-col gap-2">
          {CUSTOMER_TEMPLATES.map((tmpl) => {
            const current: Channel = (primaryChannels[tmpl.id] as Channel) ?? "EMAIL";
            const channelAvailable = isChannelAvailable(current);

            return (
              <div
                key={tmpl.id}
                className={cn(
                  "rounded-xl border p-3 sm:p-4",
                  channelAvailable ? "border-border bg-card" : "border-amber-200 bg-amber-50/30"
                )}
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">{tmpl.label}</p>
                    <p className="text-xs text-muted-foreground">{tmpl.hint}</p>
                  </div>

                  <div className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-muted/40 p-1">
                    {(["EMAIL", "SMS", "WHATSAPP"] as Channel[]).map((ch) => {
                      const avail = isChannelAvailable(ch);
                      const isSelected = current === ch;
                      return (
                        <button
                          key={ch}
                          type="button"
                          disabled={!canWrite || (!avail && !isSelected)}
                          onClick={() => {
                            if (!canWrite) return;
                            if (!avail) return; // can't select unavailable channel
                            setPrimaryChannels((prev) => ({ ...prev, [tmpl.id]: ch }));
                          }}
                          title={
                            avail
                              ? `Route to ${ch}`
                              : `${ch} is not configured — set up the provider in ops first`
                          }
                          className={cn(
                            "rounded-md px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider transition-colors",
                            isSelected && avail
                              ? "bg-primary text-primary-foreground shadow-sm"
                              : isSelected && !avail
                              ? "bg-amber-500 text-white shadow-sm"
                              : "text-muted-foreground hover:bg-background disabled:cursor-not-allowed disabled:opacity-40"
                          )}
                        >
                          {ch === "EMAIL" ? "Email" : ch === "SMS" ? "SMS" : "WA"}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Inline callout when selected channel is not provisioned */}
                {!channelAvailable && (
                  <UnconfiguredCallout
                    channel={current}
                    smsProvider={availability.smsProvider}
                  />
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Summary of issues */}
      {((!availability.emailProvisioned && emailEnabled) ||
        (!availability.smsProvisioned && smsEnabled) ||
        (!availability.whatsappProvisioned && whatsappEnabled) ||
        misconfiguredTemplates > 0) && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden />
            <div className="space-y-1.5">
              <p className="font-semibold text-amber-800">
                Some notifications won&apos;t send
              </p>
              <ul className="space-y-1 text-xs text-amber-700">
                {!availability.emailProvisioned && emailEnabled && (
                  <li>
                    • Email is enabled but RESEND_API_KEY is not set in ops config. All email
                    notifications will fail silently.
                  </li>
                )}
                {!availability.smsProvisioned && smsEnabled && (
                  <li>
                    • SMS is enabled but{" "}
                    {availability.smsProvider
                      ? `the ${smsProviderLabel} API key is not set`
                      : "no SMS provider is configured"}{" "}
                    in ops config. All SMS notifications will fail silently.
                  </li>
                )}
                {!availability.whatsappProvisioned && whatsappEnabled && (
                  <li>
                    • WhatsApp is enabled but Meta Cloud API credentials are not set in ops config.
                    All WhatsApp notifications will fail silently.
                  </li>
                )}
                {misconfiguredTemplates > 0 && (
                  <li>
                    • {misconfiguredTemplates} notification template
                    {misconfiguredTemplates !== 1 ? "s are" : " is"} routed to an unprovisioned
                    channel. Those notifications will fail silently.
                  </li>
                )}
              </ul>
              <p className="text-[11px] text-amber-600">
                Ask your platform admin to configure the missing provider keys in the Ops panel
                under Settings → Notifications.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* All-good banner */}
      {availability.emailProvisioned &&
        availability.smsProvisioned === smsEnabled &&
        availability.whatsappProvisioned === whatsappEnabled &&
        misconfiguredTemplates === 0 && (
          <div className="flex items-center gap-2 rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-800">
            <CheckCircle2 className="size-4 shrink-0 text-green-600" aria-hidden />
            <span className="font-medium">All active channels are configured and ready to send.</span>
          </div>
        )}

      {/* Save */}
      {canWrite && (
        <div className="flex flex-col gap-3 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
          {success && (
            <span className="flex items-center gap-1.5 text-sm font-medium text-green-700">
              <CheckCircle2 className="size-4" aria-hidden />
              {success}
            </span>
          )}
          {!success && <span />}
          <button
            type="button"
            onClick={handleSave}
            disabled={isSubmitting || !canWrite}
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden />
                Saving…
              </>
            ) : (
              "Save notification settings"
            )}
          </button>
        </div>
      )}

      {!canWrite && (
        <p className="text-xs text-muted-foreground">
          You don&apos;t have permission to change notification settings. Contact your admin.
        </p>
      )}
    </div>
  );
}
