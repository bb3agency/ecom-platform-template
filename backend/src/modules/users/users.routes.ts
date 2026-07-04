import { FastifyInstance } from 'fastify';
import { Role } from '@prisma/client';
import { getCurrentUser } from '@common/decorators/current-user';
import { adminPermissionGuard } from '@common/guards/admin-permissions.guard';
import { jwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { rolesGuard } from '@common/guards/roles.guard';
import { idempotencyOnSend, idempotencyPreHandler } from '@common/idempotency/idempotency';
import { routeRateLimitProfiles } from '@common/rate-limit/rate-limit-policies';
import { loadShedGuard } from '@common/reliability/load-shed.guard';
import {
  adminBanUserSchema,
  adminCreateUserNoteSchema,
  adminDeleteUserNoteSchema,
  adminGetCustomerOrdersSchema,
  adminGetUserByIdSchema,
  adminListUserNotesSchema,
  adminListUsersSchema,
  adminUnbanUserSchema,
  createAddressSchema,
  deleteAddressSchema,
  getMeSchema,
  listAddressesSchema,
  listOrdersSchema,
  patchMeSchema,
  updateAddressSchema,
  getAdminNotificationPreferencesSchema,
  updateAdminNotificationPreferencesSchema
} from './users.schemas';
import { UsersService } from './users.service';

export async function registerUsersRoutes(fastify: FastifyInstance): Promise<void> {
  const usersService = new UsersService(fastify);
  const customerGuard = [jwtAuthGuard, rolesGuard(Role.CUSTOMER)];

  fastify.addHook('onSend', async (request, reply, payload) => {
    await idempotencyOnSend(request, reply, payload);
    return payload;
  });

  fastify.get(
    '/api/v1/users/me',
    {
      schema: getMeSchema,
      preHandler: [jwtAuthGuard],

      config: {
        rateLimit: routeRateLimitProfiles.cartOps
      }
    },
    async (request) => {
      const user = getCurrentUser(request);
      return usersService.getMe(user.sub);
    }
  );

  fastify.patch(
    '/api/v1/users/me',
    {
      schema: patchMeSchema,
      preHandler: [jwtAuthGuard],
      config: {
        rateLimit: routeRateLimitProfiles.cartOps
      }
    },
    async (request) => {
      const user = getCurrentUser(request);
      return usersService.patchMe(user.sub, request.body as never);
    }
  );

  fastify.get(
    '/api/v1/users/me/addresses',
    {
      schema: listAddressesSchema,
      preHandler: customerGuard,
      config: {
        rateLimit: routeRateLimitProfiles.cartOps
      }
    },
    async (request) => {
      const user = getCurrentUser(request);
      return usersService.listAddresses(user.sub, request.query as never);
    }
  );

  fastify.post(
    '/api/v1/users/me/addresses',
    {
      schema: createAddressSchema,
      preHandler: customerGuard,
      config: {
        rateLimit: routeRateLimitProfiles.cartOps
      }
    },
    async (request) => {
      const user = getCurrentUser(request);
      return usersService.createAddress(user.sub, request.body as never);
    }
  );

  fastify.patch(
    '/api/v1/users/me/addresses/:id',
    {
      schema: updateAddressSchema,
      preHandler: customerGuard,
      config: {
        rateLimit: routeRateLimitProfiles.cartOps
      }
    },
    async (request) => {
      const user = getCurrentUser(request);
      const params = request.params as { id: string };
      return usersService.updateAddress(user.sub, params.id, request.body as never);
    }
  );

  fastify.delete(
    '/api/v1/users/me/addresses/:id',
    {
      schema: deleteAddressSchema,
      preHandler: customerGuard,
      config: {
        rateLimit: routeRateLimitProfiles.cartOps
      }
    },
    async (request) => {
      const user = getCurrentUser(request);
      const params = request.params as { id: string };
      return usersService.deleteAddress(user.sub, params.id);
    }
  );

  fastify.get(
    '/api/v1/users/me/orders',
    {
      schema: listOrdersSchema,
      preHandler: customerGuard,
      config: {
        rateLimit: routeRateLimitProfiles.cartOps
      }
    },
    async (request) => {
      const user = getCurrentUser(request);
      return usersService.listOrders(user.sub, request.query as never);
    }
  );

  const adminGuard = [jwtAuthGuard, rolesGuard(Role.ADMIN)];

  // Own new-order notification preferences — any active admin manages their own
  // opt-in + channels (no adminPermissionGuard: strictly self-service).
  fastify.get(
    '/api/v1/admin/me/notification-preferences',
    {
      schema: getAdminNotificationPreferencesSchema,
      preHandler: adminGuard,
      config: {
        rateLimit: routeRateLimitProfiles.adminRead
      }
    },
    async (request) => {
      const user = getCurrentUser(request);
      return usersService.getAdminNotificationPreferences(user.sub);
    }
  );

  fastify.patch(
    '/api/v1/admin/me/notification-preferences',
    {
      schema: updateAdminNotificationPreferencesSchema,
      preHandler: [...adminGuard, idempotencyPreHandler],
      config: {
        rateLimit: routeRateLimitProfiles.adminWrite
      }
    },
    async (request) => {
      const user = getCurrentUser(request);
      return usersService.updateAdminNotificationPreferences(user.sub, request.body as never);
    }
  );


  fastify.get(
    '/api/v1/admin/users',
    {
      schema: adminListUsersSchema,
      preHandler: [...adminGuard, adminPermissionGuard('users:read')],
      config: {
        rateLimit: routeRateLimitProfiles.adminRead
      }
    },
    async (request) => usersService.adminListUsers(request.query as never)
  );

  fastify.get(
    '/api/v1/admin/users/:id',
    {
      schema: adminGetUserByIdSchema,
      preHandler: [...adminGuard, adminPermissionGuard('users:read')],
      config: {
        rateLimit: routeRateLimitProfiles.adminRead
      }
    },
    async (request) => {
      const params = request.params as { id: string };
      return usersService.adminGetUserById(params.id);
    }
  );

  fastify.get(
    '/api/v1/admin/users/:id/orders',
    {
      schema: adminGetCustomerOrdersSchema,
      preHandler: [...adminGuard, adminPermissionGuard('users:read')],
      config: {
        rateLimit: routeRateLimitProfiles.adminRead
      }
    },
    async (request) => {
      const params = request.params as { id: string };
      return usersService.adminGetCustomerOrders(params.id, request.query as never);
    }
  );

  fastify.patch(
    '/api/v1/admin/users/:id/ban',
    {
      schema: adminBanUserSchema,
      preHandler: [...adminGuard, adminPermissionGuard('users:write'), loadShedGuard, idempotencyPreHandler],
      config: {
        rateLimit: routeRateLimitProfiles.adminWrite
      }
    },
    async (request) => {
      const adminUser = getCurrentUser(request);
      const params = request.params as { id: string };
      const body = request.body as { reason: string };
      return usersService.adminBanUser(params.id, body.reason, adminUser.sub);
    }
  );

  fastify.delete(
    '/api/v1/admin/users/:id/ban',
    {
      schema: adminUnbanUserSchema,
      preHandler: [...adminGuard, adminPermissionGuard('users:write'), loadShedGuard, idempotencyPreHandler],
      config: {
        rateLimit: routeRateLimitProfiles.adminWrite
      }
    },
    async (request) => {
      const adminUser = getCurrentUser(request);
      const params = request.params as { id: string };
      return usersService.adminUnbanUser(params.id, adminUser.sub);
    }
  );

  fastify.get(
    '/api/v1/admin/users/:id/notes',
    {
      schema: adminListUserNotesSchema,
      preHandler: [...adminGuard, adminPermissionGuard('users:read')],
      config: {
        rateLimit: routeRateLimitProfiles.adminRead
      }
    },
    async (request) => {
      const params = request.params as { id: string };
      return usersService.adminListUserNotes(params.id);
    }
  );

  fastify.post(
    '/api/v1/admin/users/:id/notes',
    {
      schema: adminCreateUserNoteSchema,
      preHandler: [...adminGuard, adminPermissionGuard('users:write'), loadShedGuard, idempotencyPreHandler],
      config: {
        rateLimit: routeRateLimitProfiles.adminWrite
      }
    },
    async (request, reply) => {
      const adminUser = getCurrentUser(request);
      const params = request.params as { id: string };
      const body = request.body as { content: string };
      const note = await usersService.adminCreateUserNote(params.id, body.content, adminUser.sub);
      return reply.status(201).send(note);
    }
  );

  fastify.delete(
    '/api/v1/admin/users/:id/notes/:noteId',
    {
      schema: adminDeleteUserNoteSchema,
      preHandler: [...adminGuard, adminPermissionGuard('users:write'), loadShedGuard, idempotencyPreHandler],
      config: {
        rateLimit: routeRateLimitProfiles.adminWrite
      }
    },
    async (request) => {
      const params = request.params as { id: string; noteId: string };
      return usersService.adminDeleteUserNote(params.id, params.noteId);
    }
  );
}

