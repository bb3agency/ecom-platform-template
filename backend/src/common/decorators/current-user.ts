import { FastifyRequest } from 'fastify';
import { AppError } from '@common/errors/app-error';
import { ERROR_CODES } from '@common/errors/error-codes';

export function getCurrentUser(request: FastifyRequest): { sub: string; role: 'CUSTOMER' | 'ADMIN'; sid?: string } {
  if (!request.user) {
    throw new AppError(ERROR_CODES.UNAUTHORISED, 'Authentication required', 401);
  }

  const sid = (request.user as { sid?: string }).sid;
  return {
    sub: request.user.sub,
    role: request.user.role,
    ...(typeof sid === 'string' ? { sid } : {})
  };
}

