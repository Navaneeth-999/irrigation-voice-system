import twilio from 'twilio';
import { ISmsAdapter } from './ISmsAdapter.js';

export class TwilioSmsAdapter implements ISmsAdapter {
  providerName: 'twilio_sms' = 'twilio_sms';
  private client: twilio.Twilio | null = null;
  private fromNumber: string;

  constructor() {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    this.fromNumber = process.env.TWILIO_PHONE_NUMBER || '';

    if (accountSid && authToken && this.fromNumber) {
      this.client = twilio(accountSid, authToken);
    }
  }

  async sendSms(to: string, message: string): Promise<{ success: boolean; messageId?: string; error?: string }> {
    if (!this.client || !this.fromNumber) {
      return { success: false, error: 'TWILIO_NOT_CONFIGURED' };
    }

    try {
      const response = await this.client.messages.create({
        to,
        from: this.fromNumber,
        body: message,
      });

      return {
        success: true,
        messageId: response.sid,
      };
    } catch (err: any) {
      return {
        success: false,
        error: err.message || 'TWILIO_SMS_DISPATCH_FAILED',
      };
    }
  }
}
