import { Request, Response } from 'express';
import { db } from '../../db/index.js';
import { getScopedVillageFilter } from '../../middleware/auth.js';
import { analyticsService } from './service.js';

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
          estimatedWaterUsageL: null,
          hasIrrigationRecords: false,
          waterRecordsCount: 0,
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

  // 3. Seasons count
  let seasonQuery = `
    SELECT 
      COUNT(CASE WHEN s.status = 'active' THEN 1 END)::int as active_seasons,
      COUNT(CASE WHEN s.status = 'completed' THEN 1 END)::int as completed_seasons
    FROM seasons s
    JOIN plots p ON s.plot_id = p.id
    JOIN farmers f ON p.farmer_id = f.id
    WHERE 1=1
  `;
  if (scopedVillages !== null) {
    seasonQuery += ` AND f.village_id = ANY($1)`;
  }
  const seasonCountRes = await db.query(seasonQuery, params);

  // 4. Open Action items
  let actionQuery = `
    SELECT COUNT(*)::int as open_actions
    FROM action_items a
    JOIN seasons s ON a.season_id = s.id
    JOIN plots p ON s.plot_id = p.id
    JOIN farmers f ON p.farmer_id = f.id
    WHERE a.status = 'open'
  `;
  if (scopedVillages !== null) {
    actionQuery += ` AND f.village_id = ANY($1)`;
  }
  const actionRes = await db.query(actionQuery, params);

  // 5. Water usage sum & record count (distinguish genuine 0 usage from missing records)
  let waterQuery = `
    SELECT 
      SUM(ir.estimated_volume_l)::float as total_litres,
      COUNT(ir.id)::int as record_count
    FROM irrigation_records ir
    JOIN seasons s ON ir.season_id = s.id
    JOIN plots p ON s.plot_id = p.id
    JOIN farmers f ON p.farmer_id = f.id
    WHERE 1=1
  `;
  if (scopedVillages !== null) {
    waterQuery += ` AND f.village_id = ANY($1)`;
  }
  const waterRes = await db.query(waterQuery, params);
  const recordCount = waterRes.rows[0]?.record_count || 0;
  const estimatedWaterUsageL = recordCount > 0 ? (waterRes.rows[0]?.total_litres ?? 0) : null;

  // 6. Real Call counts from call_attempts and call_schedule
  let callCompletedQuery = `
    SELECT COUNT(DISTINCT ca.id)::int as completed_count
    FROM call_attempts ca
    LEFT JOIN call_schedule cs ON ca.call_schedule_id = cs.id
    LEFT JOIN farmers f ON cs.farmer_id = f.id
    WHERE ca.status = 'completed'
  `;
  if (scopedVillages !== null) {
    callCompletedQuery += ` AND (f.village_id = ANY($1) OR cs.id IS NULL)`;
  }
  const callCompletedRes = await db.query(callCompletedQuery, params);

  let callPendingQuery = `
    SELECT COUNT(DISTINCT cs.id)::int as pending_count
    FROM call_schedule cs
    JOIN farmers f ON cs.farmer_id = f.id
    WHERE cs.status IN ('scheduled', 'in_progress')
  `;
  if (scopedVillages !== null) {
    callPendingQuery += ` AND f.village_id = ANY($1)`;
  }
  const callPendingRes = await db.query(callPendingQuery, params);

  const kpis = {
    totalFarmers: farmersCountRes.rows[0]?.total || 0,
    activeFarmers: farmersCountRes.rows[0]?.active || 0,
    totalAcres: acresRes.rows[0]?.total_acres || 0,
    activeSeasons: seasonCountRes.rows[0]?.active_seasons || 0,
    completedSeasons: seasonCountRes.rows[0]?.completed_seasons || 0,
    callsCompleted: callCompletedRes.rows[0]?.completed_count || 0,
    callsPending: callPendingRes.rows[0]?.pending_count || 0,
    openActionItems: actionRes.rows[0]?.open_actions || 0,
    estimatedWaterUsageL,
    hasIrrigationRecords: recordCount > 0,
    waterRecordsCount: recordCount,
  };

  res.json({ data: kpis });
}

export class AnalyticsController {
  /**
   * Helper: Validates that an AGRI_PANCHAYAT user only accesses seasons within assigned villages.
   */
  private async checkVillageAccess(user: any, seasonId: string): Promise<{ authorized: boolean; notFound?: boolean }> {
    const seasonRes = await db.query(
      `SELECT s.id, f.village_id 
       FROM seasons s 
       JOIN farmers f ON f.id = s.farmer_id 
       WHERE s.id = $1`,
      [seasonId]
    );

    if (seasonRes.rows.length === 0) {
      return { authorized: false, notFound: true };
    }

    const scopedVillages = getScopedVillageFilter(user);
    if (scopedVillages !== null) {
      const seasonVillageId = seasonRes.rows[0].village_id;
      if (!scopedVillages.includes(seasonVillageId)) {
        return { authorized: false, notFound: false };
      }
    }

    return { authorized: true };
  }

  /**
   * GET /api/v1/analytics/seasons/:seasonId
   * Retrieves full seasonal analytics, water balance, WUR band, and confidence score.
   */
  async getSeasonAnalytics(req: Request, res: Response): Promise<void> {
    try {
      const seasonId = req.params.seasonId as string;
      const access = await this.checkVillageAccess(req.user, seasonId);

      if (access.notFound) {
        res.status(404).json({ success: false, error: `Season with ID ${seasonId} not found` });
        return;
      }
      if (!access.authorized) {
        res.status(403).json({ success: false, error: 'Forbidden: Access to season outside assigned village scope' });
        return;
      }

      const data = await analyticsService.getSeasonAnalytics(seasonId);
      res.status(200).json({ success: true, data });
    } catch (err: any) {
      if (err.message.includes('not found')) {
        res.status(404).json({ success: false, error: err.message });
      } else {
        res.status(500).json({ success: false, error: err.message });
      }
    }
  }

  /**
   * POST /api/v1/analytics/seasons/:seasonId/recalculate
   * Forces a fresh recalculation of daily water balances and seasonal metrics.
   */
  async recalculateSeason(req: Request, res: Response): Promise<void> {
    try {
      const seasonId = req.params.seasonId as string;
      const access = await this.checkVillageAccess(req.user, seasonId);

      if (access.notFound) {
        res.status(404).json({ success: false, error: `Season with ID ${seasonId} not found` });
        return;
      }
      if (!access.authorized) {
        res.status(403).json({ success: false, error: 'Forbidden: Access to season outside assigned village scope' });
        return;
      }

      await analyticsService.computeSeasonDailyBalance(seasonId);
      const metrics = await analyticsService.recalculateSeasonWaterMetrics(seasonId);
      res.status(200).json({ success: true, data: metrics });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }
}

export const analyticsController = new AnalyticsController();
