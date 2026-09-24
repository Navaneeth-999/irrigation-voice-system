import { Request, Response } from 'express';
import { db } from '../../db/index.js';
import { getScopedVillageFilter } from '../../middleware/auth.js';

export async function getDashboardKPIs(req: Request, res: Response): Promise<void> {
  const user = req.user;
  const scopedVillages = getScopedVillageFilter(user);

  let farmerFilter = '';
  const params: any[] = [];

  if (scopedVillages !== null) {
    if (scopedVillages.length === 0) {
      res.json({
        data: {
          totalFarmers: 0,
          activeFarmers: 0,
          totalAcres: 0,
          activeSeasons: 0,
          completedSeasons: 0,
          callsCompleted: 0,
          callsPending: 0,
          openActionItems: 0,
          estimatedWaterUsageL: 0,
        }
      });
      return;
    }
    params.push(scopedVillages);
    farmerFilter = ` WHERE village_id = ANY($1)`;
  }

  // 1. Farmer counts
  const farmersCountRes = await db.query(`
    SELECT 
      COUNT(*)::int as total,
      COUNT(CASE WHEN status = 'active' THEN 1 END)::int as active
    FROM farmers
    ${farmerFilter}
  `, params);

  // 2. Total acres from plots
  let plotQuery = `
    SELECT COALESCE(SUM(p.area_acres), 0)::float as total_acres
    FROM plots p
    JOIN farmers f ON p.farmer_id = f.id
    WHERE p.is_active = true
  `;
  if (scopedVillages !== null) {
    plotQuery += ` AND f.village_id = ANY($1)`;
  }
  const acresRes = await db.query(plotQuery, params);

  const kpis = {
    totalFarmers: farmersCountRes.rows[0]?.total || 0,
    activeFarmers: farmersCountRes.rows[0]?.active || 0,
    totalAcres: acresRes.rows[0]?.total_acres || 0,
    activeSeasons: 0, // Enriched in Phase 2
    completedSeasons: 0, // Enriched in Phase 2
    callsCompleted: 0, // Enriched in Phase 3
    callsPending: 0, // Enriched in Phase 3
    openActionItems: 0, // Enriched in Phase 2
    estimatedWaterUsageL: 0, // Enriched in Phase 2 & 5
  };

  res.json({ data: kpis });
}
