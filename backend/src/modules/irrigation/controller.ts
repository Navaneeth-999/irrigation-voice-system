import { Request, Response } from 'express';
import { db } from '../../db/index.js';
import { AppError } from '../../middleware/errorHandler.js';
import { recordAudit } from '../../middleware/audit.js';
import { createIrrigationRecordSchema } from './schemas.js';
import { calculateIrrigationVolume } from './service.js';

export async function listIrrigationRecords(req: Request, res: Response): Promise<void> {
  const seasonId = req.params.seasonId || req.query.season_id;
  if (!seasonId) {
    throw new AppError('Season ID is required.', 400, 'MISSING_SEASON_ID');
  }

  const recordsRes = await db.query(`
    SELECT ir.*
    FROM irrigation_records ir
    WHERE ir.season_id = $1
    ORDER BY ir.period_start DESC
  `, [seasonId]);

  res.json({ data: recordsRes.rows });
}

export async function createIrrigationRecord(req: Request, res: Response): Promise<void> {
  const data = createIrrigationRecordSchema.parse(req.body);

  // Look up season's frozen area and water source discharge snapshots
  const seasonRes = await db.query(`
    SELECT s.id, s.area_acres_snapshot, s.status,
           (SELECT AVG(sws.discharge_lph_snapshot)::float FROM season_water_sources sws WHERE sws.season_id = s.id AND sws.discharge_lph_snapshot IS NOT NULL) as avg_discharge_lph
    FROM seasons s
    WHERE s.id = $1
  `, [data.season_id]);

  if (seasonRes.rows.length === 0) {
    throw new AppError('Season not found', 404, 'NOT_FOUND');
  }
  const season = seasonRes.rows[0];

  const calcResult = calculateIrrigationVolume({
    rawValue: data.raw_value,
    rawUnit: data.raw_unit,
    areaAcres: parseFloat(season.area_acres_snapshot),
    dischargeLph: season.avg_discharge_lph,
  });

  const recordRes = await db.query(`
    INSERT INTO irrigation_records (
      season_id, period_start, period_end, event_count, raw_value, raw_unit,
      calculation_method, estimated_volume_l, estimated_depth_mm,
      measurement_type, source, notes
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    RETURNING *
  `, [
    data.season_id, data.period_start, data.period_end, data.event_count,
    data.raw_value, data.raw_unit, calcResult.calculationMethod,
    calcResult.estimatedVolumeL, calcResult.estimatedDepthMm,
    calcResult.measurementType, data.source, data.notes || null,
  ]);

  const created = recordRes.rows[0];

  await recordAudit({
    userId: req.user?.id,
    action: 'IRRIGATION_RECORD_CREATED',
    entityType: 'irrigation_records',
    entityId: created.id,
    after: { season_id: data.season_id, estimated_volume_l: created.estimated_volume_l },
    req,
  });

  res.status(201).json({ data: created });
}
