import { ISmsAdapter } from './ISmsAdapter.js';

export class MockSmsAdapter implements ISmsAdapter {
  providerName: 'mock_sms' = 'mock_sms';

  async sendSms(to: string, message: string): Promise<{ success: boolean; messageId?: string; error?: string }> {
    const messageId = `mock_sms_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    // Deterministic simulation
    return {
      success: true,
      messageId,
    };
  }
}
