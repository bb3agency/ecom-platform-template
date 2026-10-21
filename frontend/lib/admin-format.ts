import { formatPrice } from "@/lib/format-price";

export type AdminStatusTone = "success" | "warning" | "destructive" | "default";

export function formatPaise(paise: number): string {
  return formatPrice(paise);
}

export function formatCouponUsageLabel(
  usesCount: number | null | undefined,
  maxUsesTotal: number | null | undefined,
): string {
  const used = Number.isFinite(Number(usesCount)) ? Number(usesCount) : 0;
  const limit =
    maxUsesTotal != null && Number.isFinite(Number(maxUsesTotal))
      ? String(maxUsesTotal)
      : "∞";
  return `${used} / ${limit}`;
}

export function formatAdminDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

const ORDER_STATUS_TONE: Record<string, AdminStatusTone> = {
  DELIVERED: "success",
  CONFIRMED: "default",
  PROCESSING: "warning",
  SHIPPED: "warning",
  OUT_FOR_DELIVERY: "warning",
  CANCELLED: "destructive",
  REFUNDED: "destructive",
};

export function orderStatusTone(status: string): AdminStatusTone {
  return ORDER_STATUS_TONE[status] ?? "default";
}

const PAYMENT_STATUS_TONE: Record<string, AdminStatusTone> = {
  CREATED: "warning",
  CAPTURED: "success",
  PAID: "success",
  AUTHORIZED: "warning",
  PENDING: "warning",
  FAILED: "destructive",
  REFUNDED: "default",
  PARTIALLY_REFUNDED: "warning",
};

export function paymentStatusTone(status: string): AdminStatusTone {
  return PAYMENT_STATUS_TONE[status.toUpperCase()] ?? "default";
}

const RETURN_STATUS_TONE: Record<string, AdminStatusTone> = {
  REQUESTED: "warning",
  APPROVED: "default",
  REJECTED: "destructive",
  PICKED_UP: "warning",
  REFUNDED: "success",
};

export function returnStatusTone(status: string): AdminStatusTone {
  return RETURN_STATUS_TONE[status] ?? "default";
}

const COUPON_STATUS_TONE: Record<string, AdminStatusTone> = {
  active: "success",
  paused: "warning",
  expired: "default",
  deleted: "destructive",
};

export function couponStatusTone(status: string): AdminStatusTone {
  return COUPON_STATUS_TONE[status] ?? "default";
}

export function reviewApprovalTone(approved: boolean): AdminStatusTone {
  return approved ? "success" : "warning";
}

/** Dot tone for the console StatusDot (see components/ui/console.tsx). */
export type AdminDotTone = "neutral" | "success" | "warning" | "danger" | "info" | "brand";

const ORDER_STATUS_DISPLAY: Record<string, { label: string; tone: AdminDotTone }> = {
  PENDING_PAYMENT: { label: "Awaiting payment", tone: "warning" },
  PAYMENT_FAILED: { label: "Payment failed", tone: "danger" },
  // The one state that needs the merchant to act — gets the brand colour.
  CONFIRMED: { label: "To fulfil", tone: "brand" },
  PROCESSING: { label: "Processing", tone: "info" },
  SHIPPED: { label: "Shipped", tone: "info" },
  OUT_FOR_DELIVERY: { label: "Out for delivery", tone: "info" },
  DELIVERED: { label: "Delivered", tone: "success" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
  REFUNDED: { label: "Refunded", tone: "neutral" },
};

/** Human label + dot tone for an order status. Unknown values degrade to sentence case. */
export function orderStatusDisplay(status: string | null | undefined): { label: string; tone: AdminDotTone } {
  const key = (status ?? "").toUpperCase();
  return ORDER_STATUS_DISPLAY[key] ?? { label: sentenceCaseEnum(key), tone: "neutral" };
}

const PAYMENT_STATUS_DISPLAY: Record<string, { label: string; tone: AdminDotTone }> = {
  CREATED: { label: "Pending", tone: "warning" },
  CAPTURED: { label: "Paid", tone: "success" },
  FAILED: { label: "Failed", tone: "danger" },
  REFUNDED: { label: "Refunded", tone: "neutral" },
  PARTIALLY_REFUNDED: { label: "Partly refunded", tone: "warning" },
};

export function paymentStatusDisplay(status: string | null | undefined): { label: string; tone: AdminDotTone } {
  const key = (status ?? "").toUpperCase();
  return PAYMENT_STATUS_DISPLAY[key] ?? { label: sentenceCaseEnum(key), tone: "neutral" };
}

/** Map the legacy Badge tone onto a dot tone. */
export function toDotTone(tone: AdminStatusTone): AdminDotTone {
  return tone === "destructive" ? "danger" : tone === "default" ? "neutral" : tone;
}

/** "OUT_FOR_DELIVERY" → "Out for delivery". */
export function sentenceCaseEnum(value: string | null | undefined): string {
  if (!value) return "—";
  const words = value.toLowerCase().replaceAll("_", " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Compact date for dense tables: "21 Oct, 10:42 am" (adds the year only when it differs). */
export function formatAdminDateCompact(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const sameYear = date.getFullYear() === now.getFullYear();
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

/** Short "when" for lists: time today, "Yesterday", or "21 Oct" (with year if not this year). */
export function formatAdminWhen(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayMs = 24 * 60 * 60 * 1000;
  if (date >= startOfToday) {
    return new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit" }).format(date);
  }
  if (date >= new Date(startOfToday.getTime() - dayMs)) return "Yesterday";
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  }).format(date);
}
