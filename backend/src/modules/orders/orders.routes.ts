import { Role } from '@prisma/client';
import { FastifyInstance, FastifyRequest } from 'fastify';
import { getCurrentUser } from '@common/decorators/current-user';
import { adminPermissionGuard } from '@common/guards/admin-permissions.guard';
import { AppError } from '@common/errors/app-error';
import { ERROR_CODES } from '@common/errors/error-codes';
import { jwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { rolesGuard } from '@common/guards/roles.guard';
import { idempotencyOnSend, idempotencyPreHandler } from '@common/idempotency/idempotency';
import { routeRateLimitProfiles } from '@common/rate-limit/rate-limit-policies';
import { loadShedGuard } from '@common/reliability/load-shed.guard';
import { hasAdminPermission } from '@common/auth/admin-permissions';
import {
  adminCancelOrderSchema,
  adminExportOrdersCsvSchema,
  adminGetInvoicePdfSchema,
  adminGetOrderByIdSchema,
  adminListOrdersSchema,
  adminOrderBoardSchema,
  adminShipOrderSchema,
  adminSchedulePickupSchema,
  adminPrintLabelSchema,
  adminRetriggerNotificationSchema,
  adminListShipmentsSchema,
  adminListPaymentsSchema,
  adminUpdateOrderStatusSchema,
  adminListReturnRequestsSchema,
  adminGetReturnRequestSchema,
  adminUpdateReturnRequestSchema,
  adminUpdateOrderItemsSchema,
  adminGetShipmentByIdSchema,
  adminSyncShipmentStatusSchema,
  adminGetPaymentByIdSchema,
  adminGetOrderTimelineSchema,
  createReturnRequestSchema,
  retryPaymentSchema,
  cancelMyOrderSchema,
  createOrderSchema,
  getMyInvoicePdfSchema,
  getMyOrderByIdSchema,
  initiatePaymentSchema,
  paymentWebhookSchema,
  shippingTrackSchema,
  shippingWebhookSchema,
  verifyPaymentSchema,
  prepareCheckoutSchema,
  confirmPrepaidSchema
} from './orders.schemas';
import { CheckoutRiskService } from './checkout-risk.service';
import { OrdersService } from './orders.service';
import { CancelOrderInput, ReturnRequestStatus } from './orders.types';
import {
  isIpAllowlisted,
  isProductionWithoutAllowlist,
  parseWebhookIpAllowlist,
  resolveSecurityClientIp,
  webhookAllowlistEnvKeyForProvider
} from '@common/security/webhook-allowlist';

function requireRefundPermission(request: FastifyRequest): void {
  const body = request.body as { status?: string };
  if (body.status === 'REFUNDED' && !hasAdminPermission(request.user?.permissions, 'orders:refund')) {
    throw new AppError(ERROR_CODES.FORBIDDEN, 'Insufficient permissions: orders:refund required to set REFUNDED status', 403);
  }
}

function requireWebhookRawPayload(body: unknown): string | Buffer {
  if (typeof body === 'string' || Buffer.isBuffer(body)) {
    return body;
  }
  throw new AppError(
    ERROR_CODES.VALIDATION_ERROR,
    'Webhook payload must be raw string or buffer for signature verification',
    400
  );
}

function assertWebhookAllowlist(
  request: { ip: string; raw: { socket: { remoteAddress: string | undefined } } },
  trustedProxyRules: ReturnType<typeof parseWebhookIpAllowlist>,
  rules: ReturnType<typeof parseWebhookIpAllowlist>,
  providerName: string
): void {
  if (rules.length === 0) {
    return;
  }
  const resolvedClientIp = resolveSecurityClientIp({
    directRemoteIp: request.raw.socket.remoteAddress ?? null,
    derivedRequestIp: request.ip,
    trustedProxyRules
  });
  if (!resolvedClientIp || !isIpAllowlisted(resolvedClientIp, rules)) {
    throw new AppError(
      ERROR_CODES.UNAUTHORISED,
      `${providerName} webhook request source is not allowlisted`,
      401
    );
  }
}

export async function registerOrdersRoutes(fastify: FastifyInstance): Promise<void> {
  let razorpayAllowlistRules: ReturnType<typeof parseWebhookIpAllowlist> = [];
  let shippingWebhookAllowlistRules: ReturnType<typeof parseWebhookIpAllowlist> = [];
  let trustedProxyRules: ReturnType<typeof parseWebhookIpAllowlist> = [];
  try {
    razorpayAllowlistRules = parseWebhookIpAllowlist(process.env.RAZORPAY_WEBHOOK_ALLOWLIST_CIDR);
    shippingWebhookAllowlistRules = parseWebhookIpAllowlist(process.env.SHIPPING_WEBHOOK_ALLOWLIST_CIDR);
    trustedProxyRules = parseWebhookIpAllowlist(process.env.TRUSTED_PROXY_ALLOWLIST_CIDR);
  } catch (error) {
    throw new AppError(
      ERROR_CODES.INTERNAL_ERROR,
      `Invalid webhook allowlist CIDR configuration: ${
        error instanceof Error ? error.message : 'unknown parse error'
      }`,
      500
    );
  }

  if (isProductionWithoutAllowlist(razorpayAllowlistRules)) {
    fastify.log.warn(
      {
        envKey: webhookAllowlistEnvKeyForProvider('Razorpay'),
        remediation: 'Set via Ops UI before go-live; /health/ready will stay not_ready until configured'
      },
      'Razorpay webhook IP allowlist is empty — signature verification still required on every webhook'
    );
  }
  if (isProductionWithoutAllowlist(shippingWebhookAllowlistRules)) {
    fastify.log.warn(
      {
        envKey: webhookAllowlistEnvKeyForProvider('Shipping'),
        remediation: 'Set SHIPPING_WEBHOOK_ALLOWLIST_CIDR via Ops UI before go-live'
      },
      'Shipping webhook IP allowlist is empty — provider token/signature checks still apply'
    );
  }

  if (!fastify.hasDecorator('checkoutRisk')) {
    fastify.decorate('checkoutRisk', new CheckoutRiskService(fastify));
  }
  const ordersService = new OrdersService(fastify);
  const adminGuard = [jwtAuthGuard, rolesGuard(Role.ADMIN)];
  const customerGuard = [jwtAuthGuard, rolesGuard(Role.CUSTOMER)];
  fastify.addHook('onSend', async (request, reply, payload) => {
    await idempotencyOnSend(request, reply, payload);
    return payload;
  });

  fastify.post(
    '/api/v1/orders',
    {
      schema: createOrderSchema,
      preHandler: [...customerGuard, idempotencyPreHandler],
      config: {
        rateLimit: routeRateLimitProfiles.checkoutMutation
      }
    },
    async (request) => {
      const user = getCurrentUser(request);
      return ordersService.createOrder(user.sub, request.body as never);
    }
  );

  fastify.get(
    '/api/v1/orders/:id',
    {
      schema: getMyOrderByIdSchema,
      preHandler: customerGuard
    },
    async (request) => {
      const user = getCurrentUser(request);
      const params = request.params as { id: string };
      return ordersService.getMyOrderById(user.sub, params.id);
    }
  );

  fastify.get(
    '/api/v1/orders/:id/invoice.pdf',
    {
      schema: getMyInvoicePdfSchema,
      preHandler: customerGuard
    },
    async (request, reply) => {
      const user = getCurrentUser(request);
      const params = request.params as { id: string };
      const invoice = await ordersService.getMyInvoicePdf(user.sub, params.id);
      reply.header('content-type', 'application/pdf');
      reply.header('content-disposition', `attachment; filename="${invoice.invoiceNumber}.pdf"`);
      reply.header('cache-control', 'private, no-store');
      return reply.send(invoice.content);
    }
  );

  fastify.post(
    '/api/v1/orders/:id/cancel',
    {
      schema: cancelMyOrderSchema,
      preHandler: [...customerGuard, idempotencyPreHandler],
      config: {
        rateLimit: routeRateLimitProfiles.checkoutMutation
      }
    },
    async (request) => {
      const user = getCurrentUser(request);
      const params = request.params as { id: string };
      return ordersService.cancelMyOrder(user.sub, params.id, request.body as CancelOrderInput | undefined);
    }
  );

  fastify.post(
    '/api/v1/payments/initiate',
    {
      schema: initiatePaymentSchema,
      preHandler: [...customerGuard, idempotencyPreHandler],
      config: {
        rateLimit: routeRateLimitProfiles.checkoutMutation
      }
    },
    async (request) => {
      const user = getCurrentUser(request);
      return ordersService.initiatePayment(user.sub, request.body as never, { clientIp: request.ip });
    }
  );

  fastify.post(
    '/api/v1/payments/verify',
    {
      schema: verifyPaymentSchema,
      preHandler: [...customerGuard, idempotencyPreHandler],
      config: {
        rateLimit: routeRateLimitProfiles.checkoutMutation
      }
    },
    async (request) => {
      const user = getCurrentUser(request);
      return ordersService.verifyPayment(user.sub, request.body as never);
    }
  );

  fastify.post(
    '/api/v1/payments/prepare-checkout',
    {
      schema: prepareCheckoutSchema,
      preHandler: [...customerGuard, idempotencyPreHandler],
      config: {
        rateLimit: routeRateLimitProfiles.checkoutMutation
      }
    },
    async (request) => {
      const user = getCurrentUser(request);
      return ordersService.prepareCheckout(user.sub, request.body as never, { clientIp: request.ip });
    }
  );

  fastify.post(
    '/api/v1/payments/confirm-prepaid',
    {
      schema: confirmPrepaidSchema,
      preHandler: [...customerGuard, idempotencyPreHandler],
      config: {
        rateLimit: routeRateLimitProfiles.checkoutMutation
      }
    },
    async (request) => {
      const user = getCurrentUser(request);
      return ordersService.confirmPrepaid(user.sub, request.body as never);
    }
  );

  fastify.post(
    '/api/v1/payments/webhook',
    {
      schema: paymentWebhookSchema,
      config: {
        rateLimit: routeRateLimitProfiles.webhookIngress
      }
    },
    async (request) => {
      assertWebhookAllowlist(request, trustedProxyRules, razorpayAllowlistRules, 'Razorpay');
      const signatureHeader = request.headers['x-razorpay-signature'];
      const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
      const eventIdHeader = request.headers['x-razorpay-event-id'];
      const eventId = Array.isArray(eventIdHeader) ? eventIdHeader[0] : eventIdHeader;
      const payload = requireWebhookRawPayload(request.body);
      const traceContext = request as { correlationId?: string; traceId?: string };
      return ordersService.processPaymentWebhook(signature, payload, eventId, {
        ...(traceContext.correlationId ? { correlationId: traceContext.correlationId } : {}),
        ...(traceContext.traceId ? { traceId: traceContext.traceId } : {})
      });
    }
  );

  fastify.get(
    '/api/v1/shipping/track/:awb',
    {
      schema: shippingTrackSchema,
      preHandler: customerGuard
    },
    async (request) => {
      const user = getCurrentUser(request);
      const params = request.params as { awb: string };
      return ordersService.getShippingTracking(user.sub, params.awb);
    }
  );

  fastify.post(
    '/api/v1/shipping/webhook',
    {
      schema: shippingWebhookSchema,
      config: {
        rateLimit: routeRateLimitProfiles.webhookIngress
      }
    },
    async (request) => {
      assertWebhookAllowlist(request, trustedProxyRules, shippingWebhookAllowlistRules, 'Shipping');
      const rawAuthHeader =
        request.headers['x-api-key'] ??
        request.headers['x-shiprocket-token'] ??
        request.headers.authorization;
      const authHeader = Array.isArray(rawAuthHeader) ? rawAuthHeader[0] : rawAuthHeader;
      const payload = requireWebhookRawPayload(request.body);
      const traceContext = request as { correlationId?: string; traceId?: string };
      return ordersService.processShippingWebhook(authHeader, payload, {
        ...(traceContext.correlationId ? { correlationId: traceContext.correlationId } : {}),
        ...(traceContext.traceId ? { traceId: traceContext.traceId } : {})
      });
    }
  );

  fastify.get(
    '/api/v1/admin/orders',
    {
      schema: adminListOrdersSchema,
      preHandler: [...adminGuard, adminPermissionGuard('orders:read')],
      config: {
        rateLimit: routeRateLimitProfiles.adminRead
      }
    },
    async (request) => ordersService.adminListOrders(request.query as never)
  );

  fastify.get(
    '/api/v1/admin/orders/board',
    {
      schema: adminOrderBoardSchema,
      preHandler: [...adminGuard, adminPermissionGuard('orders:read')],
      config: {
        rateLimit: routeRateLimitProfiles.adminRead
      }
    },
    async () => ordersService.adminGetOrderBoard()
  );

  fastify.get(
    '/api/v1/admin/orders/export',
    {
      schema: adminExportOrdersCsvSchema,
      preHandler: [...adminGuard, adminPermissionGuard('orders:export'), loadShedGuard],
      config: {
        rateLimit: routeRateLimitProfiles.adminRead
      }
    },
    async (request, reply) => {
      const csv = await ordersService.adminExportOrdersCsv(request.query as never);
      reply.header('content-type', 'text/csv; charset=utf-8');
      reply.header('content-disposition', 'attachment; filename="orders-export.csv"');
      return reply.send(csv);
    }
  );

  fastify.get(
    '/api/v1/admin/orders/:id',
    {
      schema: adminGetOrderByIdSchema,
      preHandler: [...adminGuard, adminPermissionGuard('orders:read')],
      config: {
        rateLimit: routeRateLimitProfiles.adminRead
      }
    },
    async (request) => {
      const params = request.params as { id: string };
      return ordersService.adminGetOrderById(params.id);
    }
  );

  fastify.get(
    '/api/v1/admin/orders/:id/invoice.pdf',
    {
      schema: adminGetInvoicePdfSchema,
      preHandler: [...adminGuard, adminPermissionGuard('orders:read')],
      config: {
        rateLimit: routeRateLimitProfiles.adminRead
      }
    },
    async (request, reply) => {
      const params = request.params as { id: string };
      const invoice = await ordersService.adminGetInvoicePdf(params.id);
      reply.header('content-type', 'application/pdf');
      reply.header('content-disposition', `attachment; filename="${invoice.invoiceNumber}.pdf"`);
      reply.header('cache-control', 'private, no-store');
      return reply.send(invoice.content);
    }
  );

  fastify.patch(
    '/api/v1/admin/orders/:id/status',
    {
      schema: adminUpdateOrderStatusSchema,
      preHandler: [
        ...adminGuard,
        adminPermissionGuard('orders:write'),
        loadShedGuard,
        requireRefundPermission,
        idempotencyPreHandler
      ],
      config: {
        rateLimit: routeRateLimitProfiles.adminWrite
      }
    },
    async (request) => {
      const adminUser = getCurrentUser(request);
      const params = request.params as { id: string };
      const body = request.body as { note?: string };
      const taggedNote = body.note?.trim()
        ? `${body.note.trim()} [admin:${adminUser.sub}]`
        : `[admin:${adminUser.sub}]`;
      return ordersService.adminUpdateOrderStatus(params.id, {
        ...(request.body as Record<string, unknown>),
        note: taggedNote
      } as never);
    }
  );

  fastify.post(
    '/api/v1/admin/orders/:id/ship',
    {
      schema: adminShipOrderSchema,
      preHandler: [...adminGuard, adminPermissionGuard('orders:write'), loadShedGuard, idempotencyPreHandler],
      config: {
        rateLimit: routeRateLimitProfiles.adminWrite
      }
    },
    async (request) => {
      const params = request.params as { id: string };
      return ordersService.adminShipOrder(params.id);
    }
  );

  fastify.post(
    '/api/v1/admin/orders/:id/cancel',
    {
      schema: adminCancelOrderSchema,
      preHandler: [...adminGuard, adminPermissionGuard('orders:refund'), loadShedGuard, idempotencyPreHandler],
      config: {
        rateLimit: routeRateLimitProfiles.adminWrite
      }
    },
    async (request) => {
      const adminUser = getCurrentUser(request);
      const params = request.params as { id: string };
      const body = (request.body as CancelOrderInput | undefined) ?? {};
      const reason = body.reason?.trim()
        ? `${body.reason.trim()} [admin:${adminUser.sub}]`
        : `Cancelled by admin [admin:${adminUser.sub}]`;
      return ordersService.adminCancelOrder(params.id, {
        ...body,
        reason
      });
    }
  );

  fastify.post(
    '/api/v1/admin/orders/:id/schedule-pickup',
    {
      schema: adminSchedulePickupSchema,
      preHandler: [...adminGuard, adminPermissionGuard('orders:write'), loadShedGuard, idempotencyPreHandler],
      config: {
        rateLimit: routeRateLimitProfiles.adminWrite
      }
    },
    async (request) => {
      const params = request.params as { id: string };
      return ordersService.adminSchedulePickup(params.id);
    }
  );

  fastify.post(
    '/api/v1/admin/orders/:id/print-label',
    {
      schema: adminPrintLabelSchema,
      preHandler: [...adminGuard, adminPermissionGuard('orders:read'), loadShedGuard, idempotencyPreHandler],
      config: {
        rateLimit: routeRateLimitProfiles.adminWrite
      }
    },
    async (request) => {
      const params = request.params as { id: string };
      return ordersService.adminPrintLabel(params.id);
    }
  );

  fastify.post(
    '/api/v1/admin/orders/:id/notifications/retrigger',
    {
      schema: adminRetriggerNotificationSchema,
      preHandler: [...adminGuard, adminPermissionGuard('orders:notify'), loadShedGuard, idempotencyPreHandler],
      config: {
        rateLimit: routeRateLimitProfiles.adminWrite
      }
    },
    async (request) => {
      const params = request.params as { id: string };
      return ordersService.adminRetriggerNotification(params.id, request.body as never);
    }
  );

  fastify.post(
    '/api/v1/payments/retry',
    {
      schema: retryPaymentSchema,
      preHandler: [...customerGuard, idempotencyPreHandler],
      config: {
        rateLimit: routeRateLimitProfiles.checkoutMutation
      }
    },
    async (request) => {
      const user = getCurrentUser(request);
      const body = request.body as { orderId: string };
      const retryClientIp = resolveSecurityClientIp({
        directRemoteIp: request.raw.socket.remoteAddress ?? null,
        derivedRequestIp: request.ip,
        trustedProxyRules
      });
      return ordersService.retryPayment(
        user.sub,
        body.orderId,
        retryClientIp !== null ? { clientIp: retryClientIp } : {}
      );
    }
  );

  fastify.post(
    '/api/v1/orders/:id/return-requests',
    {
      schema: createReturnRequestSchema,
      preHandler: [...customerGuard, idempotencyPreHandler],
      config: {
        rateLimit: routeRateLimitProfiles.checkoutMutation
      }
    },
    async (request, reply) => {
      const user = getCurrentUser(request);
      const params = request.params as { id: string };
      const body = request.body as { items: Array<{ orderItemId: string; quantity: number; reason?: string }>; reason: string };
      const result = await ordersService.createReturnRequest(user.sub, params.id, body);
      reply.code(201);
      return result;
    }
  );

  fastify.get(
    '/api/v1/admin/return-requests',
    {
      schema: adminListReturnRequestsSchema,
      preHandler: [...adminGuard, adminPermissionGuard('orders:read')],
      config: {
        rateLimit: routeRateLimitProfiles.adminRead
      }
    },
    async (request) => {
      const query = request.query as { status?: ReturnRequestStatus; orderId?: string; page?: number; limit?: number };
      return ordersService.adminListReturnRequests(query);
    }
  );

  fastify.get(
    '/api/v1/admin/shipments',
    {
      schema: adminListShipmentsSchema,
      preHandler: [...adminGuard, adminPermissionGuard('shipments:read')],
      config: {
        rateLimit: routeRateLimitProfiles.adminRead
      }
    },
    async (request) => ordersService.adminListShipments(request.query as never)
  );

  fastify.get(
    '/api/v1/admin/payments',
    {
      schema: adminListPaymentsSchema,
      preHandler: [...adminGuard, adminPermissionGuard('payments:read')],
      config: {
        rateLimit: routeRateLimitProfiles.adminRead
      }
    },
    async (request) => ordersService.adminListPayments(request.query as never)
  );

  fastify.get(
    '/api/v1/admin/return-requests/:id',
    {
      schema: adminGetReturnRequestSchema,
      preHandler: [...adminGuard, adminPermissionGuard('orders:read')],
      config: {
        rateLimit: routeRateLimitProfiles.adminRead
      }
    },
    async (request) => {
      const params = request.params as { id: string };
      return ordersService.adminGetReturnRequest(params.id);
    }
  );

  fastify.patch(
    '/api/v1/admin/return-requests/:id',
    {
      schema: adminUpdateReturnRequestSchema,
      preHandler: [...adminGuard, adminPermissionGuard('orders:write'), loadShedGuard, idempotencyPreHandler],
      config: {
        rateLimit: routeRateLimitProfiles.adminWrite
      }
    },
    async (request) => {
      const adminUser = getCurrentUser(request);
      const params = request.params as { id: string };
      const body = request.body as { status: ReturnRequestStatus; adminNote?: string };
      return ordersService.adminUpdateReturnRequest(adminUser.sub, params.id, body);
    }
  );

  fastify.patch(
    '/api/v1/admin/orders/:id/items',
    {
      schema: adminUpdateOrderItemsSchema,
      preHandler: [...adminGuard, adminPermissionGuard('orders:write'), loadShedGuard, idempotencyPreHandler],
      config: {
        rateLimit: routeRateLimitProfiles.adminWrite
      }
    },
    async (request) => {
      const adminUser = getCurrentUser(request);
      const params = request.params as { id: string };
      const body = request.body as { updates: Array<{ orderItemId: string; quantity: number }> };
      return ordersService.adminUpdateOrderItems(adminUser.sub, params.id, body.updates);
    }
  );

  fastify.get(
    '/api/v1/admin/shipments/:id',
    {
      schema: adminGetShipmentByIdSchema,
      preHandler: [...adminGuard, adminPermissionGuard('shipments:read')],
      config: {
        rateLimit: routeRateLimitProfiles.adminRead
      }
    },
    async (request) => {
      const params = request.params as { id: string };
      return ordersService.adminGetShipmentById(params.id);
    }
  );

  fastify.post(
    '/api/v1/admin/shipments/:id/sync',
    {
      schema: adminSyncShipmentStatusSchema,
      preHandler: [...adminGuard, adminPermissionGuard('orders:write')],
      config: {
        rateLimit: routeRateLimitProfiles.adminWrite
      }
    },
    async (request) => {
      const params = request.params as { id: string };
      return ordersService.adminSyncShipmentStatus(params.id);
    }
  );

  fastify.get(
    '/api/v1/admin/payments/:id',
    {
      schema: adminGetPaymentByIdSchema,
      preHandler: [...adminGuard, adminPermissionGuard('payments:read')],
      config: {
        rateLimit: routeRateLimitProfiles.adminRead
      }
    },
    async (request) => {
      const params = request.params as { id: string };
      return ordersService.adminGetPaymentById(params.id);
    }
  );

  fastify.get(
    '/api/v1/admin/orders/:id/timeline',
    {
      schema: adminGetOrderTimelineSchema,
      preHandler: [...adminGuard, adminPermissionGuard('orders:read')],
      config: {
        rateLimit: routeRateLimitProfiles.adminRead
      }
    },
    async (request) => {
      const params = request.params as { id: string };
      return ordersService.adminGetOrderTimeline(params.id);
    }
  );
}

