import cors from '@fastify/cors';
import { FastifyInstance } from 'fastify';

function isStrictProfile(): boolean {
  const env = (process.env.NODE_ENV ?? 'development').toLowerCase();
  return env !== 'development' && env !== 'test';
}

function normalizeOrigin(name: 'STOREFRONT_URL' | 'ADMIN_URL'): string | undefined {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return undefined;
  }
  try {
    return new URL(raw).origin;
  } catch {
    throw new Error(`Invalid URL in ${name}: ${raw}`);
  }
}

function resolveOrigins(): string[] {
  const storefront = normalizeOrigin('STOREFRONT_URL');
  const admin = normalizeOrigin('ADMIN_URL');
  const origins = [storefront, admin].filter((origin): origin is string => Boolean(origin));

  if (isStrictProfile() && origins.length < 2) {
    throw new Error(
      'Missing required CORS origins for strict profile: set STOREFRONT_URL and ADMIN_URL (same origin is allowed)'
    );
  }

  return [...new Set(origins)];
}

export async function registerCorsPlugin(fastify: FastifyInstance): Promise<void> {
  const origins = resolveOrigins();

  await fastify.register(cors, {
    origin: origins.length > 0 ? origins : false,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    credentials: true
  });
}

