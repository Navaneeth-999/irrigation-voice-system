import twilio from 'twilio';
import { ITelephonyAdapter, OutboundCallRequest, OutboundCallResult } from './ITelephonyAdapter.js';
import { StepAction, TelephonyProvider } from '../types.js';
import { db } from '../../../db/index.js';

export class TwilioAdapter implements ITelephonyAdapter {
  providerName: TelephonyProvider = 'twilio';
  private client: twilio.Twilio | null = null;
  private accountSid: string;
  private authToken: string;
  private fromNumber: string;

  constructor() {
    this.accountSid = process.env.TWILIO_ACCOUNT_SID || '';
    this.authToken = process.env.TWILIO_AUTH_TOKEN || '';
    this.fromNumber = process.env.TWILIO_PHONE_NUMBER || '';

    if (this.accountSid && this.authToken) {
      this.client = twilio(this.accountSid, this.authToken);
    }
  }

  /**
   * Regulatory Safety Gating: Check whether audio prompts have been agronomist-reviewed and approved.
   * Unless explicitly bypassed in development (ALLOW_UNREVIEWED_PROMPTS=true), unapproved prompts are rejected.
   */
  async assertApprovedPrompts(promptCodes: string[]): Promise<void> {
    const allowUnreviewed = process.env.ALLOW_UNREVIEWED_PROMPTS === 'true';
    if (allowUnreviewed) return;

    if (!promptCodes || promptCodes.length === 0) return;

    const placeholders = promptCodes.map((_, i) => `$${i + 1}`).join(',');
    const res = await db.query(
      `SELECT prompt_code, review_status FROM audio_prompts WHERE prompt_code IN (${placeholders})`,
      promptCodes
    );

    const statusMap = new Map<string, string>();
    for (const r of res.rows) {
      statusMap.set(r.prompt_code, r.review_status);
    }

    for (const code of promptCodes) {
      const status = statusMap.get(code);
      if (!status || status !== 'approved') {
        throw new Error(
          `AUDIO_PROMPT_NOT_APPROVED: Prompt '${code}' has status '${status || 'missing'}'. Real calls require 'approved' status.`
        );
      }
    }
  }

  async initiateCall(request: OutboundCallRequest): Promise<OutboundCallResult> {
    if (!this.client || !this.accountSid || !this.authToken) {
      throw new Error('TWILIO_NOT_CONFIGURED: Missing Twilio credentials.');
    }

    // Safety Gating Check on Intro prompt
    await this.assertApprovedPrompts(['prompt_intro_te']);

    const webhookUrl = `${request.callbackBaseUrl}/api/v1/webhooks/twilio/voice?scheduleId=${request.scheduleId || ''}`;
    const statusCallback = `${request.callbackBaseUrl}/api/v1/webhooks/twilio/status?scheduleId=${request.scheduleId || ''}`;

    const from = request.from || this.fromNumber;
    if (!from) {
      throw new Error('TWILIO_FROM_NUMBER_MISSING: No Twilio caller ID provided.');
    }

    const call = await this.client.calls.create({
      from,
      to: request.to,
      url: webhookUrl,
      statusCallback,
      statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
    });

    return {
      callSid: call.sid,
      status: call.status,
      provider: 'twilio',
    };
  }

  generateResponse(action: StepAction, callbackUrl: string): string {
    const VoiceResponse = twilio.twiml.VoiceResponse;
    const response = new VoiceResponse();

    if (action.type === 'TERMINATE') {
      response.say({ language: 'te-IN' as any }, action.teluguText);
      response.hangup();
      return response.toString();
    }

    // PLAY_AND_GATHER
    const gather = response.gather({
      action: callbackUrl,
      method: 'POST',
      numDigits: action.maxDigits,
      finishOnKey: action.finishOnKey,
      timeout: action.timeoutSeconds,
    });

    gather.say({ language: 'te-IN' as any }, action.teluguText);

    // If no input gathered within timeout window, redirect to timeout handler
    response.redirect({ method: 'POST' }, `${callbackUrl}?timeout=true`);

    return response.toString();
  }

  verifySignature(req: any): boolean {
    if (process.env.NODE_ENV === 'test') {
      return true;
    }

    const signature = req.headers['x-twilio-signature'] as string;
    if (!signature) {
      return false;
    }

    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.headers['x-forwarded-host'] || req.get('host');
    const fullUrl = `${protocol}://${host}${req.originalUrl}`;

    return twilio.validateRequest(
      this.authToken,
      signature,
      fullUrl,
      req.body || {}
    );
  }
}
