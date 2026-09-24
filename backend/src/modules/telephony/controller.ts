import { Request, Response } from 'express';
import { z } from 'zod';
import { TelephonyService } from './service.js';
import { db } from '../../db/index.js';

export class TelephonyController {
  /**
   * Start an interactive simulator call
   */
  static async startSimulatorCall(req: Request, res: Response): Promise<void> {
    const schema = z.object({
      seasonId: z.string().uuid().optional(),
      farmerId: z.string().uuid().optional(),
      scheduleId: z.string().uuid().optional(),
      phoneE164: z.string().optional().default('+919876543210'),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'INVALID_REQUEST', details: parsed.error.format() });
      return;
    }

    const sessionId = `sim-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const result = await TelephonyService.startSession({
      sessionId,
      phoneE164: parsed.data.phoneE164,
      provider: 'simulator',
      callScheduleId: parsed.data.scheduleId,
      seasonId: parsed.data.seasonId,
      farmerId: parsed.data.farmerId,
    });

    res.json({
      sessionId,
      action: result.action,
      state: result.state,
    });
  }

  /**
   * Process DTMF input from simulator keypad
   */
  static async simulatorDtmf(req: Request, res: Response): Promise<void> {
    const schema = z.object({
      sessionId: z.string().min(1),
      digits: z.string().min(1),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'INVALID_REQUEST', details: parsed.error.format() });
      return;
    }

    try {
      const action = await TelephonyService.handleInput(
        parsed.data.sessionId,
        parsed.data.digits
      );
      res.json({ action });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }

  /**
   * Simulator timeout event
   */
  static async simulatorTimeout(req: Request, res: Response): Promise<void> {
    const schema = z.object({
      sessionId: z.string().min(1),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'INVALID_REQUEST', details: parsed.error.format() });
      return;
    }

    try {
      const action = await TelephonyService.handleTimeout(parsed.data.sessionId);
      res.json({ action });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }

  /**
   * Inbound webhook from Twilio Voice
   */
  static async handleTwilioVoice(req: Request, res: Response): Promise<void> {
    const twilioAdapter = TelephonyService.getAdapter('twilio');

    // Signature verification (bypassed only in test mode)
    if (!twilioAdapter.verifySignature(req)) {
      res.status(403).send('Forbidden: Invalid Twilio Signature');
      return;
    }

    const callSid = req.body.CallSid || (req.query.CallSid as string);
    const digits = req.body.Digits;
    const isTimeout = req.query.timeout === 'true';
    const scheduleId = (req.query.scheduleId as string) || undefined;
    const fromPhone = req.body.From || '+910000000000';

    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const callbackUrl = `${baseUrl}/api/v1/webhooks/twilio/voice?scheduleId=${scheduleId || ''}`;

    try {
      let action;

      if (!digits && !isTimeout) {
        // Initial call greeting
        const session = await TelephonyService.startSession({
          sessionId: callSid,
          phoneE164: fromPhone,
          provider: 'twilio',
          callScheduleId: scheduleId,
        });
        action = session.action;
      } else if (isTimeout) {
        action = await TelephonyService.handleTimeout(callSid);
      } else {
        action = await TelephonyService.handleInput(callSid, digits);
      }

      const twiml = twilioAdapter.generateResponse(action, callbackUrl);
      res.setHeader('Content-Type', 'text/xml');
      res.send(twiml);
    } catch (err: any) {
      console.error('Twilio Voice Webhook Error:', err);
      res.status(500).send(`<?xml version="1.0" encoding="UTF-8"?><Response><Say language="en-IN">An error occurred. Please try again later.</Say><Hangup/></Response>`);
    }
  }

  /**
   * Twilio Status Callback webhook
   */
  static async handleTwilioStatus(req: Request, res: Response): Promise<void> {
    const callSid = req.body.CallSid;
    const callStatus = req.body.CallStatus;

    if (callSid) {
      // Record webhook event for idempotency
      const { isDuplicate } = await TelephonyService.recordWebhookEvent(
        'twilio',
        `${callSid}-${callStatus}`,
        'call_status',
        req.body
      );

      if (!isDuplicate && ['busy', 'no-answer', 'failed', 'canceled'].includes(callStatus)) {
        await db.query(
          `UPDATE call_attempts SET status = $1, ended_at = NOW() WHERE provider_call_sid = $2`,
          [callStatus === 'no-answer' ? 'no_answer' : callStatus, callSid]
        );
      }
    }

    res.status(200).send('OK');
  }

  /**
   * Trigger processing of due call schedule
   */
  static async processDueQueue(req: Request, res: Response): Promise<void> {
    const limit = parseInt(req.query.limit as string, 10) || 10;
    const provider = (req.query.provider as any) || 'simulator';

    const result = await TelephonyService.processDueCallSchedule({
      limit,
      provider,
      callbackBaseUrl: `${req.protocol}://${req.get('host')}`,
    });

    res.json(result);
  }

  /**
   * List scheduled calls
   */
  static async listSchedules(req: Request, res: Response): Promise<void> {
    const seasonId = req.query.seasonId as string;
    const status = req.query.status as string;

    let query = `
      SELECT cs.*, f.name as farmer_name, f.village_id, v.name as village_name,
             c.crop_name, s.season_code
      FROM call_schedule cs
      JOIN seasons s ON cs.season_id = s.id
      JOIN crops c ON s.crop_id = c.id
      JOIN farmers f ON cs.farmer_id = f.id
      JOIN villages v ON f.village_id = v.id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (seasonId) {
      params.push(seasonId);
      query += ` AND cs.season_id = $${params.length}`;
    }

    if (status) {
      params.push(status);
      query += ` AND cs.status = $${params.length}`;
    }

    query += ` ORDER BY cs.scheduled_date ASC, cs.cycle_number ASC`;

    const resDb = await db.query(query, params);
    res.json(resDb.rows);
  }

  /**
   * List audio prompts with review status
   */
  static async listPrompts(_req: Request, res: Response): Promise<void> {
    const resDb = await db.query(`
      SELECT ap.*, q.step_number, q.code as question_code, u.name as reviewer_name
      FROM audio_prompts ap
      LEFT JOIN call_questions q ON ap.question_id = q.id
      LEFT JOIN users u ON ap.reviewed_by = u.id
      ORDER BY q.step_number ASC NULLS LAST, ap.prompt_code ASC
    `);
    res.json(resDb.rows);
  }

  /**
   * Review an audio prompt (Approve / Reject)
   */
  static async reviewPrompt(req: Request, res: Response): Promise<void> {
    const promptCode = req.params.promptCode as string;
    const schema = z.object({
      status: z.enum(['draft', 'recorded', 'reviewed_agronomist', 'approved', 'rejected']),
      notes: z.string().optional(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'INVALID_REQUEST', details: parsed.error.format() });
      return;
    }

    const userId = (req as any).user?.id || null;

    try {
      const updated = await TelephonyService.reviewAudioPrompt(
        promptCode,
        parsed.data.status,
        userId,
        parsed.data.notes
      );
      res.json(updated);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }
}
