import Fastify from 'fastify';
import { Role } from '@prisma/client';
import { afterEach, describe, expect, it } from 'vitest';
import { adminPermissionGuard } from './admin-permissions.guard';

describe('adminPermissionGuard route-level enforcement', () => {
  afterEach(() => {
    process.env.NODE_ENV = 'test';
    delete process.env.ADMIN_SCOPE_ENFORCEMENT;
    delete process.env.ALLOW_ADMIN_SCOPE_BYPASS;
  });

  function buildApp() {
    const app = Fastify();
    app.setErrorHandler((error, _request, reply) => {
      const statusCode = typeof (error as { statusCode?: unknown }).statusCode === 'number'
        ? (error as { statusCode: number }).statusCode
        : 500;
      return reply.code(statusCode).send({ code: (error as { code?: string }).code ?? 'INTERNAL_ERROR' });
    });
    app.addHook('preHandler', async (request) => {
      const roleHeader = request.headers['x-role'];
      const permissionsHeader = request.headers['x-permissions'];
      if (!roleHeader) {
        return;
      }
      const role = String(roleHeader).toUpperCase() === 'ADMIN' ? Role.ADMIN : Role.CUSTOMER;
      const permissions = typeof permissionsHeader === 'string'
        ? permissionsHeader.split(',').map((value) => value.trim()).filter(Boolean)
        : [];
      (request as unknown as { user: { sub: string; role: Role; permissions: string[] } }).user = {
        sub: 'tester',
        role,
        permissions
      };
    });
    return app;
  }

  it('enforces orders:refund permission path', async () => {
    const app = buildApp();
    app.post('/t/orders-cancel', { preHandler: adminPermissionGuard('orders:refund') }, async () => ({ ok: true }));

    const unauth = await app.inject({ method: 'POST', url: '/t/orders-cancel' });
    expect(unauth.statusCode).toBe(403);

    const wrongRole = await app.inject({
      method: 'POST',
      url: '/t/orders-cancel',
      headers: { 'x-role': 'CUSTOMER', 'x-permissions': 'orders:refund' }
    });
    expect(wrongRole.statusCode).toBe(403);

    const missingPermission = await app.inject({
      method: 'POST',
      url: '/t/orders-cancel',
      headers: { 'x-role': 'ADMIN', 'x-permissions': 'orders:read' }
    });
    expect(missingPermission.statusCode).toBe(403);

    const allowed = await app.inject({
      method: 'POST',
      url: '/t/orders-cancel',
      headers: { 'x-role': 'ADMIN', 'x-permissions': 'orders:refund' }
    });
    expect(allowed.statusCode).toBe(200);
    await app.close();
  });

  it('enforces analytics:replay permission path', async () => {
    const app = buildApp();
    app.post('/t/analytics-replay', { preHandler: adminPermissionGuard('analytics:replay') }, async () => ({ ok: true }));

    const denied = await app.inject({
      method: 'POST',
      url: '/t/analytics-replay',
      headers: { 'x-role': 'ADMIN', 'x-permissions': 'analytics:read' }
    });
    expect(denied.statusCode).toBe(403);

    const allowed = await app.inject({
      method: 'POST',
      url: '/t/analytics-replay',
      headers: { 'x-role': 'ADMIN', 'x-permissions': 'analytics:replay' }
    });
    expect(allowed.statusCode).toBe(200);
    await app.close();
  });

  it('enforces layer-C mutation restriction for ops:write', async () => {
    const app = buildApp();
    app.post('/t/ops-write', { preHandler: adminPermissionGuard('ops:write') }, async () => ({ ok: true }));

    const merchantDenied = await app.inject({
      method: 'POST',
      url: '/t/ops-write',
      headers: { 'x-role': 'ADMIN', 'x-permissions': 'ops:write,merchant:*' }
    });
    expect(merchantDenied.statusCode).toBe(403);

    const developerAllowed = await app.inject({
      method: 'POST',
      url: '/t/ops-write',
      headers: { 'x-role': 'ADMIN', 'x-permissions': 'ops:write,developer:*' }
    });
    expect(developerAllowed.statusCode).toBe(200);
    await app.close();
  });

  it('enforces ops:read permission path', async () => {
    const app = buildApp();
    app.get('/t/ops-read', { preHandler: adminPermissionGuard('ops:read') }, async () => ({ ok: true }));

    const denied = await app.inject({
      method: 'GET',
      url: '/t/ops-read',
      headers: { 'x-role': 'ADMIN', 'x-permissions': 'users:read' }
    });
    expect(denied.statusCode).toBe(403);

    const allowed = await app.inject({
      method: 'GET',
      url: '/t/ops-read',
      headers: { 'x-role': 'ADMIN', 'x-permissions': 'ops:read,developer:*' }
    });
    expect(allowed.statusCode).toBe(200);
    await app.close();
  });
});
