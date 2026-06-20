import Fastify from 'fastify';
import { createHmac } from 'crypto';
import { describe, expect, it, vi } from 'vitest';

import { registerGlobalErrorHandler } from '@common/errors/error-handler';
import { registerNotificationsWebhookRoutes } from './notifications-webhook.routes';

describe('notifications webhook routes', () => {
  it('registers Meta webhook GET and POST routes', async () => {
    const app = Fastify();
    const routes: Array<{ method: string | string[]; url: string }> = [];

    app.addHook('onRoute', (routeOptions) => {
      routes.push({
        method: routeOptions.method,
        url: routeOptions.url
      });
    });

    await registerNotificationsWebhookRoutes(app);

    const verifyRoute = routes.find(
      (route) => route.url === '/api/v1/notifications/webhook/meta-whatsapp' && route.method === 'GET'
    );
    const eventRoute = routes.find(
      (route) => route.url === '/api/v1/notifications/webhook/meta-whatsapp' && route.method === 'POST'
    );

    expect(verifyRoute).toBeDefined();
    expect(eventRoute).toBeDefined();

    await app.close();
  });

  it('returns challenge for valid Meta webhook verification request', async () => {
    process.env.META_WHATSAPP_WEBHOOK_VERIFY_TOKEN = 'verify_me';
    const app = Fastify();

    await registerGlobalErrorHandler(app);
    await registerNotificationsWebhookRoutes(app);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/notifications/webhook/meta-whatsapp?hub.mode=subscribe&hub.verify_token=verify_me&hub.challenge=abc123'
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('abc123');

    await app.close();
  });

  it('rejects invalid Meta webhook verification token', async () => {
    process.env.META_WHATSAPP_WEBHOOK_VERIFY_TOKEN = 'verify_me';
    const app = Fastify();

    await registerGlobalErrorHandler(app);
    await registerNotificationsWebhookRoutes(app);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/notifications/webhook/meta-whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=abc123'
    });

    expect(response.statusCode).toBe(403);

    await app.close();
  });

  it('acknowledges valid Meta webhook event payload', async () => {
    process.env.META_WHATSAPP_APP_SECRET = 'meta_app_secret';
    const app = Fastify();
    const logSpy = vi.spyOn(app.log, 'info');

    await registerGlobalErrorHandler(app);
    await registerNotificationsWebhookRoutes(app);

    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              field: 'messages',
              value: {
                statuses: [{ id: 'wamid.123', status: 'sent' }]
              }
            }
          ]
        }
      ]
    };
    const rawPayload = JSON.stringify(payload);
    const signature = `sha256=${createHmac('sha256', 'meta_app_secret').update(rawPayload).digest('hex')}`;

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/notifications/webhook/meta-whatsapp',
      headers: {
        'x-hub-signature-256': signature,
        'content-type': 'application/json'
      },
      payload: rawPayload
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ received: true });
    expect(logSpy).toHaveBeenCalled();

    await app.close();
  });

  it('rejects Meta webhook event payload when signature header is missing', async () => {
    process.env.META_WHATSAPP_APP_SECRET = 'meta_app_secret';
    const app = Fastify();

    await registerGlobalErrorHandler(app);
    await registerNotificationsWebhookRoutes(app);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/notifications/webhook/meta-whatsapp',
      headers: {
        'content-type': 'application/json'
      },
      payload: JSON.stringify({
        object: 'whatsapp_business_account',
        entry: [
          {
            changes: [
              {
                field: 'messages',
                value: {
                  statuses: [{ id: 'wamid.123', status: 'sent' }]
                }
              }
            ]
          }
        ]
      })
    });

    expect(response.statusCode).toBe(403);

    await app.close();
  });
});
