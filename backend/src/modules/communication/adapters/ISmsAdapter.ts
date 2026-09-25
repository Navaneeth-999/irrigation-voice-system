export interface ISmsAdapter {
  providerName: 'mock_sms' | 'twilio_sms';
  sendSms(to: string, message: string): Promise<{ success: boolean; messageId?: string; error?: string }>;
}
