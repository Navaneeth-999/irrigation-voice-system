import { Request, Response } from 'express';
import { db, withTransaction } from '../../db/index.js';
import { AppError } from '../../middleware/errorHandler.js';
import { recordAudit } from '../../middleware/audit.js';
import { getScopedVillageFilter } from '../../middleware/auth.js';
import { createSeasonSchema, updateSeasonSchema, completeSeasonSchema } from './schemas.js';
import { TelephonyService } from '../telephony/service.js';

export async function listSeasons(req: Request, res: Response): Promise<void> {
  const farmer_id = req.query.farmer_id || req.query.farmerId;
  const { status, crop_id, season_year } = req.query;
  const user = req.user;
  const scopedVillages = getScopedVillageFilter(user);

  let query = `
    SELECT s.*, f.full_name as farmer_name, f.farmer_code, f.village_id,
           v.name as village_name, c.name as crop_name, c.name_te as crop_name_te,
           p.label as plot_label, imt.name as irrigation_method_name,
           (SELECT COUNT(*)::int FROM irrigation_records ir WHERE ir.season_id = s.id) as irrigation_events_count,
           (SELECT COALESCE(SUM(ir.estimated_volume_l), 0)::float FROM irrigation_records ir WHERE ir.season_id = s.id) as total_water_used_l
    FROM seasons s
    JOIN farmers f ON s.farmer_id = f.id
    JOIN villages v ON f.village_id = v.id
    JOIN crops c ON s.crop_id = c.id
    JOIN plots p ON s.plot_id = p.id
    JOIN irrigation_method_types imt ON s.irrigation_method_type_id = imt.id
    WHERE 1=1
  `;
  const params: any[] = [];

  if (scopedVillages !== null) {
    if (scopedVillages.length === 0) {
      res.json({ data: [] });
      return;
    }
    params.push(scopedVillages);
    query += ` AND f.village_id = ANY($${params.length})`;
  }

  if (farmer_id) {
    params.push(farmer_id);
    query += ` AND s.farmer_id = $${params.length}`;
  }

  if (status) {
    params.push(status);
    query += ` AND s.status = $${params.length}`;
  }

  if (crop_id) {
    params.push(crop_id);
    query += ` AND s.crop_id = $${params.length}`;
  }

  if (season_year) {
    params.push(season_year);
    query += ` AND s.season_year = $${params.length}`;
  }

  query += ` ORDER BY s.created_at DESC`;

  const seasonsRes = await db.query(query, params);
  res.json({ data: seasonsRes.rows });
}

export async function getSeason(req: Request, res: Response): Promise<void> {
  const id = req.params.id as string;
  const user = req.user;
  const scopedVillages = getScopedVillageFilter(user);

  const seasonRes = await db.query(`
    SELECT s.*, f.full_name as farmer_name, f.farmer_code, f.village_id,
           v.name as village_name, v.mandal, v.district,
           c.name as crop_name, c.name_te as crop_name_te, c.water_model,
           p.label as plot_label, p.survey_number as plot_survey_number,
           imt.name as irrigation_method_name, imt.typical_efficiency,
           COALESCE(json_agg(json_build_object(
             'id', sws.id,
             'water_source_type_id', sws.water_source_type_id,
             'source_name', wst.name,
             'source_name_te', wst.name_te,
             'share_percent', sws.share_percent,
             'pump_hp_snapshot', sws.pump_hp_snapshot,
             'discharge_lph_snapshot', sws.discharge_lph_snapshot
           )) FILTER (WHERE sws.id IS NOT NULL), '[]') as water_sources_snapshot
    FROM seasons s
    JOIN farmers f ON s.farmer_id = f.id
    JOIN villages v ON f.village_id = v.id
    JOIN crops c ON s.crop_id = c.id
    JOIN plots p ON s.plot_id = p.id
    JOIN irrigation_method_types imt ON s.irrigation_method_type_id = imt.id
    LEFT JOIN season_water_sources sws ON s.id = sws.season_id
    LEFT JOIN water_source_types wst ON sws.water_source_type_id = wst.id
    WHERE s.id = $1
    GROUP BY s.id, f.full_name, f.farmer_code, f.village_id, v.name, v.mandal, v.district, c.name, c.name_te, c.water_model, p.label, p.survey_number, imt.name, imt.typical_efficiency
  `, [id]);

  if (seasonRes.rows.length === 0) {
    throw new AppError('Season not found', 404, 'NOT_FOUND');
  }

  const season = seasonRes.rows[0];

  if (scopedVillages !== null && !scopedVillages.includes(season.village_id)) {
    throw new AppError('Forbidden: You do not have access to seasons in this village.', 403, 'FORBIDDEN');
  }

  res.json({ data: season });
}

export async function createSeason(req: Request, res: Response): Promise<void> {
  const data = createSeasonSchema.parse(req.body);

  // 1. Verify farmer exists and is active
  const farmerRes = await db.query('SELECT id, status, village_id FROM farmers WHERE id = $1', [data.farmer_id]);
  if (farmerRes.rows.length === 0) {
    throw new AppError('Farmer not found', 404, 'NOT_FOUND');
  }
  if (farmerRes.rows[0].status !== 'active') {
    throw new AppError('Cannot create a season for an inactive farmer.', 400, 'INACTIVE_FARMER');
  }

  // 2. Verify plot exists, belongs to farmer, has area, and has water sources
  const plotRes = await db.query('SELECT * FROM plots WHERE id = $1 AND farmer_id = $2 AND is_active = true', [data.plot_id, data.farmer_id]);
  if (plotRes.rows.length === 0) {
    throw new AppError('Plot not found or does not belong to this farmer.', 404, 'NOT_FOUND');
  }
  const plot = plotRes.rows[0];

  const plotSourcesRes = await db.query('SELECT * FROM plot_water_sources WHERE plot_id = $1', [plot.id]);
  if (plotSourcesRes.rows.length === 0) {
    throw new AppError('The selected plot has no water sources configured. Please add a water source first.', 400, 'NO_WATER_SOURCES');
  }

  // Generate Season Code: SEAS-<YEAR>-<TYPE>-<RANDOM>
  const seasonCode = `SEAS-${data.season_year}-${data.season_type.toUpperCase()}-${Math.floor(1000 + Math.random() * 9000)}`;

  const createdSeason = await withTransaction(async (tx) => {
    // 3. Create Season with Snapshots (Snapshot Rule at creation: Draft state)
    const sRes = await tx.query(`
      INSERT INTO seasons (
        season_code, farmer_id, plot_id, season_type, season_year,
        crop_id, variety, sowing_date, expected_harvest_date,
        irrigation_method_type_id, area_acres_snapshot, status, data_origin
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'draft', $12)
      RETURNING *
    `, [
      seasonCode, data.farmer_id, data.plot_id, data.season_type, data.season_year,
      data.crop_id, data.variety || null, data.sowing_date, data.expected_harvest_date,
      data.irrigation_method_type_id, plot.area_acres, data.data_origin,
    ]);
    const season = sRes.rows[0];

    // 4. Snapshot water sources from plot into season_water_sources
    const sourceCount = plotSourcesRes.rows.length;
    const sharePerSource = Number((100 / sourceCount).toFixed(2));

    for (const pws of plotSourcesRes.rows) {
      await tx.query(`
        INSERT INTO season_water_sources (
          season_id, water_source_type_id, share_percent, pump_hp_snapshot, discharge_lph_snapshot
        )
        VALUES ($1, $2, $3, $4, $5)
      `, [
        season.id, pws.water_source_type_id, sharePerSource,
        pws.pump_hp || null, pws.discharge_lph || null,
      ]);
    }

    return season;
  });

  await recordAudit({
    userId: req.user?.id,
    action: 'SEASON_CREATED',
    entityType: 'seasons',
    entityId: createdSeason.id,
    after: { season_code: createdSeason.season_code, farmer_id: createdSeason.farmer_id, area_acres: createdSeason.area_acres_snapshot },
    req,
  });

  res.status(201).json({ data: createdSeason });
}

export async function refreshDraftSnapshot(req: Request, res: Response): Promise<void> {
  const id = req.params.id as string;

  const seasonRes = await db.query('SELECT * FROM seasons WHERE id = $1', [id]);
  if (seasonRes.rows.length === 0) {
    throw new AppError('Season not found', 404, 'NOT_FOUND');
  }
  const season = seasonRes.rows[0];

  if (season.status !== 'draft') {
    throw new AppError('Snapshots can only be refreshed while the season is in Draft status. Once active, snapshots are permanently frozen.', 400, 'SNAPSHOT_FROZEN');
  }

  // Refresh from current plot state
  const plotRes = await db.query('SELECT * FROM plots WHERE id = $1', [season.plot_id]);
  const plot = plotRes.rows[0];

  const plotSourcesRes = await db.query('SELECT * FROM plot_water_sources WHERE plot_id = $1', [plot.id]);

  await withTransaction(async (tx) => {
    await tx.query(`
      UPDATE seasons
      SET area_acres_snapshot = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
    `, [plot.area_acres, season.id]);

    await tx.query('DELETE FROM season_water_sources WHERE season_id = $1', [season.id]);

    const sourceCount = plotSourcesRes.rows.length;
    const sharePerSource = Number((100 / sourceCount).toFixed(2));

    for (const pws of plotSourcesRes.rows) {
      await tx.query(`
        INSERT INTO season_water_sources (
          season_id, water_source_type_id, share_percent, pump_hp_snapshot, discharge_lph_snapshot
        )
        VALUES ($1, $2, $3, $4, $5)
      `, [
        season.id, pws.water_source_type_id, sharePerSource,
        pws.pump_hp || null, pws.discharge_lph || null,
      ]);
    }
  });

  res.json({ data: { message: 'Draft snapshot successfully refreshed from plot.' } });
}

export async function activateSeason(req: Request, res: Response): Promise<void> {
  const id = req.params.id as string;

  const seasonRes = await db.query('SELECT * FROM seasons WHERE id = $1', [id]);
  if (seasonRes.rows.length === 0) {
    throw new AppError('Season not found', 404, 'NOT_FOUND');
  }
  const season = seasonRes.rows[0];

  if (season.status !== 'draft') {
    throw new AppError(`Cannot activate season with status "${season.status}". Only Draft seasons can be activated.`, 400, 'INVALID_STATUS');
  }

  // Snapshot Rule: Transition to 'active' freezes the snapshots permanently!
  const updatedRes = await db.query(`
    UPDATE seasons
    SET status = 'active', updated_at = CURRENT_TIMESTAMP
    WHERE id = $1
    RETURNING *
  `, [id]);

  // Generate automated fortnightly call schedule for this season
  await TelephonyService.scheduleCallsForSeason(id);

  await recordAudit({
    userId: req.user?.id,
    action: 'SEASON_ACTIVATED',
    entityType: 'seasons',
    entityId: id,
    before: { status: 'draft' },
    after: { status: 'active', snapshot_frozen: true },
    req,
  });

  res.json({ data: updatedRes.rows[0] });
}

export async function completeSeason(req: Request, res: Response): Promise<void> {
  const id = req.params.id as string;
  const data = completeSeasonSchema.parse(req.body);

  const seasonRes = await db.query('SELECT * FROM seasons WHERE id = $1', [id]);
  if (seasonRes.rows.length === 0) {
    throw new AppError('Season not found', 404, 'NOT_FOUND');
  }
  const season = seasonRes.rows[0];

  if (season.status === 'draft') {
    throw new AppError('Cannot complete a season that is in Draft status. Season must be active or monitoring first.', 400, 'CANNOT_COMPLETE_DRAFT');
  }

  if (['completed', 'cancelled'].includes(season.status)) {
    throw new AppError(`Season is already ${season.status}.`, 400, 'ALREADY_COMPLETED');
  }

  if (new Date(data.actual_harvest_date) < new Date(season.sowing_date)) {
    throw new AppError('Actual harvest date cannot be earlier than the sowing date.', 400, 'INVALID_HARVEST_DATE');
  }

  const updatedRes = await db.query(`
    UPDATE seasons
    SET status = 'completed',
        actual_harvest_date = $1,
        yield_value = $2,
        yield_unit = $3,
        harvest_notes = $4,
        completed_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = $5
    RETURNING *
  `, [
    data.actual_harvest_date,
    data.yield_value || null,
    data.yield_unit,
    data.harvest_notes || null,
    id,
  ]);

  await recordAudit({
    userId: req.user?.id,
    action: 'SEASON_COMPLETED',
    entityType: 'seasons',
    entityId: id,
    after: {
      status: 'completed',
      actual_harvest_date: data.actual_harvest_date,
      yield_value: data.yield_value,
    },
    req,
  });

  res.json({ data: updatedRes.rows[0] });
}

export async function getSeasonTimeline(req: Request, res: Response): Promise<void> {
  const id = req.params.id as string;

  const seasonRes = await db.query(`
    SELECT s.*, c.name as crop_name, p.label as plot_label
    FROM seasons s
    JOIN crops c ON s.crop_id = c.id
    JOIN plots p ON s.plot_id = p.id
    WHERE s.id = $1
  `, [id]);

  if (seasonRes.rows.length === 0) {
    throw new AppError('Season not found', 404, 'NOT_FOUND');
  }
  const season = seasonRes.rows[0];

  // 1. Sowing event
  const events: any[] = [
    {
      date: season.sowing_date,
      type: 'sowing',
      title: `Season Sowing: ${season.crop_name}`,
      description: `Crop variety: ${season.variety || 'Standard'}, Area: ${season.area_acres_snapshot} acres`,
      status: 'completed',
    },
  ];

  // 2. Irrigation records
  const irrigationRes = await db.query(`
    SELECT * FROM irrigation_records WHERE season_id = $1 ORDER BY period_start ASC
  `, [id]);
  for (const ir of irrigationRes.rows) {
    events.push({
      date: ir.period_end,
      type: 'irrigation',
      title: `Irrigation Event (${ir.event_count}x)`,
      description: `${ir.estimated_volume_l.toLocaleString()} L estimated (${ir.raw_value} ${ir.raw_unit})`,
      data: ir,
    });
  }

  // 3. Crop progress observations
  const progressRes = await db.query(`
    SELECT cp.*, cs.name as reported_stage_name
    FROM crop_progress cp
    LEFT JOIN crop_stages cs ON cp.reported_stage_id = cs.id
    WHERE cp.season_id = $1
    ORDER BY cp.observed_on ASC
  `, [id]);
  for (const cp of progressRes.rows) {
    events.push({
      date: cp.observed_on,
      type: 'progress',
      title: `Crop Observation: ${cp.condition.toUpperCase()}`,
      description: `Stage: ${cp.reported_stage_name || 'N/A'}. ${cp.notes || ''}`,
      data: cp,
    });
  }

  // 4. Feedback events
  const feedbackRes = await db.query(`
    SELECT * FROM farmer_feedback WHERE season_id = $1 ORDER BY period_end ASC
  `, [id]);
  for (const fb of feedbackRes.rows) {
    events.push({
      date: fb.period_end,
      type: 'feedback',
      title: `Cycle ${fb.cycle_number} Voice Feedback`,
      description: `Rain: ${fb.rainfall_class}, Irrigated: ${fb.irrigated ? 'Yes' : 'No'} (${fb.pump_hours} hrs), Condition: ${fb.crop_condition}`,
      data: fb,
    });
  }

  // 5. Action items
  const actionsRes = await db.query(`
    SELECT * FROM action_items WHERE season_id = $1 ORDER BY created_at ASC
  `, [id]);
  for (const ai of actionsRes.rows) {
    events.push({
      date: ai.created_at.toISOString().split('T')[0],
      type: 'action_item',
      title: `Action Item: ${ai.type.replace(/_/g, ' ').toUpperCase()}`,
      description: `Priority: ${ai.priority}, Status: ${ai.status}. ${ai.referral_note || ''}`,
      data: ai,
    });
  }

  // 6. Harvest completion (if completed)
  if (season.actual_harvest_date) {
    events.push({
      date: season.actual_harvest_date,
      type: 'harvest',
      title: `Harvest Completed`,
      description: `Yield: ${season.yield_value || 'N/A'} ${season.yield_unit || ''}`,
      status: 'completed',
    });
  }

  // Sort all timeline events by date ascending
  events.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  res.json({
    data: {
      season_id: season.id,
      season_code: season.season_code,
      events,
    },
  });
}
