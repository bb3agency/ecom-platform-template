import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@common/guards/jwt-auth.guard', () => ({
  jwtAuthGuard: vi.fn(async () => undefined)
}));
vi.mock('@common/guards/roles.guard', () => ({
  rolesGuard: vi.fn(() => async () => undefined)
}));
vi.mock('@common/guards/admin-permissions.guard', () => ({
  adminPermissionGuard: vi.fn(() => async () => undefined)
}));

const usersServiceState = vi.hoisted(() => ({
  getMe: vi.fn(async () => ({
    id: 'user_1',
    email: 'user@example.com',
    phone: '9999999999',
    firstName: 'First',
    lastName: 'Last',
    role: 'CUSTOMER',
    isVerified: true
  })),
  patchMe: vi.fn(async () => ({
    id: 'user_1',
    email: 'user@example.com',
    phone: '9999999999',
    firstName: 'First',
    lastName: 'Last',
    role: 'CUSTOMER',
    isVerified: true
  })),
  listAddresses: vi.fn(async () => ({ items: [], meta: { page: 1, limit: 20, total: 0, totalPages: 0 } })),
  createAddress: vi.fn(async () => ({
    id: 'addr_1',
    fullName: 'First Last',
    phone: '9999999999',
    line1: 'Line 1',
    line2: null,
    city: 'Hyderabad',
    state: 'Telangana',
    pincode: '500001',
    isDefault: true
  })),
  updateAddress: vi.fn(async () => ({
    id: 'addr_1',
    fullName: 'First Last',
    phone: '9999999999',
    line1: 'Line 1',
    line2: null,
    city: 'Hyderabad',
    state: 'Telangana',
    pincode: '500001',
    isDefault: true
  })),
  deleteAddress: vi.fn(async () => ({ message: 'Address deleted' })),
  listOrders: vi.fn(async () => ({ items: [], meta: { page: 1, limit: 20, total: 0, totalPages: 0 } })),
  adminListUsers: vi.fn(async () => ({ items: [], meta: { page: 1, limit: 20, total: 0, totalPages: 0 } })),
  adminGetUserById: vi.fn(async () => ({
    id: 'user_1',
    email: 'user@example.com',
    phone: '9999999999',
    firstName: 'First',
    lastName: 'Last',
    isBanned: false,
    bannedAt: null,
    bannedReason: null,
    createdAt: new Date().toISOString(),
    addresses: [],
    orders: []
  })),
  adminGetCustomerOrders: vi.fn(async () => ({ items: [], meta: { page: 1, limit: 20, total: 0, totalPages: 0 } })),
  adminBanUser: vi.fn(async () => ({ userId: 'user_1', isBanned: true, bannedAt: new Date().toISOString(), bannedReason: 'spam' })),
  adminUnbanUser: vi.fn(async () => ({ userId: 'user_1', isBanned: false })),
  adminListUserNotes: vi.fn(async () => []),
  adminCreateUserNote: vi.fn(async () => ({
    id: 'note_1',
    userId: 'user_1',
    content: 'Test note',
    createdByAdminId: 'admin_1',
    createdAt: new Date().toISOString()
  })),
  adminDeleteUserNote: vi.fn(async () => ({ deleted: true, noteId: 'note_1' }))
}));

vi.mock('./users.service', () => {
  class MockUsersService {
    getMe = usersServiceState.getMe;
    patchMe = usersServiceState.patchMe;
    listAddresses = usersServiceState.listAddresses;
    createAddress = usersServiceState.createAddress;
    updateAddress = usersServiceState.updateAddress;
    deleteAddress = usersServiceState.deleteAddress;
    listOrders = usersServiceState.listOrders;
    adminListUsers = usersServiceState.adminListUsers;
    adminGetUserById = usersServiceState.adminGetUserById;
    adminGetCustomerOrders = usersServiceState.adminGetCustomerOrders;
    adminBanUser = usersServiceState.adminBanUser;
    adminUnbanUser = usersServiceState.adminUnbanUser;
    adminListUserNotes = usersServiceState.adminListUserNotes;
    adminCreateUserNote = usersServiceState.adminCreateUserNote;
    adminDeleteUserNote = usersServiceState.adminDeleteUserNote;
    constructor(_fastify: unknown) {}
  }

  return { UsersService: MockUsersService };
});

import { registerUsersRoutes } from './users.routes';

describe('users routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('admin write routes have idempotencyPreHandler in preHandler chain', async () => {
    const app = Fastify();
    const routes: Array<{ method: string | string[]; url: string; preHandler: unknown[] | undefined }> = [];

    app.addHook('onRoute', (routeOptions) => {
      routes.push({
        method: routeOptions.method,
        url: routeOptions.url,
        preHandler: routeOptions.preHandler as unknown[] | undefined
      });
    });

    await registerUsersRoutes(app);

    const writeRoutes = [
      { url: '/api/v1/admin/users/:id/ban', method: 'PATCH' },
      { url: '/api/v1/admin/users/:id/ban', method: 'DELETE' },
      { url: '/api/v1/admin/users/:id/notes', method: 'POST' },
      { url: '/api/v1/admin/users/:id/notes/:noteId', method: 'DELETE' }
    ];

    for (const { url, method } of writeRoutes) {
      const route = routes.find((r) => r.url === url && r.method === method);
      expect(route, `route ${method} ${url} should be registered`).toBeDefined();
      expect(Array.isArray(route?.preHandler), `${method} ${url} should have preHandler array`).toBe(true);
      expect((route?.preHandler as unknown[]).length, `${method} ${url} should have ≥4 preHandlers`).toBeGreaterThanOrEqual(4);
    }

    await app.close();
  });

  it('registers customer and admin routes with schema and guards', async () => {
    const app = Fastify();
    const routes: Array<{ method: string | string[]; url: string; schema?: unknown; preHandler?: unknown }> = [];

    app.addHook('onRoute', (routeOptions) => {
      routes.push({
        method: routeOptions.method,
        url: routeOptions.url,
        schema: routeOptions.schema,
        preHandler: routeOptions.preHandler
      });
    });

    await registerUsersRoutes(app);

    const me = routes.find((route) => route.url === '/api/v1/users/me' && route.method === 'GET');
    expect(me).toBeDefined();
    expect(me?.preHandler).toBeDefined();
    expect((me?.schema as { response?: Record<number, unknown> }).response?.[200]).toBeDefined();

    const myAddresses = routes.find((route) => route.url === '/api/v1/users/me/addresses' && route.method === 'GET');
    expect(myAddresses).toBeDefined();
    expect(myAddresses?.preHandler).toBeDefined();

    const adminUsers = routes.find((route) => route.url === '/api/v1/admin/users' && route.method === 'GET');
    expect(adminUsers).toBeDefined();
    expect(adminUsers?.preHandler).toBeDefined();
    expect((adminUsers?.schema as { response?: Record<number, unknown> }).response?.[200]).toBeDefined();

    const adminUserById = routes.find((route) => route.url === '/api/v1/admin/users/:id' && route.method === 'GET');
    expect(adminUserById).toBeDefined();
    expect(adminUserById?.preHandler).toBeDefined();
    expect((adminUserById?.schema as { response?: Record<number, unknown> }).response?.[200]).toBeDefined();

    const adminUserOrders = routes.find((route) => route.url === '/api/v1/admin/users/:id/orders' && route.method === 'GET');
    expect(adminUserOrders).toBeDefined();
    expect(adminUserOrders?.preHandler).toBeDefined();

    const banUser = routes.find((route) => route.url === '/api/v1/admin/users/:id/ban' && route.method === 'PATCH');
    expect(banUser).toBeDefined();
    expect(banUser?.preHandler).toBeDefined();
    expect((banUser?.schema as { body?: unknown }).body).toBeDefined();
    expect((banUser?.schema as { response?: Record<number, unknown> }).response?.[200]).toBeDefined();

    const unbanUser = routes.find((route) => route.url === '/api/v1/admin/users/:id/ban' && route.method === 'DELETE');
    expect(unbanUser).toBeDefined();
    expect(unbanUser?.preHandler).toBeDefined();

    const listNotes = routes.find((route) => route.url === '/api/v1/admin/users/:id/notes' && route.method === 'GET');
    expect(listNotes).toBeDefined();
    expect(listNotes?.preHandler).toBeDefined();
    expect((listNotes?.schema as { response?: Record<number, unknown> }).response?.[200]).toBeDefined();

    const createNote = routes.find((route) => route.url === '/api/v1/admin/users/:id/notes' && route.method === 'POST');
    expect(createNote).toBeDefined();
    expect(createNote?.preHandler).toBeDefined();
    expect((createNote?.schema as { body?: unknown }).body).toBeDefined();

    const deleteNote = routes.find((route) => route.url === '/api/v1/admin/users/:id/notes/:noteId' && route.method === 'DELETE');
    expect(deleteNote).toBeDefined();
    expect(deleteNote?.preHandler).toBeDefined();

    const deleteAddress = routes.find(
      (route) => route.url === '/api/v1/users/me/addresses/:id' && route.method === 'DELETE'
    );
    expect(deleteAddress).toBeDefined();
    expect(deleteAddress?.preHandler).toBeDefined();
    expect((deleteAddress?.schema as { body?: unknown }).body).toBeUndefined();

    await app.close();
  });
});
