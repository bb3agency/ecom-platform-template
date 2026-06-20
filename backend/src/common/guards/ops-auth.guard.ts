import { FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '@common/errors/app-error';
import { ERROR_CODES } from '@common/errors/error-codes';
import { OpsPermissionValue } from '@common/auth/ops-permissions';
import { OpsService, OPS_BROWSER_SESSION_COOKIE_NAME } from '@modules/ops/ops.service';

function normalizeMandatoryOpsPermissions(permissions: string[] | undefined): OpsPermissionValue[] {
  const normalized = new Set((permissions ?? []).map((permission) => permission.trim().toUpperCase()));
  normalized.add('OPS_READ');
  normalized.add('OPS_WRITE');
  return ['OPS_READ', 'OPS_WRITE'].filter((permission): permission is OpsPermissionValue => normalized.has(permission));
}


export async function opsAuthGuard(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  // Browser httpOnly cookie session — the only supported auth mechanism.
  // Authentication flows through POST /ops/auth/login/verify-otp which sets an httpOnly cookie.
  const rawCookies = request.headers.cookie ?? '';
  const sessionTokenFromCookie = rawCookies
    .split(';')
    .map((p) => p.trim())
    .find((p) => p.startsWith(`${OPS_BROWSER_SESSION_COOKIE_NAME}=`))
    ?.replace(`${OPS_BROWSER_SESSION_COOKIE_NAME}=`, '')
    .trim();

  if (sessionTokenFromCookie) {
    const opsService = new OpsService(request.server);
    const session = await opsService.resolveBrowserSession(sessionTokenFromCookie);
    if (!session) {
      throw new AppError(ERROR_CODES.UNAUTHORISED, 'Ops session expired or invalid — please log in again', 401, {
        kind: 'auth',
        hintKey: 'ops_session_expired',
        retryable: false,
        retryAfterSeconds: null,
        remediation: 'Log in again at /ops.'
      });
    }
    // Live isActive check — deactivated users must not retain access via stale session tokens.
    const prismaForSession = request.server.prisma as unknown as {
      opsUser: { findUnique(args: { where: { id: string }; select: { isActive: true } }): Promise<{ isActive: boolean } | null> };
    };
    const liveUser = await prismaForSession.opsUser.findUnique({
      where: { id: session.opsUserId },
      select: { isActive: true }
    });
    if (!liveUser?.isActive) {
      throw new AppError(ERROR_CODES.UNAUTHORISED, 'Ops account has been deactivated', 401);
    }

    (request as FastifyRequest & {
      opsUser?: { id: string; email: string; name: string; permissions: OpsPermissionValue[] };
    }).opsUser = {
      id: session.opsUserId,
      email: session.email,
      name: session.name,
      permissions: normalizeMandatoryOpsPermissions(session.permissions)
    };
    return;
  }

  throw new AppError(ERROR_CODES.UNAUTHORISED, 'Ops authentication required — please log in via /ops', 401, {
    kind: 'auth',
    hintKey: 'ops_login_required',
    retryable: false,
    retryAfterSeconds: null,
    remediation: 'Log in at /ops using your email and OTP.'
  });
}
