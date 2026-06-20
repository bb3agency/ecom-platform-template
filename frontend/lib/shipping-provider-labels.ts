export const SHIPPING_PROVIDER_LABELS: Record<string, string> = {
  DELHIVERY: "Delhivery",
  SHIPROCKET: "Shiprocket",
  SELF: "Self",
};

export function shippingProviderLabel(provider: string | null | undefined): string {
  if (!provider) return "—";
  return SHIPPING_PROVIDER_LABELS[provider] ?? provider;
}
