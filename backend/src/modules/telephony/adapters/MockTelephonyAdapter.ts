import { ITelephonyAdapter, OutboundCallRequest, OutboundCallResult } from './ITelephonyAdapter.js';
import { StepAction, TelephonyProvider } from '../types.js';

export class MockTelephonyAdapter implements ITelephonyAdapter {
  providerName: TelephonyProvider = 'mock';
  public callHistory: OutboundCallRequest[] = [];

  async initiateCall(request: OutboundCallRequest): Promise<OutboundCallResult> {
    this.callHistory.push(request);
    const callSid = `mock-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    return {
      callSid,
      status: 'initiated',
      provider: 'mock',
    };
  }

  generateResponse(action: StepAction, _callbackUrl: string): Record<string, any> {
    return {
      type: action.type,
      promptCode: action.promptCode,
      teluguText: action.teluguText,
      englishText: action.englishText,
      state: action.state,
    };
  }

  verifySignature(_req: any): boolean {
    return true;
  }
}
