export function formatPrice(paise: number, currency = "INR"): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
  }).format(paise / 100);
}
