import twilio from 'twilio';
import { ITelephonyAdapter, OutboundCallRequest, OutboundCallResult } from './ITelephonyAdapter.js';
import { StepAction, TelephonyProvider } from '../types.js';
import { db } from '../../../db/index.js';

export class TwilioAdapter implements ITelephonyAdapter {
  providerName: TelephonyProvider = 'twilio';
  private client: twilio.Twilio | null = null;
  public accountSid: string;
  public authToken: string;
  public fromNumber: string;

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
      `SELECT prompt_code, review_status, audio_url FROM audio_prompts WHERE prompt_code IN (${placeholders})`,
      promptCodes
    );

    const statusMap = new Map<string, { status: string; audioUrl?: string }>();
    for (const r of res.rows) {
      statusMap.set(r.prompt_code, { status: r.review_status, audioUrl: r.audio_url });
    }

    for (const code of promptCodes) {
      const entry = statusMap.get(code);
      if (!entry || entry.status !== 'approved') {
        throw new Error(
          `AUDIO_PROMPT_NOT_APPROVED: Prompt '${code}' has status '${entry?.status || 'missing'}'. Real calls require 'approved' status.`
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

  /**
   * Generates TwiML for an action.
   * PRODUCTION RULE: Production calls must use <Play> with approved audio;
   * <Say> is strictly a development-only fallback.
   */
  generateResponse(action: StepAction, callbackUrl: string, audioUrl?: string): string {
    const VoiceResponse = twilio.twiml.VoiceResponse;
    const response = new VoiceResponse();
    const isProduction = process.env.NODE_ENV === 'production' && process.env.ALLOW_UNREVIEWED_PROMPTS !== 'true';

    // Helper to render prompt sound (Play or Say)
    const renderPrompt = (container: any) => {
      if (audioUrl) {
        container.play(audioUrl);
      } else if (isProduction) {
        throw new Error(
          `AUDIO_PROMPT_NOT_RECORDED: Production calls require hosted audio files with <Play>. Prompt: ${action.promptCode}`
        );
      } else {
        container.say({ language: 'te-IN' as any }, action.teluguText);
      }
    };

    if (action.type === 'TERMINATE') {
      renderPrompt(response);
      response.hangup();
      return response.toString();
    }

    // Optional 30-Second Voice Recording Question
    if (action.expectedInputType === 'voice_recording') {
      renderPrompt(response);
      response.record({
        action: `${callbackUrl}&voice_recording=true`,
        maxLength: 30,
        finishOnKey: '#',
        playBeep: true,
      });
      response.redirect({ method: 'POST' }, `${callbackUrl}&timeout=true`);
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

    renderPrompt(gather);

    // If no input gathered within timeout window, redirect to timeout handler
    response.redirect({ method: 'POST' }, `${callbackUrl}&timeout=true`);

    return response.toString();
  }

  /**
   * Validates Twilio cryptographic signature against request URL and body parameters.
   */
  verifySignature(req: any): boolean {
    if (process.env.NODE_ENV === 'test' && req.headers['x-skip-signature-test'] === 'true') {
      return true;
    }

    const signature = req.headers['x-twilio-signature'] as string;
    if (!signature) {
      return false;
    }

    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.headers['x-forwarded-host'] || req.get('host');
    const fullUrl = `${protocol}://${host}${req.originalUrl}`;

    const authToken = this.authToken || process.env.TWILIO_AUTH_TOKEN || '';
    if (!authToken) return false;

    return twilio.validateRequest(
      authToken,
      signature,
      fullUrl,
      req.body || {}
    );
  }
}
