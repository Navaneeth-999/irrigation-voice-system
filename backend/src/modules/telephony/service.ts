import { db, withTransaction } from '../../db/index.js';
import { CallFlowEngine } from './CallFlowEngine.js';
import {
  CallSessionState,
  StepAction,
  TelephonyProvider,
  CallCompletionPayload,
  AudioReviewStatus,
} from './types.js';
import { ITelephonyAdapter } from './adapters/ITelephonyAdapter.js';
import { TwilioAdapter } from './adapters/TwilioAdapter.js';
import { SimulatorAdapter } from './adapters/SimulatorAdapter.js';
import { MockTelephonyAdapter } from './adapters/MockTelephonyAdapter.js';

export class TelephonyService {
  private static activeSessions = new Map<string, CallSessionState>();
  private static twilioAdapter = new TwilioAdapter();
  private static simulatorAdapter = new SimulatorAdapter();
  private static mockAdapter = new MockTelephonyAdapter();

  static getAdapter(provider: TelephonyProvider): ITelephonyAdapter {
    switch (provider) {
      case 'twilio':
        return this.twilioAdapter;
      case 'simulator':
        return this.simulatorAdapter;
      case 'mock':
        return this.mockAdapter;
      default:
        return this.simulatorAdapter;
    }
  }

  /**
   * Generates fortnightly call schedules for an active season
   */
  static async scheduleCallsForSeason(
    seasonId: string,
    txOrDb: any = db
  ): Promise<number> {
    const seasonRes = await txOrDb.query(
      `SELECT s.id, s.farmer_id, s.sowing_date, s.expected_harvest_date, c.phone_e164
       FROM seasons s
       JOIN farmers f ON s.farmer_id = f.id
       LEFT JOIN farmer_contacts c ON f.id = c.farmer_id AND c.type = 'primary' AND c.is_active = true
       WHERE s.id = $1`,
      [seasonId]
    );

    if (seasonRes.rows.length === 0) {
      throw new Error(`Season not found: ${seasonId}`);
    }

    const season = seasonRes.rows[0];
    const phoneE164 = season.phone_e164 || '+919999999999';

    // Get active question set
    const qSetRes = await txOrDb.query(
      `SELECT id FROM call_question_sets WHERE is_active = true ORDER BY version DESC LIMIT 1`
    );
    const questionSetId = qSetRes.rows[0]?.id;
    if (!questionSetId) {
      throw new Error('No active question set available for scheduling.');
    }

    const sowingDate = new Date(season.sowing_date);
    const harvestDate = season.expected_harvest_date
      ? new Date(season.expected_harvest_date)
      : new Date(sowingDate.getTime() + 120 * 24 * 60 * 60 * 1000);

    const durationDays = Math.max(
      14,
      Math.floor((harvestDate.getTime() - sowingDate.getTime()) / (1000 * 60 * 60 * 24))
    );
    const totalCycles = Math.floor(durationDays / 14);

    let scheduledCount = 0;
    for (let cycle = 1; cycle <= totalCycles; cycle++) {
      const scheduledMs = sowingDate.getTime() + cycle * 14 * 24 * 60 * 60 * 1000;
      const scheduledDate = new Date(scheduledMs).toISOString().split('T')[0];
      const dueStart = new Date(scheduledMs - 3 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split('T')[0];
      const dueEnd = new Date(scheduledMs + 3 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split('T')[0];

      await txOrDb.query(
        `INSERT INTO call_schedule (
          season_id, cycle_number, question_set_id, farmer_id, phone_e164,
          scheduled_date, due_window_start, due_window_end, status
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'scheduled')
        ON CONFLICT (season_id, cycle_number) DO NOTHING`,
        [
          seasonId,
          cycle,
          questionSetId,
          season.farmer_id,
          phoneE164,
          scheduledDate,
          dueStart,
          dueEnd,
        ]
      );
      scheduledCount++;
    }

    return scheduledCount;
  }

  /**
   * Starts a new call session (for Simulator, Twilio webhook, or Scheduler)
   */
  static async startSession(params: {
    sessionId: string;
    phoneE164: string;
    provider: TelephonyProvider;
    callScheduleId?: string;
    seasonId?: string;
    farmerId?: string;
  }): Promise<{ action: StepAction; state: CallSessionState }> {
    // 1. If scheduleId provided and not seasonId, look up schedule details
    let seasonId = params.seasonId;
    let farmerId = params.farmerId;
    let phoneE164 = params.phoneE164;

    if (params.callScheduleId && (!seasonId || !farmerId)) {
      const schRes = await db.query(
        `SELECT season_id, farmer_id, phone_e164 FROM call_schedule WHERE id = $1`,
        [params.callScheduleId]
      );
      if (schRes.rows.length > 0) {
        seasonId = seasonId || schRes.rows[0].season_id;
        farmerId = farmerId || schRes.rows[0].farmer_id;
        phoneE164 = phoneE164 || schRes.rows[0].phone_e164;
      }
    }

    // 2. Initialize pure state machine
    const { action, state } = CallFlowEngine.initSession({
      sessionId: params.sessionId,
      phoneE164,
      provider: params.provider,
      callScheduleId: params.callScheduleId,
      seasonId,
      farmerId,
    });

    this.activeSessions.set(params.sessionId, state);

    // 3. Persist call attempt in database with farmer and season integrity
    let attemptNum = 1;
    if (params.callScheduleId) {
      const countRes = await db.query(
        `SELECT COUNT(*) as count FROM call_attempts WHERE call_schedule_id = $1`,
        [params.callScheduleId]
      );
      attemptNum = parseInt(countRes.rows[0]?.count || '0', 10) + 1;
    }

    await db.query(
      `INSERT INTO call_attempts (
        id, call_schedule_id, attempt_number, provider, provider_call_sid, phone_e164, status, started_at, farmer_id, season_id
      )
      VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 'in_progress', NOW(), $6, $7)
      ON CONFLICT (provider_call_sid) DO NOTHING`,
      [
        params.callScheduleId || null,
        attemptNum,
        params.provider,
        params.sessionId,
        phoneE164 || null,
        farmerId || null,
        seasonId || null,
      ]
    );

    if (params.callScheduleId) {
      await db.query(
        `UPDATE call_schedule
         SET status = 'in_progress', attempt_count = attempt_count + 1, last_attempt_at = NOW()
         WHERE id = $1`,
        [params.callScheduleId]
      );
    }

    return { action, state };
  }

  /**
   * Handles user DTMF input for a session
   */
  static async handleInput(
    sessionId: string,
    rawDigits: string
  ): Promise<StepAction> {
    let state = this.activeSessions.get(sessionId);
    if (!state) {
      throw new Error(`SESSION_NOT_FOUND: Call session '${sessionId}' is not active.`);
    }

    const previousStep = state.currentStep;
    const action = CallFlowEngine.handleInput(state, rawDigits);

    // Persist response into call_responses if call attempt exists
    if (state.callScheduleId) {
      const attemptRes = await db.query(
        `SELECT id FROM call_attempts WHERE provider_call_sid = $1 ORDER BY started_at DESC LIMIT 1`,
        [sessionId]
      );

      const attemptId = attemptRes.rows[0]?.id;
      if (attemptId && state.responses) {
        // Record any newly added response
        for (const [code, resp] of Object.entries(state.responses)) {
          if (resp.stepNumber === previousStep) {
            const qRes = await db.query(
              `SELECT id FROM call_questions WHERE code = $1 LIMIT 1`,
              [code]
            );
            const questionId = qRes.rows[0]?.id;

            if (questionId) {
              await db.query(
                `INSERT INTO call_responses (
                  call_attempt_id, question_id, step_number, prompt_code,
                  raw_digits, parsed_value, confidence_score, is_valid, skipped
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8)`,
                [
                  attemptId,
                  questionId,
                  resp.stepNumber,
                  resp.promptCode,
                  resp.rawDigits,
                  String(resp.parsedValue),
                  resp.confidenceScore || 1.0,
                  resp.skipped || false,
                ]
              );
            }
          }
        }
      }
    }

    // Check if session has completed or opted out
    if (action.type === 'TERMINATE') {
      await this.finalizeSession(state);
    }

    return action;
  }

  /**
   * Handles timeout (silence / no input)
   */
  static async handleTimeout(sessionId: string): Promise<StepAction> {
    const state = this.activeSessions.get(sessionId);
    if (!state) {
      throw new Error(`SESSION_NOT_FOUND: Call session '${sessionId}' is not active.`);
    }

    const action = CallFlowEngine.handleTimeout(state);
    if (action.type === 'TERMINATE') {
      await this.finalizeSession(state);
    }
    return action;
  }

  /**
   * Finalizes completed call session and downstream writes
   */
  private static async finalizeSession(state: CallSessionState): Promise<void> {
    this.activeSessions.delete(state.sessionId);

    // Update call attempt status
    await db.query(
      `UPDATE call_attempts
       SET status = $1, ended_at = NOW(), duration_seconds = EXTRACT(EPOCH FROM (NOW() - started_at))::int
       WHERE provider_call_sid = $2`,
      [state.isOptedOut ? 'completed' : state.isCompleted ? 'completed' : 'failed', state.sessionId]
    );

    if (!state.callScheduleId) return;

    if (state.isOptedOut) {
      if (state.farmerId) {
        // Record withdrawn consent in consents audit table
        await db.query(
          `INSERT INTO consents (farmer_id, channel, status, method, note)
           VALUES ($1, 'voice', 'withdrawn', 'ivr', 'Farmer pressed 9 to opt out')`,
          [state.farmerId]
        );
      }
      if (state.seasonId) {
        // Cancel future pending call schedule entries for this season
        await db.query(
          `UPDATE call_schedule
           SET status = 'cancelled', updated_at = NOW()
           WHERE season_id = $1 AND status = 'scheduled'`,
          [state.seasonId]
        );
      }
      if (state.callScheduleId) {
        await db.query(
          `UPDATE call_schedule
           SET status = 'opted_out', updated_at = NOW()
           WHERE id = $1`,
          [state.callScheduleId]
        );
      }
      return;
    }

    if (!state.isCompleted) {
      if (state.callScheduleId) {
        await this.handleScheduleFailure(state.callScheduleId, 'call_incomplete');
      }
      return;
    }

    // Call successfully completed!
    await db.query(
      `UPDATE call_schedule
       SET status = 'completed', completed_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [state.callScheduleId]
    );

    // Fetch cycle number
    const schRes = await db.query(
      `SELECT season_id, cycle_number, farmer_id FROM call_schedule WHERE id = $1`,
      [state.callScheduleId]
    );
    if (schRes.rows.length === 0) return;

    const { season_id, cycle_number, farmer_id } = schRes.rows[0];
    const payload = CallFlowEngine.extractCompletionPayload(state, cycle_number);

    await this.applyFeedbackAndDownstreamRecords(payload, season_id, farmer_id);
  }

  /**
   * Downstream record creation: farmer_feedback, irrigation_records, and action_items
   */
  static async applyFeedbackAndDownstreamRecords(
    payload: CallCompletionPayload,
    seasonId: string,
    farmerId: string
  ): Promise<void> {
    await withTransaction(async (tx) => {
      // 1. Check if feedback already exists for this cycle to prevent duplicate
      const existFb = await tx.query(
        `SELECT id FROM farmer_feedback WHERE season_id = $1 AND cycle_number = $2`,
        [seasonId, payload.cycleNumber]
      );
      if (existFb.rows.length > 0) {
        return; // Already recorded
      }

      // Fetch season details for period calculation & snapshot metrics
      const seasonInfo = await tx.query(
        `SELECT s.sowing_date, s.area_acres_snapshot,
                (SELECT AVG(sws.discharge_lph_snapshot)::float FROM season_water_sources sws WHERE sws.season_id = s.id AND sws.discharge_lph_snapshot IS NOT NULL) as avg_discharge_lph
         FROM seasons s WHERE s.id = $1`,
        [seasonId]
      );

      const sowingDate = new Date(seasonInfo.rows[0]?.sowing_date || new Date());
      const periodEndMs = sowingDate.getTime() + payload.cycleNumber * 14 * 24 * 60 * 60 * 1000;
      const periodStartMs = periodEndMs - 14 * 24 * 60 * 60 * 1000;
      const periodStartDate = new Date(periodStartMs).toISOString().split('T')[0];
      const periodEndDate = new Date(periodEndMs).toISOString().split('T')[0];

      const areaAcres = parseFloat(seasonInfo.rows[0]?.area_acres_snapshot || '1.0');
      const dischargeRateLph = parseFloat(seasonInfo.rows[0]?.avg_discharge_lph || '30000');

      // Map water_problem
      let mappedWaterProblem = 'none';
      if (payload.waterProblem === 'shortage') mappedWaterProblem = 'shortage';
      else if (payload.waterProblem === 'pump_power_issue') mappedWaterProblem = 'pump_power';
      else if (payload.waterProblem === 'source_depleted') mappedWaterProblem = 'source_unavailable';

      // Map crop_problem
      let mappedCropProblem = 'none';
      if (payload.cropProblem === 'pest_disease') mappedCropProblem = 'pest_disease';
      else if (payload.cropProblem === 'yellowing_drying') mappedCropProblem = 'yellowing_drying';
      else if (payload.cropProblem === 'other') mappedCropProblem = 'other';

      // User Requirement 2: "hours" means TOTAL pump running hours for the period!
      const totalPumpHours = payload.irrigated
        ? Number(payload.totalPumpHours ?? payload.hoursPerIrrigation ?? 0)
        : 0;

      let reportedStageId: string | null = null;
      if (!payload.stageConfirmed && payload.reportedStage) {
        const stageRes = await tx.query(
          `SELECT cs.id FROM crop_stages cs
           JOIN seasons s ON s.crop_id = cs.crop_id
           WHERE s.id = $1 AND (cs.name ILIKE $2 OR cs.name_te ILIKE $2)
           ORDER BY cs.stage_order ASC LIMIT 1`,
          [seasonId, `%${payload.reportedStage}%`]
        );
        if (stageRes.rows.length > 0) {
          reportedStageId = stageRes.rows[0].id;
        }
      }

      // 2. Insert farmer_feedback record
      const fbRes = await tx.query(
        `INSERT INTO farmer_feedback (
          season_id, cycle_number, period_start, period_end,
          rainfall_class, irrigated, irrigation_count, pump_hours,
          crop_condition, stage_confirmed, reported_stage_id, water_problem, crop_problem,
          callback_requested, voice_note_path, source, is_simulated
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
        RETURNING id`,
        [
          seasonId,
          payload.cycleNumber,
          periodStartDate,
          periodEndDate,
          payload.rainfallCategory,
          payload.irrigated,
          payload.irrigationCount || 0,
          totalPumpHours,
          payload.cropCondition,
          payload.stageConfirmed,
          reportedStageId,
          mappedWaterProblem,
          mappedCropProblem,
          payload.callbackRequested,
          payload.voiceNoteUrl || null,
          payload.source,
          payload.isSimulated,
        ]
      );
      const feedbackId = fbRes.rows[0].id;

      // 3. If irrigated, calculate volume & depth and insert into irrigation_records
      if (payload.irrigated && totalPumpHours > 0) {
        const volumeL = totalPumpHours * dischargeRateLph;
        const areaM2 = areaAcres * 4046.86;
        const depthMm = areaM2 > 0 ? (volumeL / 1000 / areaM2) * 1000 : 0;

        await tx.query(
          `INSERT INTO irrigation_records (
            season_id, period_start, period_end, event_count, raw_value, raw_unit,
            calculation_method, estimated_volume_l, estimated_depth_mm,
            measurement_type, source, feedback_id, is_simulated, notes
          )
          VALUES ($1, $2, $3, $4, $5, 'pump_hours', 'pump_hours_x_discharge', $6, $7, 'estimated', 'call', $8, $9, $10)`,
          [
            seasonId,
            periodStartDate,
            periodEndDate,
            payload.irrigationCount || 1,
            totalPumpHours,
            volumeL,
            depthMm,
            feedbackId,
            payload.isSimulated,
            `Captured via automated voice call (Cycle ${payload.cycleNumber})`,
          ]
        );
      }

      // 4. Generate deduplicated action items
      async function createActionItem(actionType: string, priority: string, note: string) {
        const existingOpen = await tx.query(
          `SELECT id FROM action_items
           WHERE season_id = $1 AND type = $2 AND status IN ('open', 'assigned', 'in_progress')`,
          [seasonId, actionType]
        );

        if (existingOpen.rows.length === 0) {
          await tx.query(
            `INSERT INTO action_items (
              source, farmer_id, season_id, type, status, priority, referral_note, related_feedback_id
            )
            VALUES ('call', $1, $2, $3, 'open', $4, $5, $6)`,
            [farmerId, seasonId, actionType, priority, note, feedbackId]
          );
        }
      }

      if (mappedWaterProblem !== 'none') {
        const typeMap: Record<string, string> = {
          shortage: 'water_shortage',
          pump_power: 'pump_power_problem',
          source_unavailable: 'source_unavailable',
        };
        const actionType = typeMap[mappedWaterProblem] || 'other_field_issue';
        await createActionItem(
          actionType,
          'high',
          `Farmer reported ${mappedWaterProblem} during call cycle ${payload.cycleNumber}.`
        );
      }

      if (mappedCropProblem !== 'none') {
        await createActionItem(
          'crop_pest_disease',
          'medium',
          `Farmer reported crop problem: ${mappedCropProblem} during cycle ${payload.cycleNumber}.`
        );
      }

      if (payload.cropCondition === 'poor') {
        await createActionItem(
          'crop_condition_poor',
          'high',
          `Farmer reported poor crop condition in cycle ${payload.cycleNumber}.`
        );
      }

      if (payload.callbackRequested) {
        await createActionItem(
          'callback_requested',
          'medium',
          `Farmer requested callback during cycle ${payload.cycleNumber}.`
        );
      }
    });
  }

  /**
   * Idempotency check for provider webhooks
   */
  static async recordWebhookEvent(
    provider: TelephonyProvider,
    eventId: string,
    eventType: string,
    payload: any
  ): Promise<{ isDuplicate: boolean }> {
    const res = await db.query(
      `INSERT INTO provider_webhook_events (provider, event_id, event_type, payload)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (event_id) DO NOTHING
       RETURNING id`,
      [provider, eventId, eventType, JSON.stringify(payload)]
    );

    return { isDuplicate: res.rows.length === 0 };
  }

  /**
   * Dispatches due scheduled calls using row-level locking (FOR UPDATE SKIP LOCKED)
   * Avoids nested transaction deadlocks on single-connection PGlite while fully locking on Postgres.
   */
  static async processDueCallSchedule(params: {
    limit?: number;
    provider?: TelephonyProvider;
    callbackBaseUrl?: string;
    bypassTimeWindow?: boolean;
  }): Promise<{ processedCount: number; callsDispatched: any[] }> {
    const limit = params.limit || 10;
    const provider = params.provider || 'simulator';
    const baseUrl = params.callbackBaseUrl || 'http://localhost:4000';
    const bypassWindow = params.bypassTimeWindow ?? (process.env.NODE_ENV === 'test');

    // Time window enforcement (09:00 to 18:00 IST) unless bypassed
    if (!bypassWindow) {
      const now = new Date();
      // IST is UTC + 5:30
      const istHours =
        (now.getUTCHours() + 5 + Math.floor((now.getUTCMinutes() + 30) / 60)) % 24;
      if (istHours < 9 || istHours >= 18) {
        return { processedCount: 0, callsDispatched: [] };
      }
    }

    // 1. Transactionally lock and retrieve due rows
    let dueRows: any[] = [];
    await withTransaction(async (tx) => {
      const dueRes = await tx.query(
        `SELECT cs.id, cs.season_id, cs.farmer_id, cs.phone_e164, cs.cycle_number, cs.attempt_count, cs.max_attempts
         FROM call_schedule cs
         WHERE cs.status = 'scheduled'
           AND cs.scheduled_date <= CURRENT_DATE
           AND cs.due_window_end >= CURRENT_DATE
           AND cs.attempt_count < cs.max_attempts
           -- Consent check: Farmer must not have active withdrawn consent for voice
           AND NOT EXISTS (
             SELECT 1 FROM consents c
             WHERE c.farmer_id = cs.farmer_id
               AND c.channel = 'voice'
               AND c.status = 'withdrawn'
           )
           -- Phone verification check: Only dispatch calls to verified phone numbers
           AND EXISTS (
             SELECT 1 FROM farmers f
             WHERE f.id = cs.farmer_id
               AND COALESCE(f.phone_verified, false) = true
           )
           -- Daily cap check: Max 1 call attempt per farmer per day
           AND NOT EXISTS (
             SELECT 1 FROM call_attempts ca
             JOIN call_schedule cs2 ON ca.call_schedule_id = cs2.id
             WHERE cs2.farmer_id = cs.farmer_id
               AND ca.started_at >= CURRENT_DATE
           )
         ORDER BY cs.scheduled_date ASC
         LIMIT $1
         FOR UPDATE SKIP LOCKED`,
        [limit]
      );
      dueRows = dueRes.rows;

      for (const row of dueRows) {
        await tx.query(
          `UPDATE call_schedule
           SET status = 'in_progress', attempt_count = attempt_count + 1, last_attempt_at = NOW(), updated_at = NOW()
           WHERE id = $1`,
          [row.id]
        );
      }
    });

    const dispatched: any[] = [];

    // 2. Dispatch calls and initialize sessions outside outer transaction to avoid PGlite deadlock
    for (const row of dueRows) {
      const adapter = this.getAdapter(provider);
      const callResult = await adapter.initiateCall({
        scheduleId: row.id,
        seasonId: row.season_id,
        farmerId: row.farmer_id,
        to: row.phone_e164,
        callbackBaseUrl: baseUrl,
      });

      await this.startSession({
        sessionId: callResult.callSid,
        phoneE164: row.phone_e164,
        provider,
        callScheduleId: row.id,
        seasonId: row.season_id,
        farmerId: row.farmer_id,
      });

      dispatched.push({
        scheduleId: row.id,
        callSid: callResult.callSid,
        cycleNumber: row.cycle_number,
        phone: row.phone_e164,
      });
    }

    return { processedCount: dispatched.length, callsDispatched: dispatched };
  }

  /**
   * Handles failure of a scheduled call attempt:
   * - Checks attempt limit against max_attempts
   * - If exceeded: marks status = 'failed', logs fallback SMS, and checks if previous cycle was also failed (triggering repeated_missed_calls)
   * - If retry remains: sets status back to 'scheduled'
   */
  static async handleScheduleFailure(scheduleId: string, reason: string = 'not_reached'): Promise<void> {
    const schRes = await db.query(
      `SELECT cs.id, cs.season_id, cs.farmer_id, cs.cycle_number, cs.attempt_count, cs.max_attempts
       FROM call_schedule cs
       WHERE cs.id = $1`,
      [scheduleId]
    );

    if (schRes.rows.length === 0) return;
    const sch = schRes.rows[0];

    if (sch.attempt_count >= sch.max_attempts) {
      // Reached maximum attempts: mark schedule as failed
      await db.query(
        `UPDATE call_schedule SET status = 'failed', updated_at = NOW() WHERE id = $1`,
        [scheduleId]
      );

      // Log fallback SMS
      console.log(`[Telephony] Fallback SMS logged for failed call cycle ${sch.cycle_number} on season ${sch.season_id} (farmer: ${sch.farmer_id}, reason: ${reason}).`);

      // Check if previous cycle was also failed (two consecutive not_reached cycles)
      if (sch.cycle_number > 1) {
        const prevRes = await db.query(
          `SELECT status FROM call_schedule WHERE season_id = $1 AND cycle_number = $2`,
          [sch.season_id, sch.cycle_number - 1]
        );
        if (prevRes.rows.length > 0 && prevRes.rows[0].status === 'failed') {
          // Two consecutive failures! Trigger repeated_missed_calls action item
          const existingItem = await db.query(
            `SELECT id FROM action_items WHERE season_id = $1 AND type = 'repeated_missed_calls' AND status IN ('open', 'assigned', 'in_progress')`,
            [sch.season_id]
          );
          if (existingItem.rows.length === 0) {
            await db.query(
              `INSERT INTO action_items (
                source, farmer_id, season_id, type, status, priority, referral_note
              )
              VALUES ('call', $1, $2, 'repeated_missed_calls', 'open', 'high', $3)`,
              [
                sch.farmer_id,
                sch.season_id,
                `Farmer was unreachable across two consecutive call cycles (cycles ${sch.cycle_number - 1} and ${sch.cycle_number}). Fallback SMS logged.`,
              ]
            );
          }
        }
      }
    } else {
      // Still has remaining attempts: revert status to 'scheduled' for retry
      await db.query(
        `UPDATE call_schedule SET status = 'scheduled', updated_at = NOW() WHERE id = $1`,
        [scheduleId]
      );
    }
  }

  /**
   * Reviews an audio prompt (Agronomist / CSP admin review workflow)
   */
  static async reviewAudioPrompt(
    promptCode: string,
    status: AudioReviewStatus,
    userId: string,
    notes?: string
  ): Promise<any> {
    const res = await db.query(
      `UPDATE audio_prompts
       SET review_status = $1, reviewed_by = $2, reviewed_at = NOW(), review_notes = $3, updated_at = NOW()
       WHERE prompt_code = $4
       RETURNING *`,
      [status, userId, notes || null, promptCode]
    );

    if (res.rows.length === 0) {
      throw new Error(`PROMPT_NOT_FOUND: Audio prompt '${promptCode}' does not exist.`);
    }

    return res.rows[0];
  }
}
