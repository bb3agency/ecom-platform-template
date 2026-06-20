import { FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '@common/errors/app-error';
import { ERROR_CODES } from '@common/errors/error-codes';
import { hasOpsPermission, OpsPermissionScope } from '@common/auth/ops-permissions';

export function opsPermissionGuard(requiredPermission: OpsPermissionScope) {
  return async function enforceOpsPermission(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
    if (!request.opsUser) {
      throw new AppError(ERROR_CODES.UNAUTHORISED, 'Ops authentication required', 401);
    }

    const permissions = request.opsUser.permissions;
    const permitted = hasOpsPermission(permissions, requiredPermission);
    if (!permitted) {
      throw new AppError(ERROR_CODES.FORBIDDEN, 'Insufficient ops permissions', 403, {
        kind: 'permission',
        hintKey: 'ops_permission_missing',
        requiredPermission,
        retryable: false,
        retryAfterSeconds: null,
        remediation: 'Request the required ops permission grant from platform owner.'
      });
    }

    request.opsControlDecision = {
      permission: requiredPermission
    };
  };
}
