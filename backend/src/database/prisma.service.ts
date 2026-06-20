import { PrismaClient } from '@prisma/client';

declare global {
  var __PRISMA_CLIENT__: PrismaClient | undefined;
}

function isDevelopmentLikeRuntime(): boolean {
  const env = (process.env.NODE_ENV ?? 'development').trim().toLowerCase();
  return env === 'development' || env === 'test';
}

const prismaClient =
  global.__PRISMA_CLIENT__ ??
  new PrismaClient({
    log: ['warn', 'error']
  });

if (isDevelopmentLikeRuntime()) {
  global.__PRISMA_CLIENT__ = prismaClient;
}

export default prismaClient;

