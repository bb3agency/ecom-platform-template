export type SendEmailInput = {
  to: string;
  template: string;
  data: Record<string, unknown>;
};

export type SendSmsInput = {
  phone: string;
  template: string;
  data: Record<string, unknown>;
};

export type SendWhatsappInput = {
  phone: string;
  template: string;
  data: Record<string, unknown>;
};

export type SendResult = {
  messageId?: string;
  providerPayload: Record<string, unknown>;
};

export interface EmailProviderAdapter {
  sendEmail(input: SendEmailInput): Promise<SendResult>;
}

export interface SmsProviderAdapter {
  sendSms(input: SendSmsInput): Promise<SendResult>;
}

export interface WhatsappProviderAdapter {
  sendWhatsapp(input: SendWhatsappInput): Promise<SendResult>;
}
