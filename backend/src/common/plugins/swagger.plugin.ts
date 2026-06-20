import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { FastifyInstance } from 'fastify';

export async function registerSwaggerPlugin(fastify: FastifyInstance): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    return;
  }

  await fastify.register(swagger, {
    openapi: {
      info: {
        title: 'E-Commerce Backend Template API',
        version: '0.1.0'
      }
    }
  });

  await fastify.register(swaggerUi, {
    routePrefix: '/api/docs'
  });
}

