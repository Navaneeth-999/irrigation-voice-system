import { Request, Response } from 'express';
import { db, withTransaction } from '../../db/index.js';
import { AppError } from '../../middleware/errorHandler.js';
import { recordAudit } from '../../middleware/audit.js';
import { createPlotSchema, updatePlotSchema, waterSourceInputSchema } from './schemas.js';

export async function listPlots(req: Request, res: Response): Promise<void> {
  const { farmer_id } = req.query;

  let query = `
    SELECT p.*, f.full_name as farmer_name, f.farmer_code,
           COALESCE(json_agg(json_build_object(
             'id', pws.id,
             'water_source_type_id', pws.water_source_type_id,
             'source_name', wst.name,
             'source_name_te', wst.name_te,
             'pump_hp', pws.pump_hp,
             'discharge_lph', pws.discharge_lph,
             'is_primary', pws.is_primary,
             'notes', pws.notes
           )) FILTER (WHERE pws.id IS NOT NULL), '[]') as water_sources
    FROM plots p
    JOIN farmers f ON p.farmer_id = f.id
    LEFT JOIN plot_water_sources pws ON p.id = pws.plot_id
    LEFT JOIN water_source_types wst ON pws.water_source_type_id = wst.id
    WHERE p.is_active = true
  `;
  const params: any[] = [];

  if (farmer_id) {
    params.push(farmer_id);
    query += ` AND p.farmer_id = $${params.length}`;
  }

  query += ` GROUP BY p.id, f.full_name, f.farmer_code ORDER BY p.created_at DESC`;

  const plotsRes = await db.query(query, params);
  res.json({ data: plotsRes.rows });
}

export async function getPlot(req: Request, res: Response): Promise<void> {
  const id = req.params.id as string;

  const plotRes = await db.query(`
    SELECT p.*, f.full_name as farmer_name, f.farmer_code,
           COALESCE(json_agg(json_build_object(
             'id', pws.id,
             'water_source_type_id', pws.water_source_type_id,
             'source_name', wst.name,
             'source_name_te', wst.name_te,
             'pump_hp', pws.pump_hp,
             'discharge_lph', pws.discharge_lph,
             'is_primary', pws.is_primary,
             'notes', pws.notes
           )) FILTER (WHERE pws.id IS NOT NULL), '[]') as water_sources
    FROM plots p
    JOIN farmers f ON p.farmer_id = f.id
    LEFT JOIN plot_water_sources pws ON p.id = pws.plot_id
    LEFT JOIN water_source_types wst ON pws.water_source_type_id = wst.id
    WHERE p.id = $1 AND p.is_active = true
    GROUP BY p.id, f.full_name, f.farmer_code
  `, [id]);

  if (plotRes.rows.length === 0) {
    throw new AppError('Plot not found', 404, 'NOT_FOUND');
  }

  res.json({ data: plotRes.rows[0] });
}

export async function createPlot(req: Request, res: Response): Promise<void> {
  const data = createPlotSchema.parse(req.body);

  const createdPlot = await withTransaction(async (tx) => {
    const pRes = await tx.query(`
      INSERT INTO plots (
        farmer_id, label, survey_number, area_acres, latitude, longitude,
        soil_type, tenure, is_active
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)
      RETURNING *
    `, [
      data.farmer_id, data.label, data.survey_number || null, data.area_acres,
      data.latitude || null, data.longitude || null, data.soil_type || null,
      data.tenure,
    ]);
    const plot = pRes.rows[0];

    for (const ws of data.water_sources) {
      await tx.query(`
        INSERT INTO plot_water_sources (
          plot_id, water_source_type_id, pump_hp, discharge_lph, is_primary, notes
        )
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [
        plot.id, ws.water_source_type_id, ws.pump_hp || null,
        ws.discharge_lph || null, ws.is_primary, ws.notes || null,
      ]);
    }

    return plot;
  });

  await recordAudit({
    userId: req.user?.id,
    action: 'PLOT_CREATED',
    entityType: 'plots',
    entityId: createdPlot.id,
    after: { label: createdPlot.label, area_acres: createdPlot.area_acres, farmer_id: createdPlot.farmer_id },
    req,
  });

  res.status(201).json({ data: createdPlot });
}

export async function updatePlot(req: Request, res: Response): Promise<void> {
  const id = req.params.id as string;
  const updates = updatePlotSchema.parse(req.body);

  const existingRes = await db.query('SELECT * FROM plots WHERE id = $1', [id]);
  if (existingRes.rows.length === 0) {
    throw new AppError('Plot not found', 404, 'NOT_FOUND');
  }
  const before = existingRes.rows[0];

  const label = updates.label ?? before.label;
  const surveyNumber = updates.survey_number !== undefined ? updates.survey_number : before.survey_number;
  const areaAcres = updates.area_acres ?? before.area_acres;
  const latitude = updates.latitude !== undefined ? updates.latitude : before.latitude;
  const longitude = updates.longitude !== undefined ? updates.longitude : before.longitude;
  const soilType = updates.soil_type !== undefined ? updates.soil_type : before.soil_type;
  const tenure = updates.tenure ?? before.tenure;

  const resPlot = await db.query(`
    UPDATE plots
    SET label = $1, survey_number = $2, area_acres = $3, latitude = $4,
        longitude = $5, soil_type = $6, tenure = $7, updated_at = CURRENT_TIMESTAMP
    WHERE id = $8
    RETURNING *
  `, [label, surveyNumber, areaAcres, latitude, longitude, soilType, tenure, id]);

  const after = resPlot.rows[0];

  await recordAudit({
    userId: req.user?.id,
    action: 'PLOT_UPDATED',
    entityType: 'plots',
    entityId: id,
    before,
    after,
    req,
  });

  res.json({ data: after });
}

export async function addPlotWaterSource(req: Request, res: Response): Promise<void> {
  const plotId = req.params.id as string;
  const data = waterSourceInputSchema.parse(req.body);

  const resWs = await db.query(`
    INSERT INTO plot_water_sources (
      plot_id, water_source_type_id, pump_hp, discharge_lph, is_primary, notes
    )
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *
  `, [plotId, data.water_source_type_id, data.pump_hp || null, data.discharge_lph || null, data.is_primary, data.notes || null]);

  res.status(201).json({ data: resWs.rows[0] });
}

export async function deletePlotWaterSource(req: Request, res: Response): Promise<void> {
  const wsId = req.params.id as string;

  await db.query('DELETE FROM plot_water_sources WHERE id = $1', [wsId]);
  res.json({ data: { message: 'Water source removed from plot' } });
}
