export function formatPrice(paise: number, currency = "INR"): string {
  const rupees = paise / 100;
  // Whole-rupee amounts render without ".00" (₹450, not ₹450.00) — matches
  // the storefront design; fractional amounts keep two decimals.
  const hasPaise = paise % 100 !== 0;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    minimumFractionDigits: hasPaise ? 2 : 0,
    maximumFractionDigits: hasPaise ? 2 : 0,
  }).format(rupees);
}
