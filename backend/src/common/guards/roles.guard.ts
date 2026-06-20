import { Role } from '@prisma/client';
import { FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '@common/errors/app-error';
import { ERROR_CODES } from '@common/errors/error-codes';

export function rolesGuard(requiredRole: Role) {
  return async function enforceRole(
    request: FastifyRequest,
    _reply: FastifyReply
  ): Promise<void> {
    if (!request.user) {
      throw new AppError(ERROR_CODES.UNAUTHORISED, 'Authentication required', 401);
    }

    if (request.user.role !== requiredRole) {
      throw new AppError(ERROR_CODES.FORBIDDEN, 'Insufficient permissions', 403);
    }
  };
}

