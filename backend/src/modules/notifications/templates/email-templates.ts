import { AppError } from '@common/errors/app-error';
import { ERROR_CODES } from '@common/errors/error-codes';
import { render } from '@react-email/render';
import {
  AdminInviteSetupEmail,
  CustomerOtpVerificationEmail,
  LowStockAlertEmail,
  NotificationDeliveryFailureEmail,
  OtpVerificationEmail,
  OrderCancelledEmail,
  ReturnRequestUpdateEmail,
  OrderConfirmedEmail,
  AdminNewOrderEmail,
  OrderDeliveredEmail,
  OrderShippedEmail,
  OutForDeliveryEmail,
  PasswordResetEmail,
  PaymentFailedEmail,
  OpsInviteSetupEmail,
  OpsActionOtpEmail,
  ProcessRestartAlertEmail
} from './email-template-components';

export const supportedEmailTemplates = [
  'OrderConfirmed',
  'PaymentFailed',
  'OrderShipped',
  'OutForDelivery',
  'OrderDelivered',
  'OrderCancelled',
  'AdminNewOrder',
  'ReturnRequestUpdate',
  'LowStockAlert',
  'OtpVerification',
  'CustomerOtpVerification',
  'NotificationDeliveryFailure',
  'PasswordReset',
  'AdminInviteSetup',
  'OpsInviteSetup',
  'OpsActionOtp',
  'ProcessRestartAlert'
] as const;

export type EmailTemplateName = (typeof supportedEmailTemplates)[number];

type RenderedEmail = {
  subject: string;
  html: string;
};

function escapeHtml(input: unknown): string {
  return String(input)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export async function renderNotificationEmail(template: string, data: Record<string, unknown>): Promise<RenderedEmail> {
  if (!supportedEmailTemplates.includes(template as EmailTemplateName)) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, `Unsupported email template: ${template}`, 400);
  }

  const orderId = data.orderId ? escapeHtml(data.orderId) : 'N/A';
  // Use human-readable orderNumber when available, fall back to orderId UUID
  const orderRef = data.orderNumber ? escapeHtml(data.orderNumber) : orderId;

  switch (template as EmailTemplateName) {
    case 'OrderConfirmed':
      return {
        subject: `Order confirmed — ${orderRef}`,
        html: await render(OrderConfirmedEmail(orderRef))
      };
    case 'PaymentFailed':
      return {
        subject: `Payment failed — action required for ${orderRef}`,
        html: await render(PaymentFailedEmail(orderRef))
      };
    case 'OrderShipped': {
      const shippedOptions: { trackingUrl?: string; awb?: string; estimatedDays?: number } = {};
      if (typeof data.trackingUrl === 'string') shippedOptions.trackingUrl = data.trackingUrl;
      if (typeof data.awb === 'string') shippedOptions.awb = data.awb;
      if (typeof data.estimatedDays === 'number') shippedOptions.estimatedDays = data.estimatedDays;
      return {
        subject: `Your order ${orderRef} has been shipped`,
        html: await render(OrderShippedEmail(orderRef, shippedOptions))
      };
    }
    case 'AdminNewOrder': {
      const customerName = typeof data.customerName === 'string' && data.customerName.trim() ? escapeHtml(data.customerName.trim()) : 'A customer';
      const amount = typeof data.amount === 'string' ? escapeHtml(data.amount) : '';
      const paymentMode = typeof data.paymentMode === 'string' ? escapeHtml(data.paymentMode) : '';
      return {
        subject: 'New order ' + orderRef + ' — ' + (amount || 'review in admin panel'),
        html: await render(AdminNewOrderEmail({ orderRef, customerName, amount, paymentMode }))
      };
    }
    case 'OutForDelivery':
      return {
        subject: `Your order ${orderRef} is out for delivery today`,
        html: await render(OutForDeliveryEmail(orderRef))
      };
    case 'OrderDelivered':
      return {
        subject: `Your order ${orderRef} has been delivered`,
        html: await render(OrderDeliveredEmail(orderRef))
      };
    case 'OrderCancelled':
      return {
        subject: `Your order ${orderRef} has been cancelled`,
        html: await render(OrderCancelledEmail(orderRef))
      };
    case 'ReturnRequestUpdate': {
      const returnStatus =
        typeof data.returnStatus === 'string' && data.returnStatus.trim()
          ? escapeHtml(data.returnStatus.trim())
          : 'updated';
      const note =
        typeof data.note === 'string' && data.note.trim() ? escapeHtml(data.note.trim()) : undefined;
      return {
        subject: `Update on your return request for ${orderRef}`,
        html: await render(ReturnRequestUpdateEmail(orderRef, returnStatus, note))
      };
    }
    case 'LowStockAlert':
      {
        const items = Array.isArray(data.items)
          ? data.items
              .map((item) => {
                if (!item || typeof item !== 'object') {
                  return null;
                }
                const row = item as Record<string, unknown>;
                return {
                  sku: escapeHtml(row.sku ?? 'N/A'),
                  quantity: Number(row.quantity ?? 0),
                  lowStockThreshold: Number(row.lowStockThreshold ?? 0)
                };
              })
              .filter((item): item is { sku: string; quantity: number; lowStockThreshold: number } => item !== null)
          : [];

      return {
        subject: `Low stock alert — ${items.length} variant${items.length === 1 ? '' : 's'} below threshold`,
        html: await render(LowStockAlertEmail(items))
      };
      }
    case 'OtpVerification':
      {
        const otp = escapeHtml(data.otp ?? 'N/A');
      return {
        subject: 'Your admin login code — Raghava Organics',
        html: await render(OtpVerificationEmail(otp))
      };
      }
    case 'CustomerOtpVerification':
      {
        const otp = escapeHtml(data.otp ?? 'N/A');
        const storeName = escapeHtml(data.storeName ?? 'Our Store');
        return {
          subject: `Your sign-in code for ${storeName}`,
          html: await render(CustomerOtpVerificationEmail(otp, storeName))
        };
      }
    case 'NotificationDeliveryFailure':
      {
        const template = escapeHtml(data.template ?? 'UnknownTemplate');
        const channel = escapeHtml(data.channel ?? 'UNKNOWN');
        const recipient = escapeHtml(data.recipient ?? 'unknown');
        const errorMessage = escapeHtml(data.errorMessage ?? 'Unknown delivery error');
        const domain = escapeHtml(data.domain ?? 'system');
        const component = escapeHtml(data.component ?? 'unknown-component');
        const failureStage = escapeHtml(data.failureStage ?? 'UNKNOWN');
        const queueName = escapeHtml(data.queueName ?? 'unknown');
        const jobName = escapeHtml(data.jobName ?? 'unknown');
        const jobId = escapeHtml(data.jobId ?? 'unknown');
        const outboxMessageId = escapeHtml(data.outboxMessageId ?? 'n/a');
        const route = escapeHtml(data.route ?? 'n/a');
        const method = escapeHtml(data.method ?? 'n/a');
        const statusCode = escapeHtml(data.statusCode ?? 500);
        const terminalFailure = escapeHtml(data.terminalFailure ?? false);
        const clientName = escapeHtml(data.clientName ?? 'Unknown Client');
        const websiteUrl = escapeHtml(data.websiteUrl ?? 'https://unknown-client.local');
        return {
          subject: `[Alert] Notification delivery failure — ${template}`,
          html: await render(
            NotificationDeliveryFailureEmail({
              template,
              channel,
              recipient,
              errorMessage,
              domain,
              component,
              failureStage,
              queueName,
              jobName,
              jobId,
              outboxMessageId,
              route,
              method,
              statusCode,
              terminalFailure,
              clientName,
              websiteUrl
            })
          )
        };
      }
    case 'PasswordReset':
      {
        const email = escapeHtml(data.email ?? 'N/A');
        const resetUrl = typeof data.resetUrl === 'string' ? data.resetUrl : 'N/A';
        return {
          subject: 'Reset your Raghava Organics password',
          html: await render(PasswordResetEmail(email, resetUrl))
        };
      }
    case 'OpsInviteSetup':
      {
        const email = escapeHtml(data.email ?? 'N/A');
        const setupUrl = escapeHtml(data.setupUrl ?? 'N/A');
        const expiresAt = escapeHtml(data.expiresAt ?? 'N/A');
        return {
          subject: 'Your Raghava Organics ops account setup invite',
          html: await render(OpsInviteSetupEmail(email, setupUrl, expiresAt))
        };
      }
    case 'AdminInviteSetup':
      {
        const email = escapeHtml(data.email ?? 'N/A');
        const setupUrl = escapeHtml(data.setupUrl ?? 'N/A');
        const expiresAt = escapeHtml(data.expiresAt ?? 'N/A');
        return {
          subject: 'Your Raghava Organics merchant admin setup invite',
          html: await render(AdminInviteSetupEmail(email, setupUrl, expiresAt))
        };
      }
    case 'OpsActionOtp':
      {
        const action = escapeHtml(data.action ?? 'ops-write');
        const code = escapeHtml(data.code ?? 'N/A');
        const expiresAt = escapeHtml(data.expiresAt ?? 'N/A');
        return {
          subject: `Ops authorization code — ${action}`,
          html: await render(OpsActionOtpEmail(action, code, expiresAt))
        };
      }
    case 'ProcessRestartAlert':
      {
        const requestedBy = escapeHtml(data.requestedBy ?? 'unknown');
        const scheduledFor = escapeHtml(data.scheduledFor ?? 'unknown');
        const jobId = escapeHtml(data.jobId ?? 'unknown');
        const clientName = escapeHtml(data.clientName ?? 'Unknown Client');
        const websiteUrl = escapeHtml(data.websiteUrl ?? 'https://unknown-client.local');
        return {
          subject: `[ACTION REQUIRED] Process restart triggered — ${clientName}`,
          html: await render(ProcessRestartAlertEmail({ requestedBy, scheduledFor, jobId, clientName, websiteUrl }))
        };
      }
  }
}
