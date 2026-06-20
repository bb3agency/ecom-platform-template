import { describe, expect, it } from 'vitest';
import { normalizeIndianShippingPhone, resolveShiprocketCustomerEmail } from './shiprocket-payload';

describe('shiprocket-payload helpers', () => {
  it('normalizes Indian phone numbers for Shiprocket', () => {
    expect(normalizeIndianShippingPhone('+91 98765 43210')).toBe('9876543210');
    expect(normalizeIndianShippingPhone('9876543210')).toBe('9876543210');
    expect(normalizeIndianShippingPhone('12345')).toBeNull();
  });

  it('prefers customer email and falls back to store contact email', () => {
    expect(resolveShiprocketCustomerEmail('buyer@example.com', 'store@example.com')).toBe('buyer@example.com');
    expect(resolveShiprocketCustomerEmail(null, 'store@example.com')).toBe('store@example.com');
  });
});
