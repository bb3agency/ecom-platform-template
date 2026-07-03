import { describe, it, expect, afterEach } from 'vitest';
import {
  DEFAULT_SHIPPING_NOTIFICATION_SURCHARGE_PAISE,
  getShippingNotificationSurchargePaise,
  applyShippingNotificationSurcharge
} from './notification-surcharge';

describe('shipping notification surcharge', () => {
  afterEach(() => {
    delete process.env.SHIPPING_NOTIFICATION_SURCHARGE_PAISE;
  });

  it('defaults to ₹5 (500 paise)', () => {
    expect(DEFAULT_SHIPPING_NOTIFICATION_SURCHARGE_PAISE).toBe(500);
    expect(getShippingNotificationSurchargePaise()).toBe(500);
  });

  it('adds the surcharge to a nonzero customer shipping charge', () => {
    expect(applyShippingNotificationSurcharge(13000)).toBe(13500);
  });

  it('does NOT add the surcharge when shipping is free (₹0)', () => {
    expect(applyShippingNotificationSurcharge(0)).toBe(0);
  });

  it('honours SHIPPING_NOTIFICATION_SURCHARGE_PAISE override, including 0 to disable', () => {
    process.env.SHIPPING_NOTIFICATION_SURCHARGE_PAISE = '700';
    expect(applyShippingNotificationSurcharge(10000)).toBe(10700);
    process.env.SHIPPING_NOTIFICATION_SURCHARGE_PAISE = '0';
    expect(applyShippingNotificationSurcharge(10000)).toBe(10000);
  });

  it('ignores invalid overrides and falls back to the default', () => {
    process.env.SHIPPING_NOTIFICATION_SURCHARGE_PAISE = 'five';
    expect(getShippingNotificationSurchargePaise()).toBe(500);
    process.env.SHIPPING_NOTIFICATION_SURCHARGE_PAISE = '-100';
    expect(getShippingNotificationSurchargePaise()).toBe(500);
  });
});
