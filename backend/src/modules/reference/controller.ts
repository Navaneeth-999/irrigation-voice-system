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

export async function createVillage(req: Request, res: Response): Promise<void> {
  const { name, mandal, district, gram_panchayat, latitude, longitude } = req.body;
  if (!name || !mandal || !district) {
    res.status(400).json({ success: false, error: 'name, mandal, and district are required' });
    return;
  }

  const result = await db.query(`
    INSERT INTO villages (name, mandal, district, gram_panchayat, latitude, longitude, is_demo)
    VALUES ($1, $2, $3, $4, $5, $6, false)
    ON CONFLICT (name, mandal) DO UPDATE SET
      district = EXCLUDED.district,
      gram_panchayat = COALESCE(EXCLUDED.gram_panchayat, villages.gram_panchayat),
      updated_at = CURRENT_TIMESTAMP
    RETURNING id, name, mandal, district, gram_panchayat, latitude, longitude, is_demo
  `, [
    name.trim(),
    mandal.trim(),
    district.trim(),
    gram_panchayat ? gram_panchayat.trim() : `${name.trim()} GP`,
    latitude ? Number(latitude) : 16.3000,
    longitude ? Number(longitude) : 80.4500,
  ]);

  res.status(201).json({ success: true, data: result.rows[0] });
}
