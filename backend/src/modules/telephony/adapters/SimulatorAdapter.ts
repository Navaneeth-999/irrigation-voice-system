import { ITelephonyAdapter, OutboundCallRequest, OutboundCallResult } from './ITelephonyAdapter.js';
import { StepAction, TelephonyProvider } from '../types.js';

export class SimulatorAdapter implements ITelephonyAdapter {
  providerName: TelephonyProvider = 'simulator';

  async initiateCall(request: OutboundCallRequest): Promise<OutboundCallResult> {
    const callSid = `sim-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    return {
      callSid,
      status: 'in_progress',
      provider: 'simulator',
    };
  }

  generateResponse(action: StepAction, _callbackUrl: string): Record<string, any> {
    return {
      type: action.type,
      promptCode: action.promptCode,
      teluguText: action.teluguText,
      englishText: action.englishText,
      expectedInputType: action.expectedInputType,
      validDigits: action.validDigits,
      minDigits: action.minDigits,
      maxDigits: action.maxDigits,
      finishOnKey: action.finishOnKey,
      timeoutSeconds: action.timeoutSeconds,
      state: action.state,
    };
  }

  verifySignature(_req: any): boolean {
    return true;
  }
}
