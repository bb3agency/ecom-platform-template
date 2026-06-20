import type { CheckoutPaymentMode } from "@/lib/orders-api";

export function formatPaymentModeLabel(mode: CheckoutPaymentMode | string | undefined): string {
  if (mode === "COD") return "Cash on Delivery";
  if (mode === "PREPAID") return "Paid online";
  return mode ?? "—";
}
