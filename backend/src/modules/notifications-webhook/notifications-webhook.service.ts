import { createHmac, timingSafeEqual } from 'crypto';
import { FastifyInstance } from 'fastify';
import { AppError } from '@common/errors/app-error';
import { ERROR_CODES } from '@common/errors/error-codes';
import { decryptOpsConfigValue } from '@common/security/ops-config-crypto';

type MetaWebhookVerifyQuery = {
  'hub.mode': string;
  'hub.verify_token': string;
  'hub.challenge': string;
};

type MetaWebhookEventPayload = {
  object: string;
  entry: Array<Record<string, unknown>>;
};

/**
 * Handles Meta WhatsApp webhook verification and event ingestion.
 */
export class NotificationsWebhookService {
  constructor(private readonly fastify: FastifyInstance) {}

  private async resolveRuntimeConfig(): Promise<NodeJS.ProcessEnv> {
    const runtimeConfig: NodeJS.ProcessEnv = {};
    const prismaLike = (this.fastify as unknown as { prisma?: unknown }).prisma as
      | { opsConfigSecret?: unknown }
      | undefined;
    if (!prismaLike?.opsConfigSecret) {
      // Test-only fallback to process.env to keep route tests simple without DB overlay
      if ((process.env.NODE_ENV ?? '').trim().toLowerCase() === 'test') {
        if (process.env.META_WHATSAPP_APP_SECRET) runtimeConfig.META_WHATSAPP_APP_SECRET = process.env.META_WHATSAPP_APP_SECRET;
        if (process.env.META_WHATSAPP_WEBHOOK_VERIFY_TOKEN)
          runtimeConfig.META_WHATSAPP_WEBHOOK_VERIFY_TOKEN = process.env.META_WHATSAPP_WEBHOOK_VERIFY_TOKEN;
      }
      return runtimeConfig;
    }

    const opsConfigSecretDelegate = prismaLike.opsConfigSecret as unknown as {
      findMany?: (args: {
        where: { isActive: true; secretKey: { in: string[] } };
        select: { secretKey: true; encryptedValue: true };
      }) => Promise<Array<{ secretKey: string; encryptedValue: string }>>;
    };

    if (!opsConfigSecretDelegate.findMany) {
      if ((process.env.NODE_ENV ?? '').trim().toLowerCase() === 'test') {
        if (process.env.META_WHATSAPP_APP_SECRET) runtimeConfig.META_WHATSAPP_APP_SECRET = process.env.META_WHATSAPP_APP_SECRET;
        if (process.env.META_WHATSAPP_WEBHOOK_VERIFY_TOKEN)
          runtimeConfig.META_WHATSAPP_WEBHOOK_VERIFY_TOKEN = process.env.META_WHATSAPP_WEBHOOK_VERIFY_TOKEN;
      }
      return runtimeConfig;
    }

    const rows = await opsConfigSecretDelegate.findMany({
      where: {
        isActive: true,
        secretKey: { in: ['META_WHATSAPP_APP_SECRET', 'META_WHATSAPP_WEBHOOK_VERIFY_TOKEN'] }
      },
      select: {
        secretKey: true,
        encryptedValue: true
      }
    });

    for (const row of rows) {
      runtimeConfig[row.secretKey] = decryptOpsConfigValue(row.encryptedValue);
    }

    // If keys are still missing during tests, fill from process.env to avoid coupling tests to DB overlay
    if ((process.env.NODE_ENV ?? '').trim().toLowerCase() === 'test') {
      if (!runtimeConfig.META_WHATSAPP_APP_SECRET && process.env.META_WHATSAPP_APP_SECRET)
        runtimeConfig.META_WHATSAPP_APP_SECRET = process.env.META_WHATSAPP_APP_SECRET;
      if (!runtimeConfig.META_WHATSAPP_WEBHOOK_VERIFY_TOKEN && process.env.META_WHATSAPP_WEBHOOK_VERIFY_TOKEN)
        runtimeConfig.META_WHATSAPP_WEBHOOK_VERIFY_TOKEN = process.env.META_WHATSAPP_WEBHOOK_VERIFY_TOKEN;
    }
    return runtimeConfig;
  }

  private verifyMetaWhatsappEventSignature(signatureHeader: string | undefined, rawPayload: Buffer, appSecret: string): void {
    if (!appSecret) {
      throw new AppError(ERROR_CODES.INTERNAL_ERROR, 'Meta webhook app secret is not configured', 500);
    }

    const signatureValue = signatureHeader?.trim();
    if (!signatureValue || !signatureValue.startsWith('sha256=')) {
      throw new AppError(ERROR_CODES.FORBIDDEN, 'Meta webhook signature is missing or malformed', 403);
    }

    const providedHex = signatureValue.slice('sha256='.length);
    if (!/^[a-fA-F0-9]{64}$/.test(providedHex)) {
      throw new AppError(ERROR_CODES.FORBIDDEN, 'Meta webhook signature is malformed', 403);
    }

    const expectedHex = createHmac('sha256', appSecret).update(rawPayload).digest('hex');
    const providedBuffer = Buffer.from(providedHex, 'hex');
    const expectedBuffer = Buffer.from(expectedHex, 'hex');
    const isValid = providedBuffer.length === expectedBuffer.length && timingSafeEqual(providedBuffer, expectedBuffer);
    if (!isValid) {
      throw new AppError(ERROR_CODES.FORBIDDEN, 'Meta webhook signature verification failed', 403);
    }
  }

  /**
   * Verifies Meta webhook challenge for endpoint activation.
   */
  async verifyMetaWhatsappWebhook(query: MetaWebhookVerifyQuery): Promise<string> {
    const runtimeConfig = await this.resolveRuntimeConfig();
    const mode = query['hub.mode'];
    const verifyToken = query['hub.verify_token'];
    const challenge = query['hub.challenge'];
    const expectedToken = (runtimeConfig.META_WHATSAPP_WEBHOOK_VERIFY_TOKEN ?? '').trim();

    if (mode !== 'subscribe' || !expectedToken || verifyToken !== expectedToken) {
      throw new AppError(ERROR_CODES.FORBIDDEN, 'Meta webhook verification failed', 403);
    }

    return challenge;
  }

  /**
   * Logs inbound Meta webhook events and returns acknowledgement.
   */
  async processMetaWhatsappWebhook(signatureHeader: string | undefined, payload: Buffer | string): Promise<{ received: true }> {
    const runtimeConfig = await this.resolveRuntimeConfig();
    const rawPayload = typeof payload === 'string' ? Buffer.from(payload, 'utf8') : payload;
    const appSecret = (runtimeConfig.META_WHATSAPP_APP_SECRET ?? '').trim();
    this.verifyMetaWhatsappEventSignature(signatureHeader, rawPayload, appSecret);

    let parsedPayload: MetaWebhookEventPayload;
    try {
      parsedPayload = JSON.parse(rawPayload.toString('utf8')) as MetaWebhookEventPayload;
    } catch {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Invalid Meta webhook payload', 400);
    }

    if (
      parsedPayload.object !== 'whatsapp_business_account' ||
      !Array.isArray(parsedPayload.entry) ||
      parsedPayload.entry.length === 0
    ) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Invalid Meta webhook event payload', 400);
    }

    this.fastify.log.info(
      {
        object: parsedPayload.object,
        entryCount: parsedPayload.entry.length
      },
      'Received Meta WhatsApp webhook event'
    );

    return { received: true };
  }
}
