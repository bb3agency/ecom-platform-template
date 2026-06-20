import { describe, expect, it } from 'vitest';
import { assertAuthAccountActive } from './auth-account-status';

describe('assertAuthAccountActive', () => {
  it('allows active customers', () => {
    expect(() =>
      assertAuthAccountActive(
        { sub: 'customer_1', role: 'CUSTOMER' },
        { id: 'customer_1', role: 'CUSTOMER', isBanned: false }
      )
    ).not.toThrow();
  });

  it('rejects missing customer accounts', () => {
    expect(() =>
      assertAuthAccountActive({ sub: 'customer_1', role: 'CUSTOMER' }, null)
    ).toThrow(
      expect.objectContaining({
        statusCode: 401,
        message: 'Authentication required'
      })
    );
  });

  it('rejects banned customers', () => {
    expect(() =>
      assertAuthAccountActive(
        { sub: 'customer_1', role: 'CUSTOMER' },
        { id: 'customer_1', role: 'CUSTOMER', isBanned: true }
      )
    ).toThrow(
      expect.objectContaining({
        statusCode: 401,
        message: expect.stringContaining('suspended')
      })
    );
  });

  it('allows active admins', () => {
    expect(() =>
      assertAuthAccountActive(
        { sub: 'admin_1', role: 'ADMIN' },
        { id: 'admin_1', role: 'ADMIN', isBanned: false }
      )
    ).not.toThrow();
  });

  it('rejects banned admins', () => {
    expect(() =>
      assertAuthAccountActive(
        { sub: 'admin_1', role: 'ADMIN' },
        { id: 'admin_1', role: 'ADMIN', isBanned: true }
      )
    ).toThrow(
      expect.objectContaining({
        statusCode: 401
      })
    );
  });
});
