import { FastifyInstance } from 'fastify';
import { AppError } from '@common/errors/app-error';
import { ERROR_CODES } from '@common/errors/error-codes';
import { routeRateLimitProfiles } from '@common/rate-limit/rate-limit-policies';
import {
  metaWhatsappWebhookEventSchema,
  metaWhatsappWebhookVerifySchema
} from './notifications-webhook.schema';
import { NotificationsWebhookService } from './notifications-webhook.service';

function requireWebhookRawPayload(body: unknown): string | Buffer {
  if (typeof body === 'string' || Buffer.isBuffer(body)) {
    return body;
  }
  if (body && typeof body === 'object') {
    return JSON.stringify(body);
  }
  throw new AppError(
    ERROR_CODES.VALIDATION_ERROR,
    'Meta webhook payload must be raw string or buffer for signature verification',
    400
  );
}

/**
 * Registers dedicated routes for Meta WhatsApp webhook verification and events.
 */
export async function registerNotificationsWebhookRoutes(fastify: FastifyInstance): Promise<void> {
  const service = new NotificationsWebhookService(fastify);

  fastify.get(
    '/api/v1/notifications/webhook/meta-whatsapp',
    {
      schema: metaWhatsappWebhookVerifySchema,
      config: {
        rateLimit: routeRateLimitProfiles.webhookIngress
      }
    },
    async (request, reply) => {
      const challenge = await service.verifyMetaWhatsappWebhook(request.query as {
        'hub.mode': string;
        'hub.verify_token': string;
        'hub.challenge': string;
      });

      reply.type('text/plain');
      return challenge;
    }
  );

  fastify.post(
    '/api/v1/notifications/webhook/meta-whatsapp',
    {
      schema: metaWhatsappWebhookEventSchema,
      config: {
        rateLimit: routeRateLimitProfiles.webhookIngress
      }
    },
    async (request) => {
      const signatureHeader = request.headers['x-hub-signature-256'];
      const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
      const payload = requireWebhookRawPayload(request.body);
      return service.processMetaWhatsappWebhook(signature, payload);
    }
  );
}
