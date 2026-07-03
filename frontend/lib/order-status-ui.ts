/** Shared order-status presentation helpers (account order list + detail). */

/** Status → chip styling (brand-neutral status colours, same convention as the toaster). */
export const ORDER_STATUS_CHIP: Record<string, string> = {
  CONFIRMED: "bg-sky-50 text-sky-700 ring-sky-200",
  PROCESSING: "bg-amber-50 text-amber-700 ring-amber-200",
  SHIPPED: "bg-indigo-50 text-indigo-700 ring-indigo-200",
  OUT_FOR_DELIVERY: "bg-indigo-50 text-indigo-700 ring-indigo-200",
  DELIVERED: "bg-green-50 text-green-700 ring-green-200",
  CANCELLED: "bg-red-50 text-red-700 ring-red-200",
  REFUNDED: "bg-zinc-100 text-zinc-700 ring-zinc-200",
  PENDING_PAYMENT: "bg-amber-50 text-amber-700 ring-amber-200",
  PAYMENT_FAILED: "bg-red-50 text-red-700 ring-red-200",
};

export function orderStatusChipClass(status: string): string {
  return ORDER_STATUS_CHIP[status] ?? "bg-zinc-100 text-zinc-700 ring-zinc-200";
}

export function orderStatusLabel(status: string): string {
  return status
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function formatOrderDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" }).format(
    date,
  );
}
