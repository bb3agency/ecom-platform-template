import { describe, it, expect } from 'vitest';
import { SmsTemplateRegistry } from './sms-template-registry';

describe('SmsTemplateRegistry', () => {
  it('resolves known template with variable substitution', () => {
    const registry = new SmsTemplateRegistry();
    const result = registry.resolve('OrderConfirmed', { orderId: 'ORD-99', storeName: 'BB3 Foods' });
    expect(result).toBe('BB3 Foods: Your order ORD-99 is confirmed! We are preparing it for dispatch. You will be notified when it ships.');
  });

  it('resolves multiple variables', () => {
    const registry = new SmsTemplateRegistry();
    const result = registry.resolve('OpsInviteSetup', { otp: '777777', storeName: 'BB3 Foods' });
    expect(result).toBe('BB3 Foods Security: Your ops account setup OTP is 777777. Valid for 10 minutes. Do NOT share this code with anyone.');
  });

  it('replaces missing variables with empty string', () => {
    const registry = new SmsTemplateRegistry();
    const result = registry.resolve('OrderConfirmed', {});
    expect(result).toBe(': Your order  is confirmed! We are preparing it for dispatch. You will be notified when it ships.');
  });

  it('supports custom overrides in constructor', () => {
    const registry = new SmsTemplateRegistry({
      CustomAlert: 'Alert: {{level}} — {{message}}'
    });
    const result = registry.resolve('CustomAlert', { level: 'HIGH', message: 'System down' });
    expect(result).toBe('Alert: HIGH — System down');
  });

  it('falls back to template name + JSON for unknown templates', () => {
    const registry = new SmsTemplateRegistry();
    const result = registry.resolve('UnknownTemplate', { foo: 'bar' });
    expect(result).toBe('UnknownTemplate{"foo":"bar"}');
  });

  it('overrides built-in templates when provided', () => {
    const registry = new SmsTemplateRegistry({
      OrderConfirmed: 'Custom confirmed msg for {{orderId}}'
    });
    const result = registry.resolve('OrderConfirmed', { orderId: 'ORD-1' });
    expect(result).toBe('Custom confirmed msg for ORD-1');
  });

  it('resolves FailedDelivery with awb substitution', () => {
    const registry = new SmsTemplateRegistry();
    const result = registry.resolve('FailedDelivery', { orderId: 'ORD-7', awb: 'AWB123456', storeName: 'BB3 Foods' });
    expect(result).toBe('BB3 Foods Delivery Alert: Delivery attempt failed for order ORD-7 (AWB: AWB123456). Please contact support to reschedule delivery.');
  });

  it('coerces non-string values to string', () => {
    const registry = new SmsTemplateRegistry({
      NumTmpl: 'Count: {{count}}'
    });
    const result = registry.resolve('NumTmpl', { count: 42 });
    expect(result).toBe('Count: 42');
  });

  it('composes template data with default store name fallback', () => {
    const data = SmsTemplateRegistry.composeTemplateData({ orderId: 'ORD-10' }, '');
    expect(data).toEqual({ orderId: 'ORD-10', storeName: 'Our Store' });
  });

  it('normalizes template overrides to non-empty string values only', () => {
    const normalized = SmsTemplateRegistry.normalizeTemplateOverrides({
      OrderConfirmed: '  Hello {{orderId}}  ',
      Empty: '   ',
      Numeric: 42
    });

    expect(normalized).toEqual({
      OrderConfirmed: 'Hello {{orderId}}'
    });
  });
});
