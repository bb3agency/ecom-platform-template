import helmet from '@fastify/helmet';
import { FastifyInstance } from 'fastify';

export async function registerHelmetPlugin(fastify: FastifyInstance): Promise<void> {
  await fastify.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"], // No 'unsafe-inline' — all styles must be from self origin
        imgSrc: ["'self'", 'data:']
      }
    },
    crossOriginEmbedderPolicy: false
  });
}

