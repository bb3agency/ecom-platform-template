import jwt from '@fastify/jwt';
import { FastifyInstance } from 'fastify';
import { AppError } from '@common/errors/app-error';
import { ERROR_CODES } from '@common/errors/error-codes';

export async function registerJwtPlugin(fastify: FastifyInstance): Promise<void> {
  const secret = process.env.JWT_SECRET?.trim();
  if (!secret) {
    throw new AppError(ERROR_CODES.INTERNAL_ERROR, 'JWT_SECRET is not configured', 500);
  }
  await fastify.register(jwt, {
    secret,
    sign: {
      algorithm: 'HS256'
    },
    verify: {
      algorithms: ['HS256']
    }
  });
}

