import { Request, Response } from 'express';
import { db } from '../../db/index.js';

export async function getVillages(_req: Request, res: Response): Promise<void> {
  const villagesRes = await db.query(`
    SELECT id, name, mandal, district, gram_panchayat, latitude, longitude, is_demo
    FROM villages
    ORDER BY name ASC
  `);
  res.json({ data: villagesRes.rows });
}

export async function getCrops(_req: Request, res: Response): Promise<void> {
  const cropsRes = await db.query(`
    SELECT id, name, name_te, category, default_duration_days, water_model, is_active
    FROM crops
    WHERE is_active = true
    ORDER BY name ASC
  `);

  const crops = cropsRes.rows;

  for (const crop of crops) {
    const stagesRes = await db.query(`
      SELECT id, stage_order, name, name_te, start_das, end_das, kc, kc_source, kc_verified
      FROM crop_stages
      WHERE crop_id = $1
      ORDER BY stage_order ASC
    `, [crop.id]);
    crop.stages = stagesRes.rows;

    const paramsRes = await db.query(`
      SELECT id, key, value_numeric, unit, source, verified, notes
      FROM crop_model_parameters
      WHERE crop_id = $1
    `, [crop.id]);
    crop.parameters = paramsRes.rows;
  }

  res.json({ data: crops });
}

export async function getWaterSourceTypes(_req: Request, res: Response): Promise<void> {
  const wsRes = await db.query(`
    SELECT id, code, name, name_te, requires_pump
    FROM water_source_types
    ORDER BY name ASC
  `);
  res.json({ data: wsRes.rows });
}

export async function getIrrigationMethodTypes(_req: Request, res: Response): Promise<void> {
  const imRes = await db.query(`
    SELECT id, code, name, name_te, typical_efficiency, efficiency_source, efficiency_verified
    FROM irrigation_method_types
    ORDER BY name ASC
  `);
  res.json({ data: imRes.rows });
}
