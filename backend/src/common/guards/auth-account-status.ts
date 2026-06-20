import { AppError } from '@common/errors/app-error';
import { ERROR_CODES } from '@common/errors/error-codes';

export type AuthAccount = {
  id: string;
  role: 'CUSTOMER' | 'ADMIN';
  isBanned: boolean;
};

export function assertAuthAccountActive(
  payload: { sub: string; role: 'CUSTOMER' | 'ADMIN' },
  account: AuthAccount | null
): void {
  if (payload.role === 'ADMIN') {
    if (!account || account.role !== 'ADMIN' || account.isBanned) {
      throw new AppError(ERROR_CODES.UNAUTHORISED, 'Admin account not found or inactive', 401);
    }
    return;
  }

  if (!account) {
    throw new AppError(ERROR_CODES.UNAUTHORISED, 'Authentication required', 401);
  }

  if (account.isBanned) {
    throw new AppError(
      ERROR_CODES.UNAUTHORISED,
      'Your account has been suspended. Please contact support.',
      401
    );
  }
}
