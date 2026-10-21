import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { registerGlobalErrorHandler } from '@common/errors/error-handler';
import { requireRefundPermission } from './orders.routes';

/**
 * Regression: requireRefundPermission was a synchronous preHandler that never called
 * `done()`, so every admin status update hung forever. Drive it through a real Fastify
 * request lifecycle — a unit call alone would not have caught the hang.
 */
async function appWithPermissions(permissions: string[]) {
  const app = Fastify();
  await registerGlobalErrorHandler(app);
  app.addHook('onRequest', async (request) => {
    (request as unknown as { user: { permissions: string[] } }).user = { permissions };
  });
  app.patch('/status', { preHandler: [requireRefundPermission] }, async () => ({ ok: true }));
  await app.ready();
  return app;
}

describe('requireRefundPermission preHandler', () => {
  it('lets a non-refund status change through (and does not hang)', async () => {
    const app = await appWithPermissions(['orders:write']);
    const res = await Promise.race([
      app.inject({ method: 'PATCH', url: '/status', payload: { status: 'PROCESSING' } }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('preHandler hung')), 2000))
    ]);
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('rejects REFUNDED without orders:refund', async () => {
    const app = await appWithPermissions(['orders:write']);
    const res = await app.inject({ method: 'PATCH', url: '/status', payload: { status: 'REFUNDED' } });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('allows REFUNDED with orders:refund', async () => {
    const app = await appWithPermissions(['orders:write', 'orders:refund']);
    const res = await app.inject({ method: 'PATCH', url: '/status', payload: { status: 'REFUNDED' } });
    expect(res.statusCode).toBe(200);
    await app.close();
  });
});
