import { FastifyInstance } from 'fastify';
import prismaClient from '../../database/prisma.service';
import { warnIfDatabasePoolUnsized } from '../../config/database-pool';

export async function registerPrismaPlugin(fastify: FastifyInstance): Promise<void> {
  // Advisory only (production): never blocks startup.
  warnIfDatabasePoolUnsized(fastify.log, 'api');
  fastify.decorate('prisma', prismaClient);

  fastify.addHook('onClose', async (instance) => {
    await instance.prisma.$disconnect();
  });
}

