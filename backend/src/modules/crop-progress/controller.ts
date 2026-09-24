import { Request, Response } from 'express';
import { db, withTransaction } from '../../db/index.js';
import { AppError } from '../../middleware/errorHandler.js';
import { recordAudit } from '../../middleware/audit.js';
import { createCropProgressSchema } from './schemas.js';
import { computeExpectedStage } from './service.js';

export async function listCropProgress(req: Request, res: Response): Promise<void> {
  const seasonId = req.params.seasonId || req.query.season_id;
  if (!seasonId) {
    throw new AppError('Season ID is required.', 400, 'MISSING_SEASON_ID');
  }

  const progressRes = await db.query(`
    SELECT cp.*,
           rep_s.name as reported_stage_name, rep_s.name_te as reported_stage_name_te,
           exp_s.name as expected_stage_name, exp_s.name_te as expected_stage_name_te
    FROM crop_progress cp
    LEFT JOIN crop_stages rep_s ON cp.reported_stage_id = rep_s.id
    LEFT JOIN crop_stages exp_s ON cp.expected_stage_id = exp_s.id
    WHERE cp.season_id = $1
    ORDER BY cp.observed_on DESC
  `, [seasonId]);

  res.json({ data: progressRes.rows });
}

export async function createCropProgress(req: Request, res: Response): Promise<void> {
  const data = createCropProgressSchema.parse(req.body);

  const seasonRes = await db.query(`
    SELECT s.id, s.farmer_id, s.crop_id, s.sowing_date
    FROM seasons s
    WHERE s.id = $1
  `, [data.season_id]);

  if (seasonRes.rows.length === 0) {
    throw new AppError('Season not found', 404, 'NOT_FOUND');
  }
  const season = seasonRes.rows[0];

  const expectedStageId = await computeExpectedStage(season.crop_id, season.sowing_date, data.observed_on);

  const created = await withTransaction(async (tx) => {
    const cpRes = await tx.query(`
      INSERT INTO crop_progress (
        season_id, observed_on, reported_stage_id, expected_stage_id,
        condition, source, notes
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [
      data.season_id, data.observed_on, data.reported_stage_id || expectedStageId,
      expectedStageId, data.condition, data.source, data.notes || null,
    ]);
    const progress = cpRes.rows[0];

    // If condition is poor, automatically raise an action item
    if (data.condition === 'poor') {
      await tx.query(`
        INSERT INTO action_items (
          source, farmer_id, season_id, type, status, priority, referral_note
        )
        VALUES ('system', $1, $2, 'crop_condition_poor', 'open', 'high', $3)
      `, [
        season.farmer_id, season.id,
        `Poor crop condition observed on ${data.observed_on}: ${data.notes || 'Immediate field check advised'}`,
      ]);
    }

    return progress;
  });

  await recordAudit({
    userId: req.user?.id,
    action: 'CROP_PROGRESS_RECORDED',
    entityType: 'crop_progress',
    entityId: created.id,
    after: { season_id: data.season_id, condition: data.condition, observed_on: data.observed_on },
    req,
  });

  res.status(201).json({ data: created });
}
