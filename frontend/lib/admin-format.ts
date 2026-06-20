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
