/** Shiprocket rejects phones that are not 10 digits. Returns null when invalid. */
export function normalizeIndianShippingPhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) {
    return digits.slice(2);
  }
  if (digits.length > 10) {
    const tail = digits.slice(-10);
    return tail.length === 10 ? tail : null;
  }
  return digits.length === 10 ? digits : null;
}

export function resolveShiprocketCustomerEmail(
  customerEmail: string | null | undefined,
  storeContactEmail: string | null | undefined
): string {
  const fromCustomer = customerEmail?.trim();
  if (fromCustomer && fromCustomer.includes('@')) {
    return fromCustomer;
  }
  const fromStore = storeContactEmail?.trim();
  if (fromStore && fromStore.includes('@')) {
    return fromStore;
  }
  const fromEnv = (process.env.ADMIN_ALERT_EMAIL ?? process.env.STORE_CONTACT_EMAIL ?? '').trim();
  if (fromEnv.includes('@')) {
    return fromEnv;
  }
  return 'orders@example.com';
}
