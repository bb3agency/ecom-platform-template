import { FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '@common/errors/app-error';
import { ERROR_CODES } from '@common/errors/error-codes';
import { assertAuthAccountActive } from './auth-account-status';

type JwtPayload = {
  sub: string;
  role: 'CUSTOMER' | 'ADMIN';
  sid?: string;
  permissions?: string[];
};

async function verifyJwtPayload(request: FastifyRequest): Promise<JwtPayload> {
  let payload: JwtPayload | undefined;
  try {
    payload = await request.jwtVerify<JwtPayload>();
  } catch {
    throw new AppError(ERROR_CODES.UNAUTHORISED, 'Authentication required', 401);
  }

  if (!payload || !payload.sub || !payload.role) {
    payload = (request as FastifyRequest & {
      user?: { sub?: string; role?: 'CUSTOMER' | 'ADMIN'; sid?: string; permissions?: string[] };
    }).user as JwtPayload | undefined;
  }

  if (!payload || !payload.sub || !payload.role) {
    throw new AppError(ERROR_CODES.UNAUTHORISED, 'Authentication required', 401);
  }

  return payload;
}

export async function jwtVerifyGuard(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  await verifyJwtPayload(request);
}

export async function jwtAuthGuard(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const payload = await verifyJwtPayload(request);

  const prisma = (request.server as FastifyRequest['server'] & {
    prisma?: {
      user?: {
        findUnique: (args: {
          where: { id: string };
          select: { id: true; role: true; isBanned: true };
        }) => Promise<{ id: string; role: 'CUSTOMER' | 'ADMIN'; isBanned: boolean } | null>;
      };
    };
  }).prisma;

  if (!prisma?.user?.findUnique) {
    return;
  }

  const account = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: { id: true, role: true, isBanned: true }
  });

  assertAuthAccountActive(payload, account);
}
