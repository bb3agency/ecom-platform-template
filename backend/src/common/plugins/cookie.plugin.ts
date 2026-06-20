import fp from 'fastify-plugin';
import cookie, { FastifyCookieOptions } from '@fastify/cookie';
import { FastifyInstance } from 'fastify';

export async function registerCookiePlugin(fastify: FastifyInstance): Promise<void> {
  const secret = process.env.OPS_COOKIE_SECRET?.trim();
  if (!secret && (process.env.NODE_ENV ?? 'development').toLowerCase() !== 'test') {
    fastify.log.warn('OPS_COOKIE_SECRET is not set — ops session cookies will be unsigned. Set this in production.');
  }

  const options: FastifyCookieOptions = secret
    ? { secret, hook: 'onRequest' }
    : { hook: 'onRequest' };

  await fastify.register(cookie as Parameters<typeof fastify.register>[0], options);
}

export const cookiePlugin = fp(registerCookiePlugin, {
  name: 'cookie-plugin',
  fastify: '5.x'
});
