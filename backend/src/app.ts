import { FastifyInstance } from 'fastify';
import { registerAnalyticsRoutes } from './modules/analytics/analytics.routes';
import { registerAuthRoutes } from './modules/auth/auth.routes';
import { registerCartRoutes } from './modules/cart/cart.routes';
import { registerCouponsRoutes } from './modules/coupons/coupons.routes';
import { registerDashboardRoutes } from './modules/dashboard/dashboard.routes';
import { registerGalleryRoutes } from './modules/gallery/gallery.routes';
import { registerHealthRoutes } from './modules/health/health.routes';
import { registerInventoryRoutes } from './modules/inventory/inventory.routes';
import { registerMaintenanceRoutes } from './modules/maintenance/maintenance.routes';
import { registerNotificationsWebhookRoutes } from './modules/notifications-webhook/notifications-webhook.routes';
import { registerOrdersRoutes } from './modules/orders/orders.routes';
import { registerOpsRoutes } from './modules/ops/ops.routes';
import { registerMediaRoutes } from './modules/media/media.routes';
import { registerProductsRoutes } from './modules/products/products.routes';
import { registerQueuesRoutes } from './modules/queues/queues.routes';
import { registerReviewsRoutes } from './modules/reviews/reviews.routes';
import { registerSettingsRoutes } from './modules/settings/settings.routes';
import { registerUsersRoutes } from './modules/users/users.routes';
import { registerWishlistRoutes } from './modules/wishlist/wishlist.routes';
import { assertAdminPolicyRegistryIntegrity } from '@common/auth/admin-policy-registry.validation';

export async function registerApp(fastify: FastifyInstance): Promise<void> {
  assertAdminPolicyRegistryIntegrity();
  await registerHealthRoutes(fastify);
  // Public maintenance status + Nginx auth_request gate. Registered before
  // auth/cart/etc so the routes are reachable while the platform is in
  // `maintenance` mode (they are listed in `ALWAYS_ALLOWED_PREFIXES`).
  await registerMaintenanceRoutes(fastify);
  await registerAuthRoutes(fastify);
  await registerCartRoutes(fastify);
  await registerUsersRoutes(fastify);
  await registerMediaRoutes(fastify);
  await registerProductsRoutes(fastify);
  await registerWishlistRoutes(fastify);
  await registerReviewsRoutes(fastify);
  await registerGalleryRoutes(fastify);
  await registerInventoryRoutes(fastify);
  await registerNotificationsWebhookRoutes(fastify);
  await registerSettingsRoutes(fastify);
  await registerCouponsRoutes(fastify);
  await registerOrdersRoutes(fastify);
  await registerDashboardRoutes(fastify);
  await registerAnalyticsRoutes(fastify);
  await registerQueuesRoutes(fastify);
  await registerOpsRoutes(fastify);
}

