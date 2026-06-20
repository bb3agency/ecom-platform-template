import { FastifyInstance } from 'fastify';
import prismaClient from '../../database/prisma.service';

export async function registerPrismaPlugin(fastify: FastifyInstance): Promise<void> {
  fastify.decorate('prisma', prismaClient);

  fastify.addHook('onClose', async (instance) => {
    await instance.prisma.$disconnect();
  });
}

