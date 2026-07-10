import { createElement, type ReactElement } from 'react';

// ─── Brand tokens ─────────────────────────────────────────────────────────────
const B = {
  green: '#23403d',
  greenDark: '#1a2e2c',
  greenMid: '#2e5451',
  coral: '#ec6e55',
  coralDark: '#d45c44',
  cream: '#faf3ef',
  creamDark: '#f0e8e0',
  border: '#e8ddd6',
  white: '#ffffff',
  textPrimary: '#1a2e2c',
  textSecondary: '#5c6b69',
  textMuted: '#8c9e9b',
  successGreen: '#15803d',
  successBg: '#f0fdf4',
  successBorder: '#bbf7d0',
  errorRed: '#dc2626',
  errorBg: '#fef2f2',
  errorBorder: '#fecaca',
  warningAmber: '#d97706',
  warningBg: '#fffbeb',
  warningBorder: '#fde68a',
  infoBlueBg: '#eff6ff',
  infoBlueBorder: '#bfdbfe',
  infoBlue: '#2563eb',
};

// ─── Shared layout primitives ─────────────────────────────────────────────────

function el(tag: string, props: Record<string, unknown> | null, ...children: (ReactElement | string | null | undefined | false)[]): ReactElement {
  return createElement(tag as 'div', props as Record<string, unknown>, ...children.filter(Boolean)) as ReactElement;
}

function Wrapper(...children: ReactElement[]): ReactElement {
  return el('html', { lang: 'en' },
    el('head', null,
      el('meta', { charSet: 'UTF-8' }),
      el('meta', { name: 'viewport', content: 'width=device-width, initial-scale=1.0' })
    ),
    el('body', {
      style: {
        margin: 0, padding: 0,
        backgroundColor: B.cream,
        fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
        WebkitFontSmoothing: 'antialiased'
      }
    },
      el('table', {
        width: '100%', cellPadding: 0, cellSpacing: 0,
        style: { backgroundColor: B.cream, padding: '40px 20px' }
      },
        el('tr', null,
          el('td', { align: 'center' },
            // ── Card wrapper max 600px ──
            el('table', {
              cellPadding: 0, cellSpacing: 0,
              style: { maxWidth: '600px', width: '100%' }
            },
              // ── Header ──
              el('tr', null,
                el('td', {
                  style: {
                    backgroundColor: B.green,
                    padding: '28px 40px 24px',
                    borderRadius: '16px 16px 0 0'
                  }
                },
                  el('table', { width: '100%', cellPadding: 0, cellSpacing: 0 }, el('tr', null,
                    el('td', null,
                      el('p', {
                        style: {
                          margin: 0,
                          fontSize: '20px', fontWeight: 700,
                          color: B.white, letterSpacing: '-0.3px'
                        }
                      }, 'Raghava Organics'),
                      el('p', {
                        style: { margin: '3px 0 0', fontSize: '12px', color: '#8ab5b2', letterSpacing: '0.5px', textTransform: 'uppercase' }
                      }, 'Pure · Natural · Organic')
                    )
                  ))
                )
              ),
              // ── Content area ──
              el('tr', null,
                el('td', {
                  style: {
                    backgroundColor: B.white,
                    padding: '40px 40px 36px',
                    borderLeft: `1px solid ${B.border}`,
                    borderRight: `1px solid ${B.border}`
                  }
                }, ...children)
              ),
              // ── Footer ──
              el('tr', null,
                el('td', {
                  style: {
                    backgroundColor: B.creamDark,
                    padding: '24px 40px',
                    borderRadius: '0 0 16px 16px',
                    borderLeft: `1px solid ${B.border}`,
                    borderRight: `1px solid ${B.border}`,
                    borderBottom: `1px solid ${B.border}`,
                    textAlign: 'center'
                  }
                },
                  el('p', {
                    style: { margin: 0, fontSize: '12px', color: B.textMuted }
                  }, '© 2026 Raghava Organics. All rights reserved.'),
                  el('p', {
                    style: { margin: '6px 0 0', fontSize: '11px', color: B.textMuted }
                  }, 'support@raghavaorganics.com | raghavaorganics.com'),
                  el('p', {
                    style: { margin: '10px 0 0', fontSize: '11px', color: '#b0c4c2' }
                  }, 'You are receiving this email because you have an account with Raghava Organics.')
                )
              )
            )
          )
        )
      )
    )
  );
}

// Badge strip at top of content (colored pill)
function StatusBadge(label: string, color: string, bg: string): ReactElement {
  return el('div', {
    style: {
      display: 'inline-block',
      padding: '4px 14px',
      backgroundColor: bg,
      color: color,
      borderRadius: '100px',
      fontSize: '11px',
      fontWeight: 700,
      letterSpacing: '0.8px',
      textTransform: 'uppercase',
      marginBottom: '20px'
    }
  }, label);
}

function Heading(text: string): ReactElement {
  return el('h1', {
    style: {
      margin: '0 0 14px',
      fontSize: '26px',
      fontWeight: 700,
      color: B.textPrimary,
      lineHeight: '1.25',
      letterSpacing: '-0.3px'
    }
  }, text);
}

function Body(text: string): ReactElement {
  return el('p', {
    style: { margin: '0 0 20px', fontSize: '15px', color: B.textSecondary, lineHeight: '1.65' }
  }, text);
}

function Divider(): ReactElement {
  return el('hr', {
    style: { border: 'none', borderTop: `1px solid ${B.border}`, margin: '28px 0' }
  });
}

function InfoBox(children: ReactElement | ReactElement[], bg: string = B.infoBlueBg, border: string = B.infoBlueBorder): ReactElement {
  return el('div', {
    style: {
      backgroundColor: bg,
      border: `1px solid ${border}`,
      borderRadius: '10px',
      padding: '16px 20px',
      margin: '20px 0'
    }
  }, ...(Array.isArray(children) ? children : [children]));
}

function InfoRow(label: string, value: string): ReactElement {
  return el('tr', null,
    el('td', {
      style: { padding: '6px 12px 6px 0', fontSize: '13px', color: B.textMuted, whiteSpace: 'nowrap', verticalAlign: 'top', fontWeight: 600 }
    }, label),
    el('td', {
      style: { padding: '6px 0', fontSize: '13px', color: B.textPrimary, wordBreak: 'break-all' }
    }, value)
  );
}

function PrimaryButton(text: string, href: string): ReactElement {
  return el('table', { cellPadding: 0, cellSpacing: 0, style: { margin: '28px 0 8px' } },
    el('tr', null,
      el('td', {
        style: {
          backgroundColor: B.green,
          borderRadius: '100px',
          padding: '14px 32px'
        }
      },
        el('a', {
          href,
          style: {
            color: B.white,
            fontSize: '15px',
            fontWeight: 700,
            textDecoration: 'none',
            display: 'block'
          }
        }, text)
      )
    )
  );
}


function FallbackLink(href: string): ReactElement {
  return el('p', {
    style: { fontSize: '12px', color: B.textMuted, marginTop: '16px', lineHeight: '1.5' }
  },
    'Or copy and paste this link into your browser: ',
    el('span', { style: { color: B.green, wordBreak: 'break-all' } }, href)
  );
}

function OtpCode(otp: string): ReactElement {
  return el('div', {
    style: {
      backgroundColor: B.cream,
      border: `2px dashed ${B.border}`,
      borderRadius: '12px',
      padding: '20px',
      margin: '24px 0',
      textAlign: 'center'
    }
  },
    el('p', {
      style: {
        margin: '0 0 4px',
        fontSize: '12px',
        color: B.textMuted,
        fontWeight: 600,
        letterSpacing: '1px',
        textTransform: 'uppercase'
      }
    }, 'Your verification code'),
    el('p', {
      style: {
        margin: 0,
        fontSize: '42px',
        fontWeight: 800,
        color: B.green,
        letterSpacing: '10px',
        fontFamily: "'Courier New', monospace"
      }
    }, otp)
  );
}

function SecurityNote(message: string): ReactElement {
  return el('p', {
    style: {
      fontSize: '12px',
      color: B.textMuted,
      backgroundColor: B.warningBg,
      border: `1px solid ${B.warningBorder}`,
      borderRadius: '8px',
      padding: '10px 14px',
      margin: '8px 0 0',
      lineHeight: '1.5'
    }
  }, `🔒 ${message}`);
}

// ─── Customer-facing templates ────────────────────────────────────────────────

export function OrderConfirmedEmail(orderId: string): ReactElement {
  return Wrapper(
    StatusBadge('Order Confirmed', B.successGreen, B.successBg),
    Heading('Your order is confirmed!'),
    Body(`Great news! We've received your order and our team is getting it ready for dispatch. You'll receive another email when your items are on their way.`),
    InfoBox(
      el('table', { width: '100%', cellPadding: 0, cellSpacing: 0 },
        el('tbody', null,
          InfoRow('Order ID', orderId),
          InfoRow('Status', 'Confirmed — preparing for dispatch'),
          InfoRow('Next Step', 'You will be notified when your order ships')
        )
      ),
      B.successBg, B.successBorder
    ),
    el('p', { style: { fontSize: '13px', color: B.textMuted, margin: '24px 0 0', lineHeight: '1.6' } },
      'Questions about your order? Reply to this email or visit your account dashboard to track progress.'
    )
  );
}

export function PaymentFailedEmail(orderId: string): ReactElement {
  return Wrapper(
    StatusBadge('Payment Failed', B.errorRed, B.errorBg),
    Heading('We couldn\'t process your payment'),
    Body(`Your payment for order ${orderId} was not successful. This can happen due to insufficient funds, incorrect card details, or a temporary issue with your bank. Please retry from your order page.`),
    InfoBox(
      el('table', { width: '100%', cellPadding: 0, cellSpacing: 0 },
        el('tbody', null,
          InfoRow('Order ID', orderId),
          InfoRow('Status', 'Payment failed — action required'),
          InfoRow('Action', 'Retry payment from your account orders page')
        )
      ),
      B.errorBg, B.errorBorder
    ),
    el('p', {
      style: { fontSize: '13px', color: B.textMuted, margin: '24px 0 0', lineHeight: '1.6' }
    }, 'If this issue persists after retrying, please contact your bank or reach out to our support team. Your items are held for a short period while payment is pending.')
  );
}

export function OrderShippedEmail(
  orderId: string,
  options?: { trackingUrl?: string; awb?: string; estimatedDays?: number }
): ReactElement {
  const deliveryNote = options?.estimatedDays != null
    ? `Estimated delivery in ${options.estimatedDays} day${options.estimatedDays === 1 ? '' : 's'}.`
    : '';
  return Wrapper(
    StatusBadge('Shipped', B.infoBlue, B.infoBlueBg),
    Heading('Your order is on its way!'),
    Body(`Your order ${orderId} has been handed over to our delivery partner and is now in transit.${deliveryNote ? ` ${deliveryNote}` : ''}`),
    InfoBox(
      el('table', { width: '100%', cellPadding: 0, cellSpacing: 0 },
        el('tbody', null,
          InfoRow('Order ID', orderId),
          InfoRow('Status', 'Shipped — in transit'),
          ...(options?.awb ? [InfoRow('AWB / Tracking No.', options.awb)] : []),
          ...(options?.estimatedDays != null ? [InfoRow('Estimated Delivery', `${options.estimatedDays} day${options.estimatedDays === 1 ? '' : 's'}`)] : []),
          InfoRow('Tracking', options?.trackingUrl ? options.trackingUrl : 'Available in your account under Order Details')
        )
      )
    ),
    ...(options?.trackingUrl
      ? [PrimaryButton('Track Your Order', options.trackingUrl)]
      : []),
    el('p', {
      style: { fontSize: '13px', color: B.textMuted, margin: '24px 0 0', lineHeight: '1.6' }
    }, 'Please ensure someone is available to receive the package at the delivery address. For any delivery concerns, contact our support team.')
  );
}

export function OutForDeliveryEmail(orderId: string): ReactElement {
  return Wrapper(
    StatusBadge('Out for Delivery', B.warningAmber, B.warningBg),
    Heading('Your order is almost there!'),
    Body(`Great news — your order ${orderId} is out for delivery today! Our delivery partner will attempt delivery at your registered address. Please keep your phone reachable for delivery assistance.`),
    InfoBox(
      el('table', { width: '100%', cellPadding: 0, cellSpacing: 0 },
        el('tbody', null,
          InfoRow('Order ID', orderId),
          InfoRow('Status', 'Out for delivery'),
          InfoRow('Tip', 'Keep your phone on and door accessible')
        )
      ),
      B.warningBg, B.warningBorder
    ),
    el('p', {
      style: { fontSize: '13px', color: B.textMuted, margin: '24px 0 0', lineHeight: '1.6' }
    }, 'If you\'re unavailable during delivery, the courier may attempt redelivery or leave a delivery notice. Contact our support team if you need to reschedule.')
  );
}

export function OrderDeliveredEmail(orderId: string): ReactElement {
  return Wrapper(
    StatusBadge('Delivered', B.successGreen, B.successBg),
    Heading('Your order has been delivered!'),
    Body(`Your order ${orderId} has been successfully delivered. We hope you love your Raghava Organics products!`),
    InfoBox(
      el('table', { width: '100%', cellPadding: 0, cellSpacing: 0 },
        el('tbody', null,
          InfoRow('Order ID', orderId),
          InfoRow('Status', 'Delivered'),
          InfoRow('Next Step', 'Enjoy your products!')
        )
      ),
      B.successBg, B.successBorder
    ),
    Divider(),
    el('p', {
      style: { fontSize: '14px', color: B.textSecondary, margin: '0 0 8px', fontWeight: 600 }
    }, 'How was your experience?'),
    el('p', {
      style: { fontSize: '13px', color: B.textMuted, margin: '0', lineHeight: '1.6' }
    }, 'Your feedback helps us improve. Log in to your account to leave a review for the items you received. We\'d love to hear from you!'),
    el('p', {
      style: { fontSize: '13px', color: B.textMuted, margin: '16px 0 0', lineHeight: '1.6' }
    }, 'Didn\'t receive your order? Please contact our support team immediately so we can resolve this for you.')
  );
}

export function OrderCancelledEmail(orderId: string): ReactElement {
  return Wrapper(
    StatusBadge('Order Cancelled', B.textMuted, '#f5f5f5'),
    Heading('Your order has been cancelled'),
    Body(`Your order ${orderId} has been cancelled as requested or due to a processing constraint. If a payment was made, your refund will be processed within 5–7 business days to your original payment method.`),
    InfoBox(
      el('table', { width: '100%', cellPadding: 0, cellSpacing: 0 },
        el('tbody', null,
          InfoRow('Order ID', orderId),
          InfoRow('Status', 'Cancelled'),
          InfoRow('Refund', 'Will be processed within 5–7 business days if applicable')
        )
      )
    ),
    el('p', {
      style: { fontSize: '13px', color: B.textMuted, margin: '24px 0 0', lineHeight: '1.6' }
    }, 'If you didn\'t request this cancellation or have questions, please contact our support team. We\'re here to help.')
  );
}

/** Human copy per return-request status for the customer decision email. */
const RETURN_STATUS_COPY: Record<string, { badge: string; heading: string; body: string }> = {
  APPROVED: {
    badge: 'Return Approved',
    heading: 'Your return request has been approved',
    body: 'We have approved your return request. Our team will coordinate the pickup of your items — please keep them ready in their original packaging.'
  },
  REJECTED: {
    badge: 'Return Declined',
    heading: 'Your return request could not be approved',
    body: 'After reviewing your return request, we are unable to approve it this time. If you believe this is a mistake, please reply to this email or contact our support team.'
  },
  PICKED_UP: {
    badge: 'Items Picked Up',
    heading: 'Your return items have been picked up',
    body: 'The courier has collected your return items. Once they are received and checked, your refund will be initiated.'
  },
  REFUNDED: {
    badge: 'Refund Processed',
    heading: 'Your refund has been processed',
    body: 'Your refund for the returned items has been processed. Depending on your bank, it may take 5–7 business days to reflect in your account.'
  }
};

export function ReturnRequestUpdateEmail(orderId: string, status: string, note?: string): ReactElement {
  const copy = RETURN_STATUS_COPY[status] ?? {
    badge: 'Return Update',
    heading: 'There is an update on your return request',
    body: `Your return request status is now ${status}.`
  };
  return Wrapper(
    StatusBadge(copy.badge, status === 'REJECTED' ? B.errorRed : B.successGreen, status === 'REJECTED' ? '#fdecea' : B.successBg),
    Heading(copy.heading),
    Body(copy.body),
    InfoBox(
      el('table', { width: '100%', cellPadding: 0, cellSpacing: 0 },
        el('tbody', null,
          InfoRow('Order ID', orderId),
          InfoRow('Return Status', copy.badge),
          ...(note ? [InfoRow('Note from the store', note)] : [])
        )
      )
    ),
    el('p', {
      style: { fontSize: '13px', color: B.textMuted, margin: '24px 0 0', lineHeight: '1.6' }
    }, 'You can review the full details of this order and your return request from the Orders section of your account.')
  );
}

export function LowStockAlertEmail(items: Array<{ sku: string; quantity: number; lowStockThreshold: number }>): ReactElement {
  const rows = items.map((item) =>
    el('tr', null,
      el('td', {
        style: { padding: '10px 16px', fontSize: '13px', color: B.textPrimary, borderBottom: `1px solid ${B.border}`, fontFamily: "'Courier New', monospace", fontWeight: 600 }
      }, item.sku),
      el('td', {
        style: { padding: '10px 16px', fontSize: '13px', textAlign: 'right', borderBottom: `1px solid ${B.border}` }
      },
        el('span', {
          style: {
            color: item.quantity <= 2 ? B.errorRed : B.warningAmber,
            fontWeight: 700
          }
        }, String(item.quantity))
      ),
      el('td', {
        style: { padding: '10px 16px', fontSize: '13px', color: B.textMuted, textAlign: 'right', borderBottom: `1px solid ${B.border}` }
      }, String(item.lowStockThreshold))
    )
  );

  return Wrapper(
    StatusBadge('Inventory Alert', B.warningAmber, B.warningBg),
    Heading('Low stock alert'),
    Body(`The following product variants have fallen below their low stock threshold. Please review inventory levels and restock as needed to avoid stockouts.`),
    el('table', {
      width: '100%', cellPadding: 0, cellSpacing: 0,
      style: { borderRadius: '10px', overflow: 'hidden', border: `1px solid ${B.border}`, margin: '16px 0' }
    },
      el('thead', null,
        el('tr', { style: { backgroundColor: B.green } },
          el('th', { style: { padding: '10px 16px', fontSize: '12px', color: B.white, textAlign: 'left', fontWeight: 600, letterSpacing: '0.5px', textTransform: 'uppercase' } }, 'SKU'),
          el('th', { style: { padding: '10px 16px', fontSize: '12px', color: B.white, textAlign: 'right', fontWeight: 600, letterSpacing: '0.5px', textTransform: 'uppercase' } }, 'In Stock'),
          el('th', { style: { padding: '10px 16px', fontSize: '12px', color: B.white, textAlign: 'right', fontWeight: 600, letterSpacing: '0.5px', textTransform: 'uppercase' } }, 'Threshold')
        )
      ),
      el('tbody', null, ...(rows.length > 0 ? rows : [
        el('tr', null,
          el('td', { colSpan: 3, style: { padding: '16px', textAlign: 'center', color: B.textMuted, fontSize: '13px' } }, 'No specific items flagged — please review inventory levels.')
        )
      ]))
    ),
    el('p', {
      style: { fontSize: '13px', color: B.textMuted, margin: '8px 0 0', lineHeight: '1.6' }
    }, 'Log in to the admin dashboard to update stock levels or place a restock order.')
  );
}

// ─── Auth & security templates ────────────────────────────────────────────────

export function OtpVerificationEmail(otp: string): ReactElement {
  return Wrapper(
    StatusBadge('Security Code', B.green, '#e8f0ef'),
    Heading('Your admin login code'),
    Body('Use the code below to complete your sign-in. This code is valid for 10 minutes and can only be used once.'),
    OtpCode(otp),
    SecurityNote('Never share this code with anyone. The Raghava Organics team will never ask you for your login code. If you did not request this, secure your account immediately.'),
    Divider(),
    el('p', { style: { fontSize: '12px', color: B.textMuted, margin: 0, lineHeight: '1.6' } },
      'This is an automated security message. If you did not attempt to log in, please contact the platform operator immediately.'
    )
  );
}

export function CustomerOtpVerificationEmail(otp: string, storeName: string): ReactElement {
  return Wrapper(
    StatusBadge(`Sign-in code for ${storeName}`, B.green, '#e8f0ef'),
    Heading(`Welcome back to ${storeName}!`),
    Body(`Use the one-time code below to complete your sign-in. The code expires in 5 minutes.`),
    OtpCode(otp),
    SecurityNote(`${storeName} will never ask you for it. Do not share this code with anyone — not even with our support team. If you didn't request this code, you can safely ignore this email.`),
    Divider(),
    el('p', { style: { fontSize: '12px', color: B.textMuted, margin: 0, lineHeight: '1.6' } },
      `This sign-in code was requested for a ${storeName} account. If this wasn't you, no action is needed — the code will expire automatically.`
    )
  );
}

export function PasswordResetEmail(email: string, resetUrl: string): ReactElement {
  return Wrapper(
    StatusBadge('Password Reset', B.warningAmber, B.warningBg),
    Heading('Reset your password'),
    Body(`We received a request to reset the password for the account associated with ${email}. Click the button below to set a new password. This link expires in 1 hour.`),
    PrimaryButton('Reset My Password', resetUrl),
    FallbackLink(resetUrl),
    Divider(),
    SecurityNote('If you did not request a password reset, you can safely ignore this email. Your password will not change unless you click the link above and complete the reset. For security, this link expires in 1 hour.')
  );
}

// ─── Admin & ops invite templates ─────────────────────────────────────────────

export function AdminInviteSetupEmail(email: string, setupUrl: string, expiresAt: string): ReactElement {
  return Wrapper(
    StatusBadge('Admin Invite', B.green, '#e8f0ef'),
    Heading('Merchant admin setup invite'),
    Body(`You have been invited to set up a merchant admin account for Raghava Organics. Click the button below to create your account and set your password.`),
    InfoBox(
      el('table', { width: '100%', cellPadding: 0, cellSpacing: 0 },
        el('tbody', null,
          InfoRow('Account email', email),
          InfoRow('Role', 'Merchant Admin'),
          InfoRow('Expires', expiresAt)
        )
      )
    ),
    PrimaryButton('Set Up My Admin Account', setupUrl),
    FallbackLink(setupUrl),
    Divider(),
    SecurityNote('This invite link is single-use and expires. If you did not expect this invite, disregard this email. Do not share this link with anyone.')
  );
}

export function OpsInviteSetupEmail(email: string, setupUrl: string, expiresAt: string): ReactElement {
  return Wrapper(
    StatusBadge('Ops Invite', B.green, '#e8f0ef'),
    Heading('Ops account setup invite'),
    Body(`A secure operations-level setup invite has been issued for this email address. This account grants elevated platform access. Complete setup using the button below.`),
    InfoBox(
      el('table', { width: '100%', cellPadding: 0, cellSpacing: 0 },
        el('tbody', null,
          InfoRow('Account email', email),
          InfoRow('Role', 'Ops User'),
          InfoRow('Expires', expiresAt)
        )
      )
    ),
    PrimaryButton('Set Up Ops Account', setupUrl),
    FallbackLink(setupUrl),
    Divider(),
    SecurityNote('This is a privileged invite. If you did not request this, contact the platform operator immediately. Do not share this link with anyone.')
  );
}

export function OpsActionOtpEmail(action: string, code: string, expiresAt: string): ReactElement {
  return Wrapper(
    StatusBadge('Action Authorization', B.errorRed, B.errorBg),
    Heading('Ops action verification code'),
    Body(`A one-time authorization code is required to proceed with the following ops action. Enter this code in the Ops Console to confirm.`),
    InfoBox(
      el('table', { width: '100%', cellPadding: 0, cellSpacing: 0 },
        el('tbody', null,
          InfoRow('Action', action),
          InfoRow('Expires', expiresAt)
        )
      ),
      B.errorBg, B.errorBorder
    ),
    OtpCode(code),
    SecurityNote('This code authorizes a sensitive operations action. Do not share it with anyone. If you did not initiate this action, deny the request immediately and audit recent ops activity.')
  );
}

// ─── System / technical alert templates ──────────────────────────────────────

export function NotificationDeliveryFailureEmail(args: {
  template: string;
  channel: string;
  recipient: string;
  errorMessage: string;
  domain?: string;
  component?: string;
  failureStage?: string;
  queueName?: string;
  jobName?: string;
  jobId?: string;
  outboxMessageId?: string;
  route?: string;
  method?: string;
  statusCode?: string;
  terminalFailure?: string;
  clientName?: string;
  websiteUrl?: string;
}): ReactElement {
  const isTerminal = args.terminalFailure === 'true';
  const badgeColor = isTerminal ? B.errorRed : B.warningAmber;
  const badgeBg = isTerminal ? B.errorBg : B.warningBg;

  return Wrapper(
    StatusBadge(isTerminal ? 'Terminal Failure' : 'Delivery Failure', badgeColor, badgeBg),
    Heading('Technical Failure Alert'),
    el('p', {
      style: { margin: '0 0 24px', fontSize: '15px', color: B.textSecondary, lineHeight: '1.65' }
    },
      `A notification delivery failure has been detected for client `,
      el('strong', null, args.clientName ?? 'Unknown Client'),
      `. Full details are listed below.`
    ),
    el('table', {
      width: '100%', cellPadding: 0, cellSpacing: 0,
      style: { borderRadius: '10px', border: `1px solid ${B.border}`, overflow: 'hidden', marginBottom: '24px' }
    },
      el('thead', null,
        el('tr', { style: { backgroundColor: isTerminal ? B.errorRed : B.green } },
          el('th', { colSpan: 2, style: { padding: '10px 16px', fontSize: '11px', color: B.white, textAlign: 'left', fontWeight: 700, letterSpacing: '0.8px', textTransform: 'uppercase' } }, 'Failure Details')
        )
      ),
      el('tbody', null,
        InfoRow('Client', `${args.clientName ?? 'Unknown'} (${args.websiteUrl ?? 'n/a'})`),
        InfoRow('Template', args.template),
        InfoRow('Channel', args.channel),
        InfoRow('Recipient', args.recipient),
        InfoRow('Stage', args.failureStage ?? 'UNKNOWN'),
        InfoRow('Domain', args.domain ?? 'system'),
        InfoRow('Component', args.component ?? 'unknown'),
        InfoRow('Error', args.errorMessage),
        InfoRow('Queue', args.queueName ?? 'unknown'),
        InfoRow('Job', `${args.jobName ?? 'unknown'} (${args.jobId ?? 'unknown'})`),
        InfoRow('Outbox ID', args.outboxMessageId ?? 'n/a'),
        InfoRow('Route', `${args.method ?? 'n/a'} ${args.route ?? 'n/a'}`),
        InfoRow('Status Code', args.statusCode ?? 'n/a'),
        InfoRow('Terminal', args.terminalFailure ?? 'false')
      )
    ),
    el('p', {
      style: { fontSize: '13px', color: B.textMuted, margin: 0, lineHeight: '1.6' }
    }, isTerminal
      ? 'This is a terminal failure. The job has been moved to the dead-letter queue. Review and retry via the Bull Board UI in the Ops Console.'
      : 'This failure may self-resolve on retry. If it persists, check the Ops Console for job details and logs.'
    )
  );
}

export function ProcessRestartAlertEmail(args: {
  requestedBy: string;
  scheduledFor: string;
  jobId: string;
  clientName?: string;
  websiteUrl?: string;
}): ReactElement {
  return Wrapper(
    StatusBadge('Action Required', B.errorRed, B.errorBg),
    Heading('Process Restart Alert — Action Required If Server Stalls'),
    el('p', {
      style: { margin: '0 0 24px', fontSize: '15px', color: B.textSecondary, lineHeight: '1.65', fontWeight: 600 }
    }, `A scheduled process restart has been triggered for ${args.clientName ?? 'Unknown Client'}. The server process is about to exit.`),
    InfoBox(
      el('table', { width: '100%', cellPadding: 0, cellSpacing: 0 },
        el('tbody', null,
          InfoRow('Client', `${args.clientName ?? 'Unknown'} (${args.websiteUrl ?? 'n/a'})`),
          InfoRow('Requested by', args.requestedBy),
          InfoRow('Scheduled for', args.scheduledFor),
          InfoRow('Job ID', args.jobId)
        )
      ),
      B.errorBg, B.errorBorder
    ),
    Divider(),
    el('p', {
      style: { fontSize: '14px', color: B.textPrimary, fontWeight: 700, margin: '0 0 8px' }
    }, 'What to expect:'),
    el('p', {
      style: { fontSize: '13px', color: B.textSecondary, margin: '0 0 8px', lineHeight: '1.6' }
    }, '1. PM2 / Docker will automatically restart the process. This usually completes within 30–60 seconds.'),
    el('p', {
      style: { fontSize: '13px', color: B.textSecondary, margin: '0 0 16px', lineHeight: '1.6' }
    }, '2. If the server does not come back online within 2–3 minutes, manual intervention is required. Check PM2 logs or Docker container status immediately.'),
    SecurityNote('If you did not authorize this restart, investigate immediately. Check the Ops Console audit log for details.')
  );
}

// ─── Merchant/admin-facing templates ─────────────────────────────────────────

/** Sent to admins who opted in to per-admin new-order notifications. */
export function AdminNewOrderEmail(input: {
  orderRef: string;
  customerName: string;
  amount: string;
  paymentMode: string;
}): ReactElement {
  return Wrapper(
    StatusBadge('New Order', B.successGreen, B.successBg),
    Heading('A new order just came in!'),
    Body(`${input.customerName} placed order ${input.orderRef}. Open the admin panel to review and process it.`),
    InfoBox(
      el('table', { width: '100%', cellPadding: 0, cellSpacing: 0 },
        el('tbody', null,
          InfoRow('Order ID', input.orderRef),
          InfoRow('Customer', input.customerName),
          InfoRow('Amount', input.amount),
          InfoRow('Payment', input.paymentMode)
        )
      ),
      B.successBg, B.successBorder
    ),
    el('p', { style: { fontSize: '13px', color: B.textMuted, margin: '24px 0 0', lineHeight: '1.6' } },
      'You are receiving this because you enabled new-order notifications in Admin → Settings → Notifications. You can opt out there at any time.'
    )
  );
}

/**
 * Sent to opted-in admins when a LOCAL DELIVERY order is placed (whitelisted pincode —
 * the merchant delivers it himself; no courier is booked). Includes the full delivery
 * address + phone because the admin is the courier for this order.
 */
export function AdminLocalOrderEmail(input: {
  orderRef: string;
  customerName: string;
  amount: string;
  paymentMode: string;
  deliveryAddress: string;
  customerPhone: string;
}): ReactElement {
  return Wrapper(
    StatusBadge('Local Delivery Order', B.successGreen, B.successBg),
    Heading('New local delivery order — you deliver this one!'),
    Body(
      `${input.customerName} placed order ${input.orderRef} from a whitelisted local pincode. ` +
        'No courier will be booked — deliver it directly and update the order status from the admin panel.'
    ),
    InfoBox(
      el('table', { width: '100%', cellPadding: 0, cellSpacing: 0 },
        el('tbody', null,
          InfoRow('Order ID', input.orderRef),
          InfoRow('Customer', input.customerName),
          InfoRow('Phone', input.customerPhone || 'n/a'),
          InfoRow('Deliver to', input.deliveryAddress || 'see admin panel'),
          InfoRow('Amount', input.amount),
          InfoRow('Payment', input.paymentMode)
        )
      ),
      B.successBg, B.successBorder
    ),
    el('p', { style: { fontSize: '13px', color: B.textMuted, margin: '24px 0 0', lineHeight: '1.6' } },
      'You are receiving this because you enabled new-order notifications in Admin → Settings → Notifications. You can opt out there at any time.'
    )
  );
}
