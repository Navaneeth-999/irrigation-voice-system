import { Request, Response } from 'express';
import { db, withTransaction } from '../../db/index.js';
import { AppError } from '../../middleware/errorHandler.js';
import { recordAudit } from '../../middleware/audit.js';
import { createFeedbackSchema } from './schemas.js';
import { calculateIrrigationVolume } from '../irrigation/service.js';
import { computeExpectedStage } from '../crop-progress/service.js';

export async function listFeedback(req: Request, res: Response): Promise<void> {
  const seasonId = req.params.seasonId || req.query.season_id;
  if (!seasonId) {
    throw new AppError('Season ID is required.', 400, 'MISSING_SEASON_ID');
  }

  const feedbackRes = await db.query(`
    SELECT fb.*, cs.name as reported_stage_name, cs.name_te as reported_stage_name_te
    FROM farmer_feedback fb
    LEFT JOIN crop_stages cs ON fb.reported_stage_id = cs.id
    WHERE fb.season_id = $1
    ORDER BY fb.cycle_number DESC
  `, [seasonId]);

  res.json({ data: feedbackRes.rows });
}

export async function createFeedback(req: Request, res: Response): Promise<void> {
  const data = createFeedbackSchema.parse(req.body);

  // 1. Fetch Season and Snapshot values
  const seasonRes = await db.query(`
    SELECT s.id, s.farmer_id, s.crop_id, s.sowing_date, s.status, s.area_acres_snapshot,
           (SELECT AVG(sws.discharge_lph_snapshot)::float FROM season_water_sources sws WHERE sws.season_id = s.id AND sws.discharge_lph_snapshot IS NOT NULL) as avg_discharge_lph
    FROM seasons s
    WHERE s.id = $1
  `, [data.season_id]);

  if (seasonRes.rows.length === 0) {
    throw new AppError('Season not found', 404, 'NOT_FOUND');
  }
  const season = seasonRes.rows[0];

  // 2. Reject feedback if season is in draft, completed, or cancelled status
  if (season.status === 'draft') {
    throw new AppError('Cannot record feedback for a draft season. Activate the season first.', 400, 'SEASON_NOT_ACTIVE');
  }
  if (['completed', 'cancelled'].includes(season.status)) {
    throw new AppError(`Cannot record feedback for a ${season.status} season.`, 400, 'SEASON_TERMINATED');
  }

  // 3. Enforce Unique Cycle Feedback check
  const duplicateCheck = await db.query(
    'SELECT id FROM farmer_feedback WHERE season_id = $1 AND cycle_number = $2',
    [data.season_id, data.cycle_number]
  );
  if (duplicateCheck.rows.length > 0) {
    throw new AppError(
      `Feedback for Cycle ${data.cycle_number} has already been recorded for this season.`,
      409,
      'DUPLICATE_CYCLE_FEEDBACK'
    );
  }

  // Compute expected stage before opening the transaction (avoids PGlite nested client lock)
  const expectedStageId = await computeExpectedStage(season.crop_id, season.sowing_date, data.period_end);

  const result = await withTransaction(async (tx) => {
    // 4. Insert Farmer Feedback
    const fbRes = await tx.query(`
      INSERT INTO farmer_feedback (
        season_id, cycle_number, period_start, period_end,
        rainfall_class, irrigated, irrigation_count, pump_hours,
        crop_condition, stage_confirmed, reported_stage_id,
        water_problem, crop_problem, callback_requested,
        voice_note_path, source, is_simulated
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
      RETURNING *
    `, [
      data.season_id, data.cycle_number, data.period_start, data.period_end,
      data.rainfall_class, data.irrigated, data.irrigation_count, data.pump_hours,
      data.crop_condition, data.stage_confirmed, data.reported_stage_id || null,
      data.water_problem, data.crop_problem, data.callback_requested,
      data.voice_note_path || null, data.source, data.is_simulated,
    ]);
    const feedback = fbRes.rows[0];

    // 5. If farmer reported irrigating and pump hours > 0, generate irrigation record automatically
    let irrigationRecord = null;
    if (data.irrigated && data.pump_hours > 0) {
      const calcResult = calculateIrrigationVolume({
        rawValue: data.pump_hours,
        rawUnit: 'pump_hours',
        areaAcres: parseFloat(season.area_acres_snapshot),
        dischargeLph: season.avg_discharge_lph,
      });

      const irRes = await tx.query(`
        INSERT INTO irrigation_records (
          season_id, period_start, period_end, event_count, raw_value, raw_unit,
          calculation_method, estimated_volume_l, estimated_depth_mm,
          measurement_type, source, feedback_id, is_simulated
        )
        VALUES ($1, $2, $3, $4, $5, 'pump_hours', $6, $7, $8, $9, $10, $11, $12)
        RETURNING *
      `, [
        season.id, data.period_start, data.period_end,
        data.irrigation_count || 1, data.pump_hours,
        calcResult.calculationMethod, calcResult.estimatedVolumeL, calcResult.estimatedDepthMm,
        calcResult.measurementType, data.source === 'ivr' ? 'call' : 'admin_entry',
        feedback.id, data.is_simulated,
      ]);
      irrigationRecord = irRes.rows[0];
    }

    // 6. Record Crop Progress observation
    await tx.query(`
      INSERT INTO crop_progress (
        season_id, observed_on, reported_stage_id, expected_stage_id,
        condition, source, is_simulated, notes
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [
      season.id, data.period_end, data.reported_stage_id || expectedStageId,
      expectedStageId, data.crop_condition,
      data.source === 'ivr' ? 'call' : 'admin_entry',
      data.is_simulated, `Recorded via Cycle ${data.cycle_number} feedback`,
    ]);

    // 7. Deduplicated Action Items creation (dedupes open/assigned/in_progress per season + type)
    async function createDeduplicatedActionItem(
      actionType: string,
      priority: string,
      note: string
    ) {
      const existingOpen = await tx.query(`
        SELECT id FROM action_items
        WHERE season_id = $1 AND type = $2 AND status IN ('open', 'assigned', 'in_progress')
      `, [season.id, actionType]);

      if (existingOpen.rows.length === 0) {
        await tx.query(`
          INSERT INTO action_items (
            source, farmer_id, season_id, type, status, priority, referral_note, related_feedback_id
          )
          VALUES ('call', $1, $2, $3, 'open', $4, $5, $6)
        `, [
          season.farmer_id, season.id, actionType, priority, note, feedback.id,
        ]);
      }
    }

    if (data.water_problem !== 'none') {
      const typeMap: Record<string, string> = {
        shortage: 'water_shortage',
        pump_power: 'pump_power_problem',
        source_unavailable: 'source_unavailable',
      };
      const actionType = typeMap[data.water_problem] || 'other_field_issue';
      await createDeduplicatedActionItem(
        actionType,
        'high',
        `Farmer reported water problem: ${data.water_problem}`
      );
    }

    if (data.crop_problem !== 'none') {
      await createDeduplicatedActionItem(
        'crop_pest_disease',
        'medium',
        `Farmer reported crop issue: ${data.crop_problem}`
      );
    }

    if (data.callback_requested) {
      await createDeduplicatedActionItem(
        'callback_requested',
        'medium',
        'Farmer requested phone callback from field team'
      );
    }

    // 8. Transition season status to 'monitoring' if currently 'active'
    if (season.status === 'active') {
      await tx.query(`
        UPDATE seasons SET status = 'monitoring', updated_at = CURRENT_TIMESTAMP WHERE id = $1
      `, [season.id]);
    }

    return { feedback, irrigationRecord };
  });

  await recordAudit({
    userId: req.user?.id,
    action: 'FARMER_FEEDBACK_RECORDED',
    entityType: 'farmer_feedback',
    entityId: result.feedback.id,
    after: { season_id: data.season_id, cycle: data.cycle_number, irrigated: data.irrigated },
    req,
  });

  res.status(201).json({ data: result });
}
