import { describe, expect, it } from 'vitest';

import { AppError } from '@common/errors/app-error';
import { ERROR_CODES } from '@common/errors/error-codes';
import { getCurrentUser } from './current-user';

describe('getCurrentUser', () => {
  it('returns authenticated user payload including sid when present', () => {
    const request = {
      user: {
        sub: 'user_1',
        role: 'CUSTOMER',
        sid: 'session_1'
      }
    };

    const user = getCurrentUser(request as never);

    expect(user).toEqual({ sub: 'user_1', role: 'CUSTOMER', sid: 'session_1' });
  });

  it('returns authenticated user payload without sid when absent', () => {
    const request = {
      user: {
        sub: 'admin_1',
        role: 'ADMIN'
      }
    };

    const user = getCurrentUser(request as never);

    expect(user).toEqual({ sub: 'admin_1', role: 'ADMIN' });
  });

  it('throws AppError UNAUTHORISED when user context is missing', () => {
    expect(() => getCurrentUser({} as never)).toThrowError(AppError);

    try {
      getCurrentUser({} as never);
      throw new Error('Expected getCurrentUser to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      const appError = error as AppError;
      expect(appError.code).toBe(ERROR_CODES.UNAUTHORISED);
      expect(appError.statusCode).toBe(401);
      expect(appError.message).toBe('Authentication required');
    }
  });
});
