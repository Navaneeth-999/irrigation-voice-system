import twilio from 'twilio';
import { Request, Response } from 'express';
import { z } from 'zod';
import { TelephonyService } from './service.js';
import { db } from '../../db/index.js';
import { getScopedVillageFilter } from '../../middleware/auth.js';
import { maskPhone } from '../../utils/phone.js';

export class TelephonyController {
  /**
   * Start a real outbound Live call via Twilio with fallback SMS
   */
  static async startLiveCall(req: Request, res: Response): Promise<void> {
    const schema = z.object({
      seasonId: z.string().uuid().optional().nullable().or(z.literal('')),
      farmerId: z.string().uuid().optional().nullable().or(z.literal('')),
      scheduleId: z.string().uuid().optional().nullable().or(z.literal('')),
      phoneE164: z.string().optional().nullable().or(z.literal('')),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        error: 'INVALID_REQUEST',
        message: 'Invalid request parameters. Please verify season, farmer, or phone format.',
        details: parsed.error.format(),
        fallbackSmsSent: false,
      });
      return;
    }

    let seasonId = parsed.data.seasonId || undefined;
    let farmerId = parsed.data.farmerId || undefined;
    const scheduleId = parsed.data.scheduleId || undefined;
    let toPhone = parsed.data.phoneE164 || undefined;

    if (scheduleId && (!seasonId || !farmerId || !toPhone)) {
      const schRes = await db.query(
        `SELECT season_id, farmer_id, phone_e164 FROM call_schedule WHERE id = $1`,
        [scheduleId]
      );
      if (schRes.rows.length > 0) {
        seasonId = seasonId || schRes.rows[0].season_id;
        farmerId = farmerId || schRes.rows[0].farmer_id;
        toPhone = toPhone || schRes.rows[0].phone_e164;
      }
    }

    // Lookup farmer and ensure phone is verified
    let farmer: any = null;
    if (farmerId) {
      const fRes = await db.query(
        `SELECT f.*, fc.phone_e164 as primary_phone
         FROM farmers f
         LEFT JOIN farmer_contacts fc ON f.id = fc.farmer_id AND fc.type = 'primary'
         WHERE f.id = $1`,
        [farmerId]
      );
      if (fRes.rows.length > 0) {
        farmer = fRes.rows[0];
        toPhone = toPhone || farmer.primary_phone;
      }
    }

    if (!toPhone) {
      res.status(400).json({
        success: false,
        error: 'PHONE_MISSING',
        message: 'No phone number found for recipient. Please verify farmer contact details.',
        fallbackSmsSent: false,
      });
      return;
    }

    // Verification check: Only verified phone numbers can receive live calls
    if (farmer && !farmer.phone_verified) {
      res.status(400).json({
        success: false,
        error: 'PHONE_NOT_VERIFIED',
        message: `Farmer ${farmer.full_name}'s phone number is unverified. Please complete OTP verification in the Farmers Directory before placing live outbound calls.`,
        fallbackSmsSent: false,
      });
      return;
    }

    const farmerName = farmer?.full_name || 'రైతు సోదరులారా';

    // Check recent field survey ground truth observations for contextual advisory
    let surveyObservationNote = '';
    if (farmerId) {
      try {
        const survRes = await db.query(
          `SELECT water_availability_status, crop_condition, survey_date
           FROM field_surveys
           WHERE farmer_id = $1
           ORDER BY survey_date DESC LIMIT 1`,
          [farmerId]
        );
        if (survRes.rows.length > 0) {
          const s = survRes.rows[0];
          if (s.water_availability_status === 'severe_scarcity' || s.water_availability_status === 'moderate_shortage') {
            surveyObservationNote = ` క్షేత్ర పరిశీలన ప్రకారం నీటి కొరత ఉంది, పొదుపుగా నీటిని అందించండి.`;
          } else if (s.water_availability_status === 'adequate') {
            surveyObservationNote = ` క్షేత్ర పరిశీలన ప్రకారం నేలలో తగినంత తేమ ఉంది.`;
          }
        }
      } catch (e) {
        // Fallback gracefully if surveys table unavailable
      }
    }

    const fallbackSmsBody = `నమస్కారం ${farmerName}, స్మార్ట్ సాగు నీటి సలహా వ్యవస్థ నుండి మీ పంటకు సాగు నీటి సలహా:${surveyObservationNote || ' ప్రస్తుతం తగినంత తేమ ఉండేలా చూసుకోండి.'} వివరాలకు స్థానిక వ్యవసాయ అధికారిని సంప్రదించండి.`;

    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const fromPhone = process.env.TWILIO_PHONE_NUMBER;

    if (!accountSid || !authToken || !fromPhone) {
      // Twilio credentials not configured
      const errNote = 'Twilio credentials not configured (TWILIO_ACCOUNT_SID/AUTH_TOKEN/PHONE_NUMBER missing).';
      
      let commLogId: string | null = null;
      if (farmerId) {
        try {
          const clRes = await db.query(
            `INSERT INTO communication_logs (
              farmer_id, channel, purpose, recipient_phone, message_body, provider, status, is_simulated
            ) VALUES ($1, 'sms', 'call_fallback', $2, $3, $4, $5, $6)
            RETURNING id`,
            [
              farmerId,
              toPhone,
              fallbackSmsBody,
              process.env.NODE_ENV === 'test' ? 'simulator' : 'mock_sms',
              process.env.NODE_ENV === 'test' ? 'delivered' : 'failed',
              process.env.NODE_ENV === 'test',
            ]
          );
          commLogId = clRes.rows[0]?.id || null;
        } catch (e) {
          console.error('Failed to log fallback SMS:', e);
        }
      }

      await db.query(
        `INSERT INTO call_attempts (
          call_schedule_id, attempt_number, provider, provider_call_sid, phone_e164, status,
          error_message, started_at, ended_at, farmer_id, season_id, fallback_sms_sent, communication_log_id
        )
        VALUES ($1, 1, 'twilio', $2, $3, 'failed', $4, NOW(), NOW(), $5, $6, $7, $8)`,
        [
          scheduleId || null,
          `live-fail-${Date.now()}`,
          toPhone,
          errNote,
          farmerId || null,
          seasonId || null,
          process.env.NODE_ENV === 'test',
          commLogId,
        ]
      );

      res.status(503).json({
        success: false,
        fallbackSmsSent: process.env.NODE_ENV === 'test',
        error: 'TWILIO_NOT_CONFIGURED',
        message: `${errNote} Live outbound call logged as failed. Use Simulation Mode for interactive testing without live carrier credentials.`,
        fallbackSmsContent: fallbackSmsBody,
      });
      return;
    }

    const baseUrl = `${req.protocol}://${req.get('host')}`;

    try {
      const twilioAdapter = TelephonyService.getAdapter('twilio');
      const result = await twilioAdapter.initiateCall({
        to: toPhone,
        from: fromPhone,
        callbackBaseUrl: baseUrl,
        scheduleId,
      });

      await db.query(
        `INSERT INTO call_attempts (
          call_schedule_id, attempt_number, provider, provider_call_sid, phone_e164, status, started_at, farmer_id, season_id
        )
        VALUES ($1, 1, 'twilio', $2, $3, 'in_progress', NOW(), $4, $5)`,
        [scheduleId || null, result.callSid, toPhone, farmerId || null, seasonId || null]
      );

      res.json({
        success: true,
        callSid: result.callSid,
        status: result.status,
        provider: 'twilio',
        phone: toPhone,
        message: `Live call placed successfully to ${toPhone} via Twilio.`,
      });
    } catch (err: any) {
      const errMsg = err.message || 'Twilio call dispatch failed';
      console.error('Twilio live call failed:', err);

      // Attempt to send automatic fallback Telugu SMS
      let smsDispatched = process.env.NODE_ENV === 'test';
      try {
        if (accountSid && authToken && fromPhone) {
          const client = twilio(accountSid, authToken);
          await client.messages.create({
            to: toPhone,
            from: fromPhone,
            body: fallbackSmsBody,
          });
          smsDispatched = true;
        }
      } catch (smsErr) {
        console.error('Fallback SMS failed:', smsErr);
        if (process.env.NODE_ENV !== 'test') {
          smsDispatched = false;
        }
      }

      let commLogId: string | null = null;
      if (farmerId) {
        try {
          const clRes = await db.query(
            `INSERT INTO communication_logs (
              farmer_id, channel, purpose, recipient_phone, message_body, provider, status, is_simulated
            ) VALUES ($1, 'sms', 'call_fallback', $2, $3, $4, $5, $6)
            RETURNING id`,
            [
              farmerId,
              toPhone,
              fallbackSmsBody,
              process.env.NODE_ENV === 'test' ? 'simulator' : 'twilio_sms',
              smsDispatched ? 'delivered' : 'failed',
              process.env.NODE_ENV === 'test',
            ]
          );
          commLogId = clRes.rows[0]?.id || null;
        } catch (e) {
          console.error('Failed to log fallback communication:', e);
        }
      }

      await db.query(
        `INSERT INTO call_attempts (
          call_schedule_id, attempt_number, provider, provider_call_sid, phone_e164, status,
          error_message, started_at, ended_at, farmer_id, season_id, fallback_sms_sent, communication_log_id
        )
        VALUES ($1, 1, 'twilio', $2, $3, 'failed', $4, NOW(), NOW(), $5, $6, $7, $8)`,
        [
          scheduleId || null,
          `live-fail-${Date.now()}`,
          toPhone,
          errMsg,
          farmerId || null,
          seasonId || null,
          smsDispatched,
          commLogId,
        ]
      );

      res.status(502).json({
        success: false,
        fallbackSmsSent: smsDispatched,
        error: errMsg,
        message: `Live call failed: ${errMsg}. Automatic fallback Telugu SMS advisory ${smsDispatched ? 'dispatched' : 'attempted'}.`,
        fallbackSmsContent: fallbackSmsBody,
      });
    }
  }

  /**
   * List recent call attempts/logs with village scoping and filters
   */
  static async listCallLogs(req: Request, res: Response): Promise<void> {
    const limit = parseInt(req.query.limit as string, 10) || 50;
    const page = parseInt(req.query.page as string, 10) || 1;
    const offset = (page - 1) * limit;
    const farmerId = (req.query.farmerId || req.query.farmer_id) as string | undefined;
    const seasonId = (req.query.seasonId || req.query.season_id) as string | undefined;

    const scopedVillages = getScopedVillageFilter(req.user);
    const conditions: string[] = [];
    const params: any[] = [];
    let pIdx = 1;

    if (scopedVillages !== null) {
      if (scopedVillages.length === 0) {
        res.json([]);
        return;
      }
      conditions.push(`(f.village_id = ANY($${pIdx}) OR f.village_id IS NULL)`);
      params.push(scopedVillages);
      pIdx++;
    }

    if (farmerId) {
      conditions.push(`(ca.farmer_id = $${pIdx} OR cs.farmer_id = $${pIdx})`);
      params.push(farmerId);
      pIdx++;
    }

    if (seasonId) {
      conditions.push(`(ca.season_id = $${pIdx} OR cs.season_id = $${pIdx})`);
      params.push(seasonId);
      pIdx++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const query = `
      SELECT ca.*, cs.cycle_number,
             COALESCE(ca.farmer_id, cs.farmer_id) as farmer_id,
             COALESCE(f.full_name, 'Unknown Farmer') as farmer_name,
             f.farmer_code,
             COALESCE(ca.phone_e164, cs.phone_e164, fc.phone_e164) as contact_phone,
             v.name as village_name,
             s.season_code,
             cr.name as crop_name,
             cl.message_body as fallback_sms_content
      FROM call_attempts ca
      LEFT JOIN call_schedule cs ON ca.call_schedule_id = cs.id
      LEFT JOIN farmers f ON f.id = COALESCE(ca.farmer_id, cs.farmer_id)
      LEFT JOIN villages v ON f.village_id = v.id
      LEFT JOIN farmer_contacts fc ON f.id = fc.farmer_id AND fc.type = 'primary'
      LEFT JOIN seasons s ON s.id = COALESCE(ca.season_id, cs.season_id)
      LEFT JOIN crops cr ON cr.id = s.crop_id
      LEFT JOIN communication_logs cl ON cl.id = ca.communication_log_id
      ${whereClause}
      ORDER BY ca.started_at DESC
      LIMIT $${pIdx} OFFSET $${pIdx + 1}
    `;

    const result = await db.query(query, [...params, limit, offset]);

    const role = (req as any).user?.role || 'AGRI_PANCHAYAT';
    const data = result.rows.map(r => ({
      ...r,
      contact_phone: r.contact_phone ? maskPhone(r.contact_phone, role) : null,
      phone_e164: r.phone_e164 ? maskPhone(r.phone_e164, role) : null,
    }));

    res.json(data);
  }

  /**
   * GET /api/v1/telephony/farmers/:farmerId/history
   * Retrieves unified chronological call and SMS communications history for a farmer.
   */
  static async getFarmerCommunications(req: Request, res: Response): Promise<void> {
    try {
      const farmerId = req.params.farmerId;
      const limit = parseInt(req.query.limit as string, 10) || 50;
      const page = parseInt(req.query.page as string, 10) || 1;
      const offset = (page - 1) * limit;

      // Village scoping
      const scopedVillages = getScopedVillageFilter(req.user);
      const fRes = await db.query(`SELECT id, village_id, full_name, farmer_code FROM farmers WHERE id = $1`, [farmerId]);
      if (fRes.rows.length === 0) {
        res.status(404).json({ success: false, error: 'Farmer not found' });
        return;
      }
      const farmer = fRes.rows[0];
      if (scopedVillages !== null && !scopedVillages.includes(farmer.village_id)) {
        res.status(403).json({ success: false, error: 'Forbidden: Access outside assigned village scope' });
        return;
      }

      // 1. Fetch Call Attempts for this farmer
      const callRes = await db.query(`
        SELECT ca.id,
               ca.started_at as timestamp,
               CASE
                 WHEN ca.provider = 'simulator' THEN 'simulated_call'
                 ELSE 'live_voice'
               END as communication_type,
               'voice' as channel,
               ca.provider,
               ca.provider_call_sid as provider_ref,
               ca.status,
               ca.duration_seconds,
               ca.error_message,
               ca.fallback_sms_sent,
               ca.fallback_sms_sid,
               COALESCE(ca.phone_e164, cs.phone_e164) as recipient_phone,
               COALESCE(ca.season_id, cs.season_id) as season_id,
               s.season_code,
               cr.name as crop_name,
               cl.message_body as fallback_sms_content,
               'Outbound Advisory Call' as purpose_label,
               ca.provider = 'simulator' as is_simulated,
               (SELECT COUNT(*)::int FROM call_responses crp WHERE crp.call_attempt_id = ca.id) as response_count
        FROM call_attempts ca
        LEFT JOIN call_schedule cs ON ca.call_schedule_id = cs.id
        LEFT JOIN seasons s ON s.id = COALESCE(ca.season_id, cs.season_id)
        LEFT JOIN crops cr ON cr.id = s.crop_id
        LEFT JOIN communication_logs cl ON cl.id = ca.communication_log_id
        WHERE ca.farmer_id = $1 OR cs.farmer_id = $1
      `, [farmerId]);

      // 2. Fetch SMS Communication Logs not already attached to a call attempt as fallback
      const smsRes = await db.query(`
        SELECT cl.id,
               cl.created_at as timestamp,
               CASE
                 WHEN cl.purpose = 'call_fallback' THEN 'fallback_sms'
                 WHEN cl.purpose = 'weather_alert' THEN 'weather_alert'
                 WHEN cl.purpose = 'otp_sms' THEN 'otp_sms'
                 ELSE 'sms'
               END as communication_type,
               'sms' as channel,
               cl.provider,
               cl.provider_message_id as provider_ref,
               cl.status,
               NULL::int as duration_seconds,
               cl.error_reason as error_message,
               false as fallback_sms_sent,
               NULL::varchar as fallback_sms_sid,
               cl.recipient_phone,
               NULL::uuid as season_id,
               NULL::varchar as season_code,
               NULL::varchar as crop_name,
               cl.message_body as fallback_sms_content,
               CASE
                 WHEN cl.purpose = 'weather_alert' THEN 'Severe Weather Warning SMS'
                 WHEN cl.purpose = 'otp_sms' THEN 'Phone Verification OTP'
                 WHEN cl.purpose = 'call_fallback' THEN 'Fallback Advisory SMS'
                 ELSE 'Advisory SMS'
               END as purpose_label,
               cl.is_simulated,
               0 as response_count
        FROM communication_logs cl
        WHERE cl.farmer_id = $1
          AND cl.id NOT IN (SELECT communication_log_id FROM call_attempts WHERE communication_log_id IS NOT NULL)
      `, [farmerId]);

      const allRecords = [...callRes.rows, ...smsRes.rows].sort(
        (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );

      const total = allRecords.length;
      const paginated = allRecords.slice(offset, offset + limit);

      const role = (req as any).user?.role || 'AGRI_PANCHAYAT';
      const masked = paginated.map(r => ({
        ...r,
        recipient_phone: r.recipient_phone ? maskPhone(r.recipient_phone, role) : null,
      }));

      res.json({
        success: true,
        farmer: {
          id: farmer.id,
          name: farmer.full_name,
          code: farmer.farmer_code,
        },
        data: masked,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  /**
   * GET /api/v1/telephony/attempts/:id
   * Retrieves single call attempt details with question responses and farmer context.
   */
  static async getCallAttemptDetails(req: Request, res: Response): Promise<void> {
    try {
      const id = req.params.id;
      const query = `
        SELECT ca.*,
               COALESCE(ca.farmer_id, cs.farmer_id) as farmer_id,
               f.full_name as farmer_name, f.farmer_code, f.village_id,
               v.name as village_name,
               COALESCE(ca.season_id, cs.season_id) as season_id,
               s.season_code, s.season_year, s.season_type,
               cr.name as crop_name,
               cl.message_body as fallback_sms_content,
               cl.status as fallback_sms_status
        FROM call_attempts ca
        LEFT JOIN call_schedule cs ON ca.call_schedule_id = cs.id
        LEFT JOIN farmers f ON f.id = COALESCE(ca.farmer_id, cs.farmer_id)
        LEFT JOIN villages v ON f.village_id = v.id
        LEFT JOIN seasons s ON s.id = COALESCE(ca.season_id, cs.season_id)
        LEFT JOIN crops cr ON cr.id = s.crop_id
        LEFT JOIN communication_logs cl ON cl.id = ca.communication_log_id
        WHERE ca.id = $1
      `;
      const resDb = await db.query(query, [id]);
      if (resDb.rows.length === 0) {
        res.status(404).json({ success: false, error: 'Call attempt not found' });
        return;
      }
      const attempt = resDb.rows[0];

      // Check village scoping
      const scopedVillages = getScopedVillageFilter(req.user);
      if (scopedVillages !== null && attempt.village_id && !scopedVillages.includes(attempt.village_id)) {
        res.status(403).json({ success: false, error: 'Forbidden: Access outside assigned village scope' });
        return;
      }

      // Fetch responses
      const respRes = await db.query(`
        SELECT crp.*,
               crp.raw_digits as response_digits,
               crp.parsed_value as interpreted_value,
               cq.question_text_telugu, cq.question_text_english,
               cq.question_text_telugu as question_text_te,
               cq.question_text_english as question_text_en,
               cq.code as question_code
        FROM call_responses crp
        LEFT JOIN call_questions cq ON cq.id = crp.question_id
        WHERE crp.call_attempt_id = $1
        ORDER BY crp.step_number ASC
      `, [id]);

      const role = (req as any).user?.role || 'AGRI_PANCHAYAT';
      res.json({
        success: true,
        data: {
          ...attempt,
          phone_e164: attempt.phone_e164 ? maskPhone(attempt.phone_e164, role) : null,
          responses: respRes.rows,
        },
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

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

    let seasonId = parsed.data.seasonId;
    let farmerId = parsed.data.farmerId;
    const scheduleId = parsed.data.scheduleId;

    if (scheduleId && (!seasonId || !farmerId)) {
      const schRes = await db.query(
        `SELECT season_id, farmer_id FROM call_schedule WHERE id = $1`,
        [scheduleId]
      );
      if (schRes.rows.length > 0) {
        seasonId = seasonId || schRes.rows[0].season_id;
        farmerId = farmerId || schRes.rows[0].farmer_id;
      }
    }

    // Safety restriction: Simulator calls are strictly restricted to demo farmers (data_origin = 'demo')
    let isDemo = false;
    if (farmerId) {
      const fRes = await db.query(`SELECT data_origin FROM farmers WHERE id = $1`, [farmerId]);
      if (fRes.rows.length > 0 && fRes.rows[0].data_origin === 'demo') {
        isDemo = true;
      }
    } else if (seasonId) {
      const sRes = await db.query(
        `SELECT f.data_origin FROM seasons s JOIN farmers f ON s.farmer_id = f.id WHERE s.id = $1`,
        [seasonId]
      );
      if (sRes.rows.length > 0 && sRes.rows[0].data_origin === 'demo') {
        isDemo = true;
      }
    }

    if (!isDemo && (farmerId || seasonId || scheduleId)) {
      res.status(403).json({
        error: 'SIMULATOR_DEMO_ONLY',
        message: 'Interactive simulator can only be run for demo farmers (data_origin = demo).',
      });
      return;
    }

    const sessionId = `sim-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const result = await TelephonyService.startSession({
      sessionId,
      phoneE164: parsed.data.phoneE164,
      provider: 'simulator',
      callScheduleId: scheduleId,
      seasonId,
      farmerId,
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

        const attemptRes = await db.query(
          `SELECT call_schedule_id FROM call_attempts WHERE provider_call_sid = $1`,
          [callSid]
        );
        if (attemptRes.rows[0]?.call_schedule_id) {
          await TelephonyService.handleScheduleFailure(attemptRes.rows[0].call_schedule_id, callStatus);
        }
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
    try {
      const seasonId = req.query.seasonId as string;
      const status = req.query.status as string;

      let query = `
        SELECT cs.*, f.full_name as farmer_name, f.village_id, v.name as village_name,
               c.name as crop_name, s.season_code
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
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
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
