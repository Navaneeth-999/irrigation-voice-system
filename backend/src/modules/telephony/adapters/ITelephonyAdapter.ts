import { StepAction, TelephonyProvider } from '../types.js';

export interface OutboundCallRequest {
  scheduleId?: string;
  seasonId?: string;
  farmerId?: string;
  to: string;
  from?: string;
  callbackBaseUrl: string;
}

export interface OutboundCallResult {
  callSid: string;
  status: string;
  provider: TelephonyProvider;
}

export interface ITelephonyAdapter {
  providerName: TelephonyProvider;

  initiateCall(request: OutboundCallRequest): Promise<OutboundCallResult>;

  generateResponse(action: StepAction, callbackUrl: string): string | Record<string, any>;

  verifySignature(req: any): boolean;
}
